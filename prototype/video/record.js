// Records the prototype walkthrough video.
// Usage: node prototype/video/record.js   (needs Playwright + Chromium; ffmpeg for the mp4)
// Output: prototype/video/out/benne14-walkthrough.mp4
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const PORT = 8714;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(800);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/prototype/video/stage.html`);
  await page.evaluate(() => document.fonts.ready);

  const st = (fn, ...args) => page.evaluate(([fn, args]) => window.stage[fn](...args), [fn, args]);
  const inFrame = (code) => page.evaluate((code) => new Function('d', 'w', code)(stage.doc(), stage.win()), code);
  // Tap the element returned by `pick` (code run with d = device document), then run `then` in the device.
  const tap = async (pick, then) => {
    const pt = await inFrame(`const el = (${pick}); const r = el.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2];`);
    await st('tap', pt[0], pt[1]);
    if (then) await inFrame(then);
  };

  // Title card
  await sleep(3200);
  await st('card', false);
  await sleep(500);

  // 1. Home
  await st('caption', 1, 'Walk in.<br>Tap takeaway.', 'ग्राहक आया, टेकअवे चुना।', 'One tap on the home screen starts the order.');
  await st('show', 'kiosk', '../kiosk-home.html');
  await sleep(2200);
  await tap(`d.querySelector('.choice.take')`);
  await st('go', '../kiosk-menu.html?cart=empty');

  // 2. Menu
  await st('caption', 2, 'Pick a dosa', 'मेन्यू देखिए, डोसा चुनिए।', 'Real dishes, launch prices and a homely line about each one.');
  await sleep(2600);
  await tap(`d.querySelector('.hero h1')`);
  await st('go', '../kiosk-item.html', `
    const a = d.querySelectorAll('.addon')[0]; a.classList.remove('on'); a.querySelector('.box').textContent = '';
    d.querySelectorAll('.note').forEach(n => n.classList.remove('on'));
    d.querySelector('.btn-benne .amt').textContent = '₹171';`);

  // 3. Customise
  await st('caption', 3, 'Make it yours', 'अपने हिसाब से बनवाइए।', 'Spice level, extra benne, a note for the kitchen and a coffee on the side.');
  await sleep(1600);
  await tap(`d.querySelectorAll('.addon')[0]`, `const a = d.querySelectorAll('.addon')[0]; a.classList.add('on'); a.querySelector('.box').textContent = '✓'; d.querySelector('.btn-benne .amt').textContent = '₹196';`);
  await sleep(500);
  await tap(`d.querySelectorAll('.note')[1]`, `d.querySelectorAll('.note')[1].classList.add('on')`);
  await sleep(300);
  await tap(`d.querySelectorAll('.note')[5]`, `d.querySelectorAll('.note')[5].classList.add('on')`);
  await sleep(500);
  await tap(`d.querySelector('.pair .add')`, `const b = d.querySelector('.pair .add'); b.textContent = '✓'; b.style.background = 'var(--benne)'; b.style.color = 'var(--benne-ink)'; d.querySelector('.btn-benne .amt').textContent = '₹255';`);
  await sleep(900);
  await tap(`d.querySelector('.btn-benne')`);
  await st('go', '../kiosk-menu.html?cart=empty');
  await sleep(300);
  await inFrame(`w.demo.set({ 'ghee-podi-benne-dosa': 1, 'filter-coffee': 1 }, 255)`);
  await sleep(1500);
  await tap(`d.querySelector('.cartbar')`);
  await st('go', '../kiosk-cart.html?coffee=1');

  // 4. Cart
  await st('caption', 4, 'Check the order', 'ऑर्डर एक बार देख लीजिए।', 'One more coffee is one tap. GST bill and launch savings, upfront.');
  await sleep(2200);
  await tap(`d.querySelectorAll('.line')[1].querySelector('.step button:last-child')`, `w.demo.coffee(2)`);
  await sleep(1800);
  await tap(`d.querySelector('.foot .btn-benne')`);
  await st('go', '../kiosk-pay.html');

  // 5. Pay
  await st('caption', 5, 'Pay the Indian way', 'UPI से पेमेंट, सबसे आसान।', 'UPI first. Card on the counter machine. Cash at the counter.');
  await sleep(2600);
  await tap(`d.querySelector('.tile.upi')`);
  await st('go', '../kiosk-pay-upi.html');

  // 6. Scan
  await st('caption', 6, 'Scan & pay', 'फ़ोन से स्कैन, पेमेंट पूरा।', 'Any UPI app. Amount locked in the QR. (Demo: no real money moves.)');
  await st('hideFinger');
  await sleep(3800);
  await st('go', '../kiosk-done.html');

  // 7. Token
  await st('caption', 7, 'Token A-042', 'शुक्रिया राहुल, डोसा तवे पर है।', 'A big paper-style token, live tracking and the bill on the phone.');
  await sleep(4200);

  // 8. Kitchen
  await st('caption', 8, 'Straight to<br>the kitchen', 'रसोई में तुरंत पहुँचा।', 'Hindi chits on a rail. One tap to start, one tap when it is ready.');
  await st('show', 'kitchen', '../kitchen.html?video=1');
  await sleep(1300);
  await inFrame(`w.demo.arrive()`);
  await sleep(2200);
  await tap(`d.querySelector('#c042 .go')`, `w.demo.start()`);
  await sleep(1800);
  await tap(`d.querySelector('#c042 .go')`, `w.demo.ready()`);
  await sleep(2400);
  await st('hideFinger');

  // 9. TV board
  await st('caption', 9, 'Rahul, it’s ready!', 'टीवी पर टोकन आया, खाना हाज़िर।', 'The order board calls the token and the name.');
  await st('show', 'board', '../board.html');
  await sleep(1800);
  await inFrame(`w.demo.ready('A-042', 'Rahul')`);
  await sleep(4600);

  // End card
  await st('card', true, `<div class="w">Benne <i>14</i></div><div class="t">Kiosk · Kitchen · Order board</div><div class="h">गरमा-गरम, सीधे तवे से आपकी प्लेट तक।</div><div class="s">Prototype. Next up: owner app for prices and sold-out items.</div>`);
  await sleep(3800);

  const video = page.video();
  await context.close();
  await browser.close();
  server.kill();

  const webm = await video.path();
  const mp4 = path.join(OUT, 'benne14-walkthrough.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  fs.unlinkSync(webm);
  console.log(mp4);
})();
