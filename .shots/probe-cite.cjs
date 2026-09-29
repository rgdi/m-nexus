const { chromium } = require('/usr/local/lib/node_modules/playwright');
const API='http://localhost:4000', WEB='http://localhost:8080';
(async()=>{
  const b=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:414,height:896},isMobile:true,hasTouch:true});
  const reg=await ctx.request.post(API+'/api/v1/register',{data:{username:'c'+Date.now(),password:'d',deviceId:'cc-'+Math.random().toString(36).slice(2,8),deviceName:'c',platform:'web'}}).then(r=>r.json());
  const h={authorization:'Bearer '+reg.accessToken};
  const f=await ctx.request.post(API+'/api/v1/folders',{headers:h,data:{name:'Genética'}}).then(r=>r.json());
  await ctx.request.post(API+'/api/v1/notes',{headers:h,data:{title:'F',body:'La fibrosis quística es autosómica recesiva.\n\nEl tratamiento incluye mucolíticos.',folderId:f.id}});
  const page=await ctx.newPage();
  await page.addInitScript(a=>{localStorage.setItem('mnexus.setup.completed','1');localStorage.setItem('mnexus.setup.v1','{}');
    sessionStorage.setItem('mnexus.auth.access',a);localStorage.setItem('mnexus.auth.refresh',a);
    localStorage.setItem('mnexus.backend.url','http://localhost:4000');},reg.accessToken);
  await page.goto(WEB+'/index.html#/generate',{waitUntil:'load'});
  const t0=Date.now(); let c=0;
  while(Date.now()-t0<12000){const p=await page.evaluate(()=>!!document.querySelector('.splash'));
    if(p)c=0;else if(!c)c=Date.now();else if(Date.now()-c>700)break;await page.waitForTimeout(150);}
  await page.evaluate(()=>{const s=document.querySelector('select');if(s){const i=[...s.options].findIndex(o=>/Genética/.test(o.textContent));if(i>0)s.selectedIndex=i;s.dispatchEvent(new Event('change',{bubbles:true}));}});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(b=>/Mapa mental/.test(b.textContent||''))?.click();});
  await page.waitForTimeout(200);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(b=>/Generar/.test(b.textContent||'')&&!b.disabled)?.click();});
  await page.waitForTimeout(3000);
  const info=await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('.gen-cites').forEach(el=>{
      const cs=getComputedStyle(el), r=el.getBoundingClientRect();
      const par=el.parentElement, pcs=getComputedStyle(par);
      const ch=el.querySelector('.gen-cite'), chs=ch?getComputedStyle(ch):null, chr=ch?ch.getBoundingClientRect():null;
      out.push({citesH:r.height|0, citesDisplay:cs.display, citesAlign:cs.alignItems,
        parent:par.className, parentDisplay:pcs.display, parentDir:pcs.flexDirection,
        chipH: chr?chr.height|0:null, chipAlign: chs?chs.alignSelf:null, chipStretch: chs?chs.alignItems:null,
        parentH: par.getBoundingClientRect().height|0});
    });
    return out.slice(0,3);
  });
  console.log(JSON.stringify(info,null,1));
  await b.close();
})();
