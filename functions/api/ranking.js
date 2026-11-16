export async function onRequestGet() {
  try {
    const response = await fetch('https://cx-manager-order-relay.fgsantillan0126.workers.dev/ranking/v1', {signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Ranking unavailable');
    return Response.json(await response.json(), {headers: {'cache-control':'no-store'}});
  } catch {
    return Response.json({error:'Ranking temporalmente no disponible.'}, {status:503,headers:{'cache-control':'no-store'}});
  }
}
