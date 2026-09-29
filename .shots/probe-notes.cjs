const { chromium } = require('/usr/local/lib/node_modules/playwright');
const API='http://localhost:4000', WEB='http://localhost:8080';
(async()=>{
  const b=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:414,height:896},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const reg=await ctx.request.post(API+'/api/v1/register',{data:{username:'n'+Date.now(),password:'d',deviceId:'nn-'+Math.random().toString(36).slice(2,8),deviceName:'n',platform:'web'}}).then(r=>r.json());
  const h={authorization:'Bearer '+reg.accessToken};
  for (const t of ['Fibrosis quística','Herencia mendeliana','Cromosomas'])
    await ctx.request.post(API+'/api/v1/notes',{headers:h,data:{title:t,body:'contenido de '+t,subject:'bio'}});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,70)));
  await page.addInitScript(a=>{localStorage.setItem('mnexus.setup.completed','1');localStorage.setItem('mnexus.setup.v1','{}');
    sessionStorage.setItem('mnexus.auth.access',a);localStorage.setItem('mnexus.auth.refresh',a);
    localStorage.setItem('mnexus.backend.url','http://localhost:4000');},reg.accessToken);
  await page.goto(WEB+'/index.html#/notes',{waitUntil:'load'});
  const t0=Date.now(); let c=0;
  while(Date.now()-t0<12000){const p=await page.evaluate(()=>!!document.querySelector('.splash'));
    if(p)c=0;else if(!c)c=Date.now();else if(Date.now()-c>700)break;await page.waitForTimeout(150);}
  await page.waitForTimeout(1500);
  const info=await page.evaluate(()=>{
    const imgs=[...document.querySelectorAll('img')].map(i=>({src:(i.getAttribute('src')||'').slice(0,50),ok:i.complete&&i.naturalWidth>0}));
    const titles=[...document.querySelectorAll('[class*=note] , [class*=card]')].slice(0,6).map(e=>({c:e.className.toString().slice(0,30),t:(e.textContent||'').trim().slice(0,40)}));
    return {theme:document.documentElement.getAttribute('data-theme'), imgs:imgs.slice(0,4), nImg:imgs.length, titles,
      bodyTxt:document.body.innerText.slice(0,180)};
  });
  console.log(JSON.stringify(info,null,1));
  console.log('errores:', errs.length, errs.slice(0,2));
  await b.close();
})();
