(()=>{
 const header=document.querySelector('.cx-site-header');if(!header)return;
 const menu=header.querySelector('details'),current=location.pathname.replace(/\/+$/,'')||'/';
 for(const a of header.querySelectorAll('a')){const path=new URL(a.href).pathname.replace(/\/+$/,'')||'/';if(!new URL(a.href).hash&&(path===current||(path!=='/'&&current.startsWith(path+'/'))))a.setAttribute('aria-current','page');}
 if(menu.querySelector('[aria-current="page"]'))menu.querySelector('summary').classList.add('is-active');
 document.addEventListener('click',e=>{if(!menu.contains(e.target))menu.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
})();
