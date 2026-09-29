const { chromium } = require('/usr/local/lib/node_modules/playwright');
const API='http://localhost:4000', WEB='http://localhost:8080';
(async()=>{
  const b=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:414,height:896},isMobile:true,hasTouch:true});
  const reg=await ctx.request.post(API+'/api/v1/register',{data:{username:'f'+Date.now(),password:'d',deviceId:'ff-'+Math.random().toString(36).slice(2,8),deviceName:'f',platform:'web'}}).then(r=>r.json());
  const h={authorization:'Bearer '+reg.accessToken};
  const g=await ctx.request.post(API+'/api/v1/folders',{headers:h,data:{name:'Genetica'}}).then(r=>r.json());
  const c=await ctx.request.post(API+'/api/v1/folders',{headers:h,data:{name:'Cardiologia'}}).then(r=>r.json());
  await ctx.request.post(API+'/api/v1/notes',{headers:h,data:{title:'Fibrosis',body:'La fibrosis quistica se debe al gen CFTR.',folderId:g.id}});
  await ctx.request.post(API+'/api/v1/notes',{headers:h,data:{title:'Ciclo',body:'El ciclo cardiaco tiene sístole y diastole.',folderId:c.id}});
  const page=await ctx.newPage();
  await page.addInitScript(a=>{localStorage.setItem('mnexus.setup.completed','1');localStorage.setItem('mnexus.setup.v1','{}');
    sessionStorage.setItem('mnexus.auth.access',a);localStorage.setItem('mnexus.auth.refresh',a);
    localStorage.setItem('mnexus.backend.url','http://localhost:4000');},reg.accessToken);
  const sent=[];
  page.on('request', r=>{ if(r.url().includes('/resources/generate')) sent.push(r.postData()); });
  await page.goto(WEB+'/index.html#/generate',{waitUntil:'load'});
  const t0=Date.now(); let cl=0;
  while(Date.now()-t0<12000){const p=await page.evaluate(()=>!!document.querySelector('.splash'));
    if(p)cl=0;else if(!cl)cl=Date.now();else if(Date.now()-cl>700)break;await page.waitForTimeout(150);}
  const opts=await page.evaluate(()=>[...document.querySelectorAll('select option')].map(o=>o.textContent.trim()+'='+o.value));
  console.log('opciones:', JSON.stringify(opts));
  // seleccion real como un usuario
  await page.selectOption('select', { index: 1 });
  await page.waitForTimeout(600);
  const sel=await page.evaluate(()=>{const s=document.querySelector('select');return s?{v:s.value, txt:s.options[s.selectedIndex].textContent.trim()}:null;});
  console.log('seleccionado:', JSON.stringify(sel));
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(b=>/Mapa mental/.test(b.textContent||''))?.click();});
  await page.waitForTimeout(200);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(b=>/Generar/.test(b.textContent||'')&&!b.disabled)?.click();});
  await page.waitForTimeout(3000);
  console.log('peticiones enviadas:', JSON.stringify(sent));
  await b.close();
})();
