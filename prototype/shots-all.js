// Renders every prototype screen to shots/ (or shots/light/ with THEME=light).
// Usage: [THEME=light] node prototype/shots-all.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const theme = process.env.THEME || 'dark';
const out = path.join(__dirname, 'shots', theme === 'light' ? 'light' : '');
const screens = [
  ['01-home', 'kiosk-home.html', 800, 1280], ['02-menu', 'kiosk-menu.html', 800, 1280], ['03-item', 'kiosk-item.html', 800, 1280],
  ['04-cart', 'kiosk-cart.html', 800, 1280], ['05-pay', 'kiosk-pay.html', 800, 1280], ['06-pay-upi', 'kiosk-pay-upi.html', 800, 1280],
  ['07-done', 'kiosk-done.html', 800, 1280], ['08-kitchen', 'kitchen.html', 1280, 800], ['09-board', 'board.html', 1920, 1080],
  ['10-board-ready', 'board.html?ready=A-042&name=Rahul', 1920, 1080],
];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  for (const [name, file, w, h] of screens) {
    if (process.argv[2] && !name.includes(process.argv[2])) continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 1500 ? 1 : 1.5 });
    const p = await ctx.newPage();
    await p.goto('file://' + path.join(__dirname, file.split('?')[0]) + (file.includes('?') ? '?' + file.split('?')[1] : '') + (theme === 'light' ? (file.includes('?') ? '&' : '?') + 'theme=light' : ''));
    await p.waitForLoadState('networkidle');
    for (const f of p.frames()) await f.evaluate(() => document.fonts.ready).catch(() => {});
    await p.waitForTimeout(name.includes('ready') ? 2600 : 500);
    await p.screenshot({ path: path.join(out, name + '.png') });
    await ctx.close();
  }
  await b.close();
})();
