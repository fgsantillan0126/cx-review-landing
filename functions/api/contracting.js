import {plans,catalogVersion} from '../_lib/launch-catalog.js';
import {digest} from './client-area.js';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
const val=(v,n)=>typeof v==='string'&&v.trim().length<=n?v.trim():'';
const configured=env=>env.CX_CONTRACTING_ENABLED==='1'&&!!env.CXR_COMMERCE_DB&&!!env.MP_ACCESS_TOKEN&&!!env.MP_WEBHOOK_SECRET&&!!env.TURNSTILE_SECRET_KEY&&!!env.TURNSTILE_SITE_KEY&&!!env.CX_WEB_COMMERCIAL_TOKEN;
export function normalizeRequest(body){
 const fields={storeName:200,storeUrl:1000,requesterName:160,requesterEmail:160,billingName:200,taxId:30,taxStatus:40,billingAddress:300,billingEmail:160},out={};
 for(const [key,n] of Object.entries(fields)){out[key]=val(body[key],n);if(!out[key])return null;}
 if(!/^\S+@\S+\.\S+$/.test(out.requesterEmail)||!/^\S+@\S+\.\S+$/.test(out.billingEmail)||!['Consumidor final','Responsable inscripto','Monotributista','Exento'].includes(out.taxStatus))return null;
 try{const u=new URL(out.storeUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||u.hostname==='localhost'||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))return null;out.storeUrl=u.href;}catch{return null;}
 if(body.accepted!==true)return null;
 return {...out,accepted:true,termsVersion:'2026-11-24',requesterEmail:out.requesterEmail.toLowerCase(),billingEmail:out.billingEmail.toLowerCase()};
}
async function readBody(request){if(Number(request.headers.get('content-length')||0)>16000)return null;const raw=await request.text();if(new TextEncoder().encode(raw).length>16000)return null;try{return JSON.parse(raw)}catch{return null;}}
async function turnstile(env,token,hostname){try{const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token})}),d=await r.json();return d.success===true&&d.action==='contracting'&&d.hostname===hostname;}catch{return false;}}
export async function onRequest({request,env}){
 const u=new URL(request.url),service=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 const commercial=env.CX_WEB_COMMERCIAL_TOKEN?.length>=32&&service===env.CX_WEB_COMMERCIAL_TOKEN;
 if(request.method==='GET'){
  if(u.searchParams.get('queue')==='1'){
   if(!commercial)return reply({error:'Acceso no autorizado.'},401);if(!env.CXR_COMMERCE_DB)return reply({error:'Servicio no configurado.'},503);
   const rows=await env.CXR_COMMERCE_DB.prepare("SELECT id,plan_id,plan_snapshot,request_json,initial_minor,total_minor,payment_id,paid_at,gross_minor,net_minor,status,created_at FROM web_contract_requests WHERE status IN('paid_review','approved','correction') ORDER BY paid_at DESC LIMIT 100").all();return reply({requests:rows.results});
  }
  if(u.searchParams.get('status')==='1'){if(!/^[a-f0-9]{64}$/.test(service)||!env.CXR_COMMERCE_DB)return reply({error:'Solicitud no disponible.'},404);const row=await env.CXR_COMMERCE_DB.prepare('SELECT id,status,plan_id,initial_minor,total_minor,paid_at FROM web_contract_requests WHERE access_hash=?').bind(await digest(service)).first();return row?reply({request:row}):reply({error:'Solicitud no disponible.'},404);}
  return reply({version:catalogVersion,plans,checkoutEnabled:configured(env),turnstileSiteKey:env.TURNSTILE_SITE_KEY||''});
 }
 if(request.method!=='POST')return reply({error:'Método no permitido.'},405);
 const body=await readBody(request);if(!body)return reply({error:'Datos inválidos.'},400);
 if(body.action==='review'){
  if(!commercial)return reply({error:'Acceso no autorizado.'},401);if(!['approve','correction'].includes(body.decision)||!val(body.id,80)||!val(body.actor,100))return reply({error:'Revisión inválida.'},400);
  const result=await env.CXR_COMMERCE_DB.prepare("UPDATE web_contract_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=? WHERE id=? AND status='paid_review' AND payment_id IS NOT NULL").bind(body.decision==='approve'?'approved':'correction',body.actor,val(body.note,2000),body.id).run();return result.meta.changes?reply({ok:true}):reply({error:'La solicitud cambió o aún no tiene pago verificado.'},409);
 }
 if(request.headers.get('origin')!==u.origin)return reply({error:'Origen no permitido.'},403);
 if(!configured(env))return reply({error:'La contratación online todavía está en preparación. No se realizó ningún cobro.'},503);
 const plan=plans.find(p=>p.id===body.plan),data=normalizeRequest(body),id=val(body.id,40),access=val(body.access,64);
 if(!plan||!data||!/^[-a-f0-9]{36}$/i.test(id)||!/^[a-f0-9]{64}$/.test(access))return reply({error:'Revisá los datos del sitio, solicitante y facturación.'},400);
 if(!await turnstile(env,val(body.turnstileToken,2048),u.hostname))return reply({error:'No pudimos validar la solicitud. Intentá nuevamente.'},403);
 const db=env.CXR_COMMERCE_DB,payloadHash=await digest(JSON.stringify({plan:plan.id,data})),accessHash=await digest(access),previous=await db.prepare('SELECT * FROM web_contract_requests WHERE id=?').bind(id).first();
 if(previous&&(previous.payload_hash!==payloadHash||previous.access_hash!==accessHash))return reply({error:'La solicitud ya existe con otros datos.'},409);
 if(previous?.init_point)return reply({ok:true,initPoint:previous.init_point});
 await db.prepare('INSERT OR IGNORE INTO web_contract_requests(id,payload_hash,access_hash,plan_id,catalog_version,plan_snapshot,request_json,initial_minor,total_minor) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,payloadHash,accessHash,plan.id,catalogVersion,JSON.stringify(plan),JSON.stringify(data),plan.initialMinor,plan.priceMinor).run();
 const claimed=await db.prepare("UPDATE web_contract_requests SET preference_id='creating' WHERE id=? AND preference_id IS NULL AND payload_hash=? AND access_hash=?").bind(id,payloadHash,accessHash).run();
 if(!claimed.meta.changes)return reply({error:'Tu pago se está preparando o requiere verificación. No creamos otro intento para evitar duplicados.'},409);
 const back=u.origin+'/planes/estado/#access='+access;
 const preference={items:[{id:plan.id,title:plan.name+(plan.scope===100?' · Anticipo':' · Pago inicial'),quantity:1,currency_id:'ARS',unit_price:plan.initialMinor/100}],payer:{email:data.requesterEmail},external_reference:id,back_urls:{success:back,failure:back,pending:back},auto_return:'approved',notification_url:u.origin+'/api/contracting-webhook',expires:true,expiration_date_from:new Date().toISOString(),expiration_date_to:new Date(Date.now()+86400000).toISOString(),metadata:{catalog_version:catalogVersion}};
 let r;try{r=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{authorization:'Bearer '+env.MP_ACCESS_TOKEN,'content-type':'application/json','x-idempotency-key':id},body:JSON.stringify(preference),signal:AbortSignal.timeout(10000)});}catch{return reply({error:'No pudimos conectar con Mercado Pago. Conservamos tu solicitud para reintentar.'},502);}
 const result=await r.json().catch(()=>null);let redirect;try{redirect=new URL(result?.init_point);if(redirect.protocol!=='https:'||!/(^|\.)mercadopago\.(com|com\.ar)$/.test(redirect.hostname))throw Error();}catch{return reply({error:'Mercado Pago no pudo iniciar el pago. No se confirmó ningún cobro.'},502);}
 if(!r.ok||!result.id)return reply({error:'No se pudo iniciar el pago.'},502);
 await db.prepare("UPDATE web_contract_requests SET preference_id=?,init_point=? WHERE id=? AND preference_id='creating'").bind(String(result.id),redirect.href,id).run();return reply({ok:true,initPoint:redirect.href});
}
