const headers={'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow, noarchive','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const text=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n?v:null;
const areas=['compliance','cx','commercial','technology','operations'];
export function hasEightExecutivePages(html){
 if(typeof html!=='string'||!/^<!doctype html>/i.test(html))return false;
 const markup=html.replace(/<!--[\s\S]*?-->|<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const pages=[...markup.matchAll(/<section\b[^>]*\bdata-page=(["'])(\d+)\1[^>]*>/gi)].map(m=>Number(m[2]));
 return pages.length===8&&pages.every((page,index)=>page===index+1);
}
function normalizeReport(r){
 if(!r||!text(r.reference,80)||!text(r.storeName,200)||![80,100].includes(r.scope)||!Number.isFinite(r.score)||r.score<0||r.score>100||!Number.isInteger(r.revision)||r.revision<1||!Array.isArray(r.points)||r.points.length!==r.scope||!Array.isArray(r.areas)||r.areas.length!==(r.scope===80?4:5))return null;
 const seen=new Set(),areaSeen=new Set(),points=[];
 for(const a of r.areas){if(!areas.includes(a.key)||areaSeen.has(a.key)||(r.scope===80&&a.key==='operations')||!Number.isFinite(a.score)||a.score<0||a.score>100)return null;areaSeen.add(a.key);}
 for(const p of r.points){if(!text(p.id,20)||seen.has(p.id)||!areaSeen.has(p.area)||!Number.isInteger(p.level)||p.level<1||p.level>5||!text(p.title,300)||!text(p.evaluation,4000)||!text(p.action,4000)||!text(p.severity,30)||!Number.isInteger(p.number)||p.number<1||p.number>100)return null;seen.add(p.id);points.push({id:p.id,number:p.number,area:p.area,title:p.title,level:p.level,severity:p.severity,evaluation:p.evaluation,action:p.action,impact:typeof p.impact==='string'?p.impact.slice(0,4000):'',observation:typeof p.observation==='string'?p.observation.slice(0,12000):'',url:typeof p.url==='string'?p.url.slice(0,1500):''});}
 if([...areaSeen].some(k=>points.filter(p=>p.area===k).length!==20))return null;
 return {reference:r.reference,storeName:r.storeName,scope:r.scope,score:r.score,revision:r.revision,approvedAt:typeof r.approvedAt==='string'?r.approvedAt.slice(0,40):'',summary:typeof r.summary==='string'?r.summary.slice(0,10000):'',priorities:typeof r.priorities==='string'?r.priorities.slice(0,15000):'',areas:r.areas.map(a=>({key:a.key,score:a.score})),points};
}
async function boundedJson(request){
 const reader=request.body?.getReader();if(!reader)return null;let size=0,out='';const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1500000){await reader.cancel();return null;}out+=decoder.decode(value,{stream:true});}
 try{return JSON.parse(out+decoder.decode());}catch{return null;}
}
export async function onRequest({request,env}){
 const db=env.CXR_CLIENT_DB;if(!db)return reply({error:'La zona de clientes todavía no está habilitada.'},503);
 const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(request.method==='GET'){
  if(!/^[a-f0-9]{64}$/.test(bearer))return reply({error:'Ingresá con el enlace privado que te compartió tu ejecutivo.'},401);
  const access=await db.prepare("SELECT client_id FROM client_access WHERE token_hash=? AND revoked_at IS NULL AND julianday(expires_at)>julianday('now')").bind(await digest(bearer)).first();
  if(!access)return reply({error:'El acceso no está disponible o venció. Pedí un nuevo enlace a tu ejecutivo.'},401);
  const document=new URL(request.url).searchParams.get('document');
  if(document){const row=await db.prepare('SELECT executive_html FROM client_reports WHERE reference=? AND client_id=? AND released_at IS NOT NULL').bind(document,access.client_id).first();return row?new Response(row.executive_html,{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; img-src 'self' https://cx-review.com.ar; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"}}):reply({error:'Informe no disponible.'},404);}
  const rows=await db.prepare('SELECT content_json,released_at FROM client_reports WHERE client_id=? AND released_at IS NOT NULL ORDER BY released_at DESC,order_id').bind(access.client_id).all();
  return reply({reports:rows.results.map(r=>({...JSON.parse(r.content_json),releasedAt:r.released_at}))});
 }
 if(request.method!=='POST')return reply({error:'Método no permitido.'},405);
 if(env.CX_CLIENT_PUBLISH_TOKEN&&env.CX_CLIENT_PUBLISH_TOKEN===env.CX_CLIENT_RELEASE_TOKEN)return reply({error:'Las claves de preparación y entrega deben ser diferentes.'},503);
 const publish=typeof env.CX_CLIENT_PUBLISH_TOKEN==='string'&&env.CX_CLIENT_PUBLISH_TOKEN.length>=32&&bearer===env.CX_CLIENT_PUBLISH_TOKEN;
 const release=typeof env.CX_CLIENT_RELEASE_TOKEN==='string'&&env.CX_CLIENT_RELEASE_TOKEN.length>=32&&bearer===env.CX_CLIENT_RELEASE_TOKEN;
 if(!publish&&!release)return reply({error:'Acceso no autorizado.'},401);
 const body=await boundedJson(request);if(!body)return reply({error:'Solicitud inválida o demasiado grande.'},400);
 const orderId=text(body.orderId,80),actor=text(body.actor,100);if(!orderId||!actor)return reply({error:'Falta la referencia de la entrega.'},400);
 if(body.action==='prepare'&&publish){
  const report=normalizeReport(body.report);if(!report)return reply({error:'El informe no tiene un alcance válido y completo.'},400);
  const html=text(body.executiveHtml,300000);if(!hasEightExecutivePages(html))return reply({error:'El informe ejecutivo debe contener ocho páginas.'},400);
  const old=await db.prepare('SELECT reference,revision,content_json,released_at FROM client_reports WHERE order_id=?').bind(orderId).first();
  const content=JSON.stringify(report);
  if(old?.content_json===content)return reply({ok:true,duplicate:true});
  if(old&&(old.released_at||old.reference!==report.reference||old.revision>report.revision))return reply({error:'El informe entregado está congelado o la revisión no coincide.'},409);
  await db.batch([db.prepare("INSERT INTO client_reports(order_id,reference,revision,content_json,executive_html) VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET content_json=excluded.content_json,executive_html=excluded.executive_html,revision=excluded.revision,prepared_at=CURRENT_TIMESTAMP WHERE client_reports.released_at IS NULL AND client_reports.reference=excluded.reference AND client_reports.revision<=excluded.revision").bind(orderId,report.reference,report.revision,content,html),db.prepare("INSERT INTO client_area_history(id,order_id,action,actor) SELECT ?,?,'prepared',? WHERE changes()=1").bind(crypto.randomUUID(),orderId,actor)]);
  return reply({ok:true});
 }
 if(body.action==='release'&&release){
  const clientId=text(body.clientId,80),tokenHash=text(body.tokenHash,64),reference=text(body.reference,80);
  if(!clientId||!reference||!tokenHash||!/^[a-f0-9]{64}$/.test(tokenHash))return reply({error:'Entrega inválida.'},400);
  const result=await db.batch([
   db.prepare("UPDATE client_reports SET client_id=?,released_at=COALESCE(released_at,CURRENT_TIMESTAMP),released_by=? WHERE order_id=? AND reference=? AND (client_id IS NULL OR client_id=?)").bind(clientId,actor,orderId,reference,clientId),
   db.prepare("INSERT OR IGNORE INTO client_access(token_hash,client_id,expires_at,created_by) SELECT ?,?,datetime('now','+90 days'),? WHERE changes()=1").bind(tokenHash,clientId,actor),
   db.prepare("INSERT INTO client_area_history(id,order_id,action,actor) SELECT ?,?,'released',? WHERE changes()=1").bind(crypto.randomUUID(),orderId,actor)]);
  return result[0].meta.changes?reply({ok:true}):reply({error:'Audit debe preparar el informe aprobado antes de habilitar la zona del cliente.'},409);
 }
 if(body.action==='revoke'&&release&&text(body.tokenHash,64)){
  await db.prepare('UPDATE client_access SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND client_id=?').bind(body.tokenHash,body.clientId).run();return reply({ok:true});
 }
 return reply({error:'Tu función no permite esta acción.'},403);
}
