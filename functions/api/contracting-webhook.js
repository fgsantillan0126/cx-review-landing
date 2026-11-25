const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!env.MP_ACCESS_TOKEN||!env.MP_WEBHOOK_SECRET||!env.CXR_COMMERCE_DB)return json({error:'Servicio no configurado.'},503);
 const url=new URL(request.url),id=url.searchParams.get('data.id')||'',requestId=request.headers.get('x-request-id')||'',parts=Object.fromEntries((request.headers.get('x-signature')||'').split(',').map(p=>p.trim().split('='))),{ts,v1}=parts;
 if(!/^\d{1,30}$/.test(id)||!requestId||!/^\d{10,16}$/.test(ts||'')||!/^[a-f0-9]{64}$/i.test(v1||''))return json({error:'Firma inválida.'},401);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MP_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);const sig=Uint8Array.from(v1.match(/.{2}/g),h=>parseInt(h,16));
 if(!await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(`id:${id};request-id:${requestId};ts:${ts};`)))return json({error:'Firma inválida.'},401);
 let response;try{response=await fetch('https://api.mercadopago.com/v1/payments/'+id,{headers:{authorization:'Bearer '+env.MP_ACCESS_TOKEN},signal:AbortSignal.timeout(10000)});}catch{return json({error:'Verificación pendiente.'},503);}
 if(!response.ok)return json({error:'Verificación pendiente.'},503);const payment=await response.json(),db=env.CXR_COMMERCE_DB,order=await db.prepare('SELECT * FROM web_contract_requests WHERE id=?').bind(String(payment.external_reference||'')).first();if(!order)return json({ok:true,unmatched:true});
 if(String(payment.id)!==id||payment.currency_id!=='ARS'||!Number.isFinite(payment.transaction_amount)||Math.round(payment.transaction_amount*100)!==order.initial_minor)return json({error:'El pago no coincide con la solicitud.'},409);
 if(env.CXR_WORKSPACE_MODE!=='production'&&payment.live_mode!==false)return json({error:'El entorno de desarrollo solo acepta pagos de prueba.'},409);
 if(payment.status!=='approved')return json({ok:true,pending:true});
 const net=payment.transaction_details?.net_received_amount;if(!Number.isFinite(net)||net<0||net>payment.transaction_amount)return json({error:'La liquidación requiere verificación.'},503);
 await db.batch([db.prepare("INSERT INTO web_payment_events(payment_id,request_id,status) VALUES(?,?,'approved') ON CONFLICT(payment_id) DO NOTHING").bind(id,order.id),db.prepare("UPDATE web_contract_requests SET payment_id=?,paid_at=?,gross_minor=?,net_minor=?,status='paid_review' WHERE id=? AND status='awaiting_payment' AND payment_id IS NULL AND EXISTS(SELECT 1 FROM web_payment_events WHERE payment_id=? AND request_id=?)").bind(id,String(payment.date_approved||new Date().toISOString()),order.initial_minor,Math.round(net*100),order.id,id,order.id)]);
 return json({ok:true});
}
