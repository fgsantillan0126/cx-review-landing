import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export const header=`<header class="site-header cx-site-header">
  <a class="brand" href="/" aria-label="CX-Review, inicio"><img src="/assets/logo-cx-review.png" alt="CX-Review" width="160" height="49"></a>
  <nav class="main-nav" aria-label="Navegación principal">
    <details class="cx-about-menu"><summary>Conocenos <span aria-hidden="true">⌄</span></summary><div class="cx-about-links"><a href="/nosotros/">Quiénes somos</a><a href="/areas/">Qué evaluamos</a><a href="/metodologia/">Cómo trabajamos</a><a href="/#blog">Blog</a></div></details>
    <a href="/planes/">Planes</a><a href="/ranking/">Ranking</a><a href="/clientes/">Clientes</a>
  </nav>
  <a class="header-link" href="/contacto/">Contacto</a>
</header>`;
export function pages(dir=root){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name.startsWith('.')||['node_modules','scripts','tests'].includes(e.name)?[]:e.isDirectory()?pages(path.join(dir,e.name)):e.name.endsWith('.html')?[path.join(dir,e.name)]:[]);}
if(process.argv[1]===fileURLToPath(import.meta.url))for(const file of pages()){
 let html=fs.readFileSync(file,'utf8');
 if(!/<header\b/.test(html))continue;
 if(file===path.join(root,'clientes','index.html')&&html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0].includes('id="exit"'))html=html.replace('<main class="client-shell">','<main class="client-shell"><div class="client-session-actions"><button id="exit" hidden>Cerrar acceso</button></div>');
 html=html.replace(/<header\b[^>]*>[\s\S]*?<\/header>/,header);
 html=html.replace(/<link[^>]+href="\/assets\/site-header\.css[^"\s]*"[^>]*>/g,'').replace(/<script[^>]+src="\/assets\/(?:js\/navigation|site-header)\.js[^"\s]*"[^>]*>\s*<\/script>/g,'');
 html=html.replace('</head>','<link rel="stylesheet" href="/assets/site-header.css?v=20261124-2"><script src="/assets/site-header.js?v=20261124-2" defer></script></head>');
 fs.writeFileSync(file,html);
}
