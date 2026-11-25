import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/ranking.js';
let payload={stores:[]},unavailable=false,workspace='development';
globalThis.fetch=async url=>{
 assert.equal(String(url),(workspace==='production'?'https://cx-operational-relay.fgsantillan0126.workers.dev':'https://cx-manager-order-relay.fgsantillan0126.workers.dev')+'/ranking/v1');
 return unavailable?new Response('',{status:503}):Response.json(payload);
};
const api=()=>onRequestGet({request:new Request('https://qa.cx-review.pages.dev/api/ranking'),env:{CXR_WORKSPACE_MODE:workspace}});
assert.deepEqual(await (await api()).json(),{stores:[]});
const store={name:'Tienda de prueba',url:'https://example.invalid',date:'2026-11-24',score:70,areas:{compliance:70,cx:70,technology:70,commercial:70},evidence:'PRIVATE',requesterEmail:'private@example.invalid',observations:'PRIVATE'};
payload={stores:[store,{...store,name:'Mayor puntaje',score:90},{...store,name:'URL insegura',url:'javascript:alert(1)'},{...store,name:'Credenciales',url:'https://user:password@example.invalid'},{...store,name:'Área incompleta',areas:{cx:70}},{...store,name:'Fuera de rango',score:101}]};
let result=await (await api()).json();assert.equal(result.stores.length,2);assert.equal(result.stores[0].name,'Mayor puntaje');
assert.deepEqual(Object.keys(result.stores[1]).sort(),['areas','date','name','score','url']);assert.deepEqual(Object.keys(result.stores[1].areas).sort(),['commercial','compliance','cx','technology']);
assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('private@example.invalid'));
payload={stores:null};assert.equal((await api()).status,503);unavailable=true;assert.equal((await api()).status,503);
workspace='production';unavailable=false;payload={stores:[]};assert.equal((await api()).status,200);
console.log('PASS public ranking: explicit workspace source, empty state, score ordering, safe URLs, complete areas, bounded scores, private field exclusion and unavailable source.');
