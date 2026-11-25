import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pages,header} from '../scripts/sync-header.mjs';
import {plans} from '../functions/_lib/launch-catalog.js';
import {planSavings} from '../planes/plan-pricing.js';
const express=plans.find(p=>p.id==='express');
for(const [id,percent,saving,total] of [['quarterly',15,2400000,7200000],['halfyear',25,4000000,24000000],['annual',35,5600000,67200000]])assert.deepEqual(planSavings(plans.find(p=>p.id===id),express),{reference:16000000,percent,saving,total});
for(const p of plans){if(!p.months)assert.equal(planSavings(p,express),null);assert.ok(fs.existsSync(new URL('../assets/services/'+p.id+'.svg',import.meta.url)));}
for(const file of pages()){
 const html=fs.readFileSync(file,'utf8');assert.equal(html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0],header,file);
 assert.equal((html.match(/site-header\.css\?/g)||[]).length,1,file);assert.equal((html.match(/site-header\.js\?/g)||[]).length,1,file);
 assert.ok(!html.includes('/assets/js/navigation.js'),file);
 if(file.endsWith('clientes/index.html')||file.endsWith('clientes\\index.html'))assert.equal((html.match(/id="exit"/g)||[]).length,1);
}
console.log('PASS presentation: identical header across all pages, one shared stylesheet/controller, private logout retained, seven service illustrations, exact monthly/term savings and no invented Express/E2E discounts.');
