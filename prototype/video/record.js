// Records the prototype walkthrough video.
// Usage: node prototype/video/record.js   (needs Playwright + Chromium, and ffmpeg)
// If prototype/video/vo/durations.json exists (from vo/generate.js), every scene waits for its
// voiceover line and the clips are mixed into the final mp4.
// Output: prototype/video/out/benne14-walkthrough.mp4
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const VO = path.join(__dirname, 'vo');
const PORT = 8714;
const VO_LEAD = 0.35;   // seconds between a scene starting and its line starting
const VO_TAIL = 0.5;    // breathing room after a line before the scene moves on
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sound effects (vo/sfx/*.mp3, made with ElevenLabs sound generation) and their mix levels.
const SFX_GAIN = { tap: 0.4, whoosh: 0.12, paid: 0.35, ding: 0.9, sizzle: 0.22, ready: 0.5, pop: 1.3 };
const BED_GAIN = 0.14;

let vo = null;
try { vo = JSON.parse(fs.readFileSync(path.join(VO, 'durations.json'), 'utf8')).durations; } catch {}

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
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/prototype/video/stage.html`);
  await page.evaluate(() => document.fonts.ready);

  const st = (fn, ...args) => page.evaluate(([fn, args]) => window.stage[fn](...args), [fn, args]);
  const inFrame = (code) => page.evaluate((code) => new Function('d', 'w', code)(stage.doc(), stage.win()), code);
  // Tap the element returned by `pick` (code run with d = device document), then run `then` in the device.
  const fx = [];
  const sfx = (name, delay = 0) => fx.push({ name, at: (Date.now() - t0) / 1000 + delay });
  const tap = async (pick, then, sound) => {
    const pt = await inFrame(`const el = (${pick}); const r = el.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2];`);
    sfx('tap', 0.62);
    if (sound) sfx(sound, 0.7);
    await st('tap', pt[0], pt[1]);
    if (then) await inFrame(then);
  };

  // Scene bookkeeping: `scene(id)` marks where a voice line starts; `settle()` waits until it has finished.
  const timeline = [];
  let cur = null;
  const scene = (id) => { cur = { id, t: Date.now() }; timeline.push({ id, at: (cur.t - t0) / 1000 + VO_LEAD }); };
  const settle = async () => {
    if (!vo || !cur || !vo[cur.id]) return;
    const need = (VO_LEAD + vo[cur.id] + VO_TAIL) * 1000 - (Date.now() - cur.t);
    if (need > 0) await sleep(need);
  };
  const caption = (n, en, hi, sub) => st('caption', n, en, hi, sub);

  // 00 Title card, then it shrinks into the corner logo
  scene('00');
  await sleep(3000);
  await settle();
  sfx('whoosh', 0.05);
  await st('card', false);

  // 01 Home
  scene('01');
  await caption(1, 'Walk in.<br>Tap takeaway.', 'ग्राहक आया, टेकअवे चुना।', 'One tap on the home screen starts the order.');
  await st('show', 'kiosk', '../kiosk-home.html');
  await sleep(2000);
  await settle();
  await tap(`d.querySelector('.choice.take')`);
  await st('go', '../kiosk-menu.html?cart=empty');

  // 02 Menu
  scene('02');
  await caption(2, 'Pick<br>a dosa', 'मेन्यू देखिए, डोसा चुनिए।', 'Real dishes, launch prices and a homely line about each one.');
  await sleep(2600);
  await settle();
  await tap(`d.querySelector('.hero h1')`);
  await st('go', '../kiosk-item.html', `
    const a = d.querySelectorAll('.addon')[0]; a.classList.remove('on'); a.querySelector('.box').textContent = '';
    d.querySelectorAll('.note').forEach(n => n.classList.remove('on'));
    d.querySelector('.btn-benne .amt').textContent = '₹171';`);

  // 03 Customise
  scene('03');
  await caption(3, 'Make it<br>yours', 'अपने हिसाब से बनवाइए।', 'Spice level, extra benne, a note for the kitchen and a coffee on the side.');
  await sleep(1200);
  await tap(`d.querySelectorAll('.addon')[0]`, `const a = d.querySelectorAll('.addon')[0]; a.classList.add('on'); a.querySelector('.box').textContent = '✓'; d.querySelector('.btn-benne .amt').textContent = '₹196';`);
  await sleep(500);
  await tap(`d.querySelectorAll('.note')[1]`, `d.querySelectorAll('.note')[1].classList.add('on')`);
  await sleep(300);
  await tap(`d.querySelectorAll('.note')[5]`, `d.querySelectorAll('.note')[5].classList.add('on')`);
  await sleep(500);
  await tap(`d.querySelector('.pair .add')`, `const b = d.querySelector('.pair .add'); b.textContent = '✓'; b.style.background = 'var(--benne)'; b.style.color = 'var(--benne-ink)'; d.querySelector('.btn-benne .amt').textContent = '₹255';`);
  await sleep(700);
  await settle();
  await tap(`d.querySelector('.btn-benne')`);
  await st('go', '../kiosk-menu.html?cart=empty');
  await sleep(300);
  await inFrame(`w.demo.set({ 'ghee-podi-benne-dosa': 1, 'filter-coffee': 1 }, 255)`);
  await sleep(1300);
  await tap(`d.querySelector('.cartbar')`);
  await st('go', '../kiosk-cart.html?coffee=1');

  // 04 Cart
  scene('04');
  await caption(4, 'Check<br>the order', 'ऑर्डर एक बार देख लीजिए।', 'One more coffee is one tap. GST bill and launch savings, upfront.');
  await sleep(1800);
  await tap(`d.querySelectorAll('.line')[1].querySelector('.step button:last-child')`, `w.demo.coffee(2)`);
  await sleep(1600);
  await settle();
  await tap(`d.querySelector('.foot .btn-benne')`);
  await st('go', '../kiosk-pay.html');

  // 05 Pay
  scene('05');
  await caption(5, 'Pay the<br>Indian way', 'UPI से पेमेंट, सबसे आसान।', 'UPI first. Card on the counter machine. Cash at the counter.');
  await sleep(2400);
  await settle();
  await tap(`d.querySelector('.tile.upi')`);
  await st('go', '../kiosk-pay-upi.html');

  // 06 Scan
  scene('06');
  await caption(6, 'Scan<br>&amp; pay', 'फ़ोन से स्कैन, पेमेंट पूरा।', 'Any UPI app. Amount locked in the QR. (Demo: no real money moves.)');
  await st('hideFinger');
  await sleep(3400);
  await settle();
  sfx('paid', 0.25);
  await st('go', '../kiosk-done.html');

  // 07 Token
  scene('07');
  await caption(7, 'Token<br>A-042', 'शुक्रिया राहुल, डोसा तवे पर है।', 'A big paper-style token, live tracking and the bill on the phone.');
  await sleep(3800);
  await settle();

  // 08 Kitchen
  scene('08');
  await caption(8, 'Straight to<br>the kitchen', 'रसोई में तुरंत पहुँचा।', 'Hindi chits on a rail. One tap to start, one tap when it is ready.');
  await st('show', 'kitchen', '../kitchen.html?video=1');
  await sleep(900);
  sfx('ding', 0.15);
  await inFrame(`w.demo.arrive()`);
  await sleep(1900);
  await tap(`d.querySelector('#c042 .go')`, `w.demo.start()`, 'sizzle');
  await sleep(1500);
  await tap(`d.querySelector('#c042 .go')`, `w.demo.ready()`, 'ready');
  await sleep(1800);
  await st('hideFinger');
  await settle();

  // 09 TV board
  scene('09');
  await caption(9, 'Rahul,<br>it’s ready!', 'टीवी पर टोकन आया, खाना हाज़िर।', 'The order board calls the token and the name.');
  await st('show', 'board', '../board.html');
  await sleep(1400);
  sfx('pop', 0.1);
  await inFrame(`w.demo.ready('A-042', 'Rahul')`);
  await sleep(4000);
  await settle();

  // 10 End card: the corner logo grows back into the centre
  scene('10');
  sfx('whoosh', 0.05);
  await st('card', true, `<div class="w">Benne <i>14</i></div><div class="t">Kiosk · Kitchen · Order board</div><div class="h">गरमा-गरम, सीधे तवे से आपकी प्लेट तक।</div><div class="s">Prototype. Next up: owner app for prices and sold-out items.</div>`);
  await sleep(3200);
  await settle();
  await sleep(1500);

  const total = (Date.now() - t0) / 1000;
  const video = page.video();
  await context.close();
  await browser.close();
  server.kill();

  const webm = await video.path();
  const mp4 = path.join(OUT, 'benne14-walkthrough.mp4');
  const args = ['-y', '-loglevel', 'error', '-i', webm];
  const clips = vo ? timeline.filter((s) => vo[s.id] && fs.existsSync(path.join(VO, `${s.id}.mp3`))) : [];
  if (clips.length) {
    // inputs: 1..n voice clips, then one input per sound effect, then the looping music bed
    const parts = [], voL = [], fxL = [];
    let i = 1;
    for (const c of clips) { args.push('-i', path.join(VO, `${c.id}.mp3`)); parts.push(`[${i}:a]adelay=${Math.round(c.at * 1000)}:all=1[v${i}]`); voL.push(`[v${i}]`); i++; }
    for (const e of fx) {
      const f = path.join(VO, 'sfx', `${e.name}.mp3`); if (!fs.existsSync(f)) continue;
      args.push('-i', f); parts.push(`[${i}:a]volume=${SFX_GAIN[e.name] ?? 0.5},adelay=${Math.round(e.at * 1000)}:all=1[f${i}]`); fxL.push(`[f${i}]`); i++;
    }
    const bed = path.join(VO, 'sfx', 'bed.mp3');
    parts.push(`${voL.join('')}amix=inputs=${voL.length}:normalize=0,asplit=2[vo][key]`);
    let out = `[vo]`, n = 1;
    if (fxL.length) { parts.push(`${fxL.join('')}amix=inputs=${fxL.length}:normalize=0[fx]`); out += '[fx]'; n++; }
    if (fs.existsSync(bed)) {
      args.push('-stream_loop', '-1', '-i', bed);
      parts.push(`[${i}:a]atrim=0:${total.toFixed(2)},volume=${BED_GAIN},afade=t=in:d=1.5,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[bedraw]`);
      parts.push(`[bedraw][key]sidechaincompress=threshold=0.02:ratio=5:attack=30:release=400[bed]`);
      out += '[bed]'; n++;
    } else parts.push('[key]anullsink');
    parts.push(`${out}amix=inputs=${n}:normalize=0:duration=longest,alimiter=limit=0.95[a]`);
    // Playwright drops the last moment of video on close; hold the final frame so the last line finishes.
    parts.push('[0:v]tpad=stop_mode=clone:stop_duration=2.5[v]');
    args.push('-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  execFileSync('ffmpeg', args);
  fs.unlinkSync(webm);
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ timeline, fx }, null, 2));
  console.log(mp4, clips.length ? `(with ${clips.length} voice clips)` : '(no voiceover)');
})();
