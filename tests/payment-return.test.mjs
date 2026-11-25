import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../planes/estado/estado.js',import.meta.url),'utf8');
async function run(hash){
 const elements={status:{textContent:''},reference:{textContent:''},refresh:{addEventListener(){}}};let authorization=null,cleaned=null;
 const context=vm.createContext({URLSearchParams,Error,location:{hash,pathname:'/planes/estado/'},history:{replaceState(a,b,path){cleaned=path}},document:{getElementById:id=>elements[id]},fetch:async(url,options)=>{assert.equal(url,'/api/contracting?status=1');authorization=options.headers.authorization;return Response.json({request:{id:'synthetic',status:'paid_review'}})}});
 vm.runInContext(source,context);await vm.runInContext('load()',context);return {authorization,cleaned,status:elements.status.textContent};
}
for(const suffix of ['', '?collection_id=123&status=approved&external_reference=ficticio','&status=pending']){
 const result=await run('#access='+'a'.repeat(64)+suffix);assert.equal(result.authorization,'Bearer '+'a'.repeat(64));assert.equal(result.cleaned,'/planes/estado/');assert.equal(result.status,'Pago recibido. Tu solicitud está en revisión comercial.');
}
const invalid=await run('#access=invalid?status=approved');assert.equal(invalid.authorization,null);assert.equal(invalid.status,'Abrí el enlace de seguimiento de tu solicitud.');
console.log('PASS payment return: actual provider metadata appended after fragment, private token only in Authorization, URL cleanup and server-verified status.');
