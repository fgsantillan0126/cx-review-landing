export async function onRequestGet({request,env}) {
  try {
    // The website follows the existing workspace. Only explicitly published entries leave the relay.
    const response = await fetch((env.CXR_WORKSPACE_MODE==='production'?'https://cx-operational-relay.fgsantillan0126.workers.dev':'https://cx-manager-order-relay.fgsantillan0126.workers.dev')+'/ranking/v1', {signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Ranking unavailable');
    const data=await response.json();if(!Array.isArray(data.stores))throw new Error('Invalid ranking');
    const keys=['compliance','cx','technology','commercial'];
    const stores=data.stores.filter(s=>typeof s.name==='string'&&s.name.length<=200&&typeof s.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&Number.isFinite(s.score)&&s.score>=0&&s.score<=100&&keys.every(k=>Number.isFinite(s.areas?.[k])&&s.areas[k]>=0&&s.areas[k]<=100)).flatMap(s=>{try{const url=new URL(s.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return [];return [{name:s.name,url:url.href,date:s.date,score:s.score,areas:Object.fromEntries(keys.map(k=>[k,s.areas[k]]))}];}catch{return [];}}).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'es'));
    return Response.json({stores}, {headers: {'cache-control':'no-store'}});
  } catch {
    return Response.json({error:'Ranking temporalmente no disponible.'}, {status:503,headers:{'cache-control':'no-store'}});
  }
}
