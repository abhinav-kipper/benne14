const { chromium } = require('playwright');
(async()=>{
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:+process.argv[4]||800,height:+process.argv[5]||1280},deviceScaleFactor:1.5});
  await p.goto('file://'+require('path').resolve(process.argv[2]));
  await p.waitForLoadState('networkidle'); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(400);
  await p.screenshot({path:process.argv[3]});
  await b.close();
})();
