const {chromium}=require('playwright');const path=require('path');
const S=[['menu-a-grid',800,1280],['menu-b-list',800,1280],['menu-c-featured',800,1280],['item',800,1280],['cart',800,1280],['pay',800,1280],['pay-upi',800,1280],['done',800,1280],['kitchen',1280,800],['board',1920,1080],['admin-today',390,844],['admin-orders',390,844]];
(async()=>{const b=await chromium.launch();require('fs').mkdirSync(__dirname+'/shots',{recursive:true});
for(const [n,w,h] of S){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:n.startsWith('admin')?2:1});
await p.goto('file://'+path.join(__dirname,n+'.html'));await p.waitForLoadState('networkidle');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
await p.screenshot({path:path.join(__dirname,'shots',n+'.png')});await p.close();}
await b.close();})();
