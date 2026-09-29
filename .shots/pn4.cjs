const { chromium } = require('/usr/local/lib/node_modules/playwright');
const API='http://localhost:4000', WEB='http://localhost:8080';
(async()=>{
  const b=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:414,height:896},isMobile:true,hasTouch:true,deviceScaleFactor:2,colorScheme:'light'});
  const reg=await ctx.request.post(API+'/api/v1/register',{data:{username:'w'+Date.now(),password:'d',deviceId:'ww-'+Math.random().toString(36).slice(2,8),deviceName:'w',platform:'web'}}).then(r=>r.json());
  const h={authorization:'Bearer '+reg.accessToken};
  for (const t of ['Fibrosis quística','Herencia mendeliana','Cromosomas'])
    await ctx.request.post(API+'/api/v1/notes',{headers:h,data:{title:t,body:'x',subject:'bio'}});
  const page=await ctx.newPage();
  await page.addInitScript(a=>{localStorage.setItem('mnexus.setup.completed','1');localStorage.setItem('mnexus.setup.v1','{}');
    sessionStorage.setItem('mnexus.auth.access',a);localStorage.setItem('mnexus.auth.refresh',a);
    localStorage.setItem('mnexus.theme','dark');localStorage.setItem('mnexus.backend.url','http://localhost:4000');},reg.accessToken);
  await page.goto(WEB+'/index.html#/notes',{waitUntil:'load'});
  const t0=Date.now(); let c=0;
  while(Date.now()-t0<12000){const p=await page.evaluate(()=>!!document.querySelector('.splash'));
    if(p)c=0;else if(!c)c=Date.now();else if(Date.now()-c>700)break;await page.waitForTimeout(150);}
  await page.waitForTimeout(1800);
  const v=await page.evaluate(()=>{
    const t=document.querySelector('.notes-tree');
    const n=document.querySelector('.note-name');
    return { theme:document.documentElement.getAttribute('data-theme'),
      treeBg:getComputedStyle(t).backgroundColor, nameColor:getComputedStyle(n).color,
      nameText:n.textContent.trim().slice(0,24) };
  });
  console.log(JSON.stringify(v));
  await page.screenshot({path:'screenshots/v2381/07-notas.png'});
  await b.close();
})();
