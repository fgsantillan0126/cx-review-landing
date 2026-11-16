const areas={compliance:'Cumplimiento',cx:'Experiencia de compra',technology:'Tecnología',commercial:'Calidad comercial'};
const format=new Intl.NumberFormat('es-AR',{minimumFractionDigits:1,maximumFractionDigits:1});
const search=document.querySelector('#store-search');
const status=document.querySelector('#ranking-status');
const results=document.querySelector('#ranking-results');
const node=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
function render(stores){
  results.replaceChildren();
  const query=search.value.trim().toLocaleLowerCase('es-AR');
  let previous,position;
  for(const [index,store] of stores.entries()){
    const score=format.format(store.score);
    if(previous!==score) position=index+1;
    previous=score;
    if(!store.name.toLocaleLowerCase('es-AR').includes(query))continue;
    const item=document.createElement('li');
    item.value=position;
    item.append(node('h2',store.name),node('strong',score+'/100'),node('p','80 controles · '+store.date.split('-').reverse().join('/')));
    const detail=document.createElement('details');
    const scores=document.createElement('ul');
    for(const [key,label] of Object.entries(areas))scores.append(node('li',label+' · '+format.format(store.areas[key])+'/100'));
    detail.append(node('summary','Ver puntajes por área'),scores);
    item.append(detail);
    const url=new URL(store.url);
    if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){const link=node('a','Visitar tienda');link.href=url.href;item.append(link);}
    results.append(item);
  }
  status.textContent=stores.length===0?'Todavía no hay auditorías publicadas.':results.children.length===0?'No encontramos tiendas para esta búsqueda.':'';
}
async function load(){
  try{
    const response=await fetch('/api/ranking');
    if(!response.ok)throw new Error('Ranking no disponible');
    const {stores}=await response.json();
    render(stores);
    search.disabled=false;
    search.addEventListener('input',()=>render(stores));
  }catch{results.replaceChildren();status.textContent='El ranking no está disponible en este momento. Volvé a intentar más tarde.';}
}
void load();
