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
  // Sync marks: wall-clock moments that are also painted into the video (stage.mark), so audio can be
  // placed by where things actually appear in the recording, not by the wall clock.
  const marks = [];
  let markN = 0;
  const markNow = async () => { const n = ++markN; const c = await st('mark', n); marks.push({ n, wall: (Date.now() - t0) / 1000, c }); };
  const beat = setInterval(() => { markNow().catch(() => {}); }, 600);
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
  await caption(1, 'Walk in.<br>Tap takeaway.', 'ग्राहक आया, टेकअवे चुना।', 'One tap on the home screen starts the order.');
  await st('show', 'kiosk', '../kiosk-home.html');
  await sleep(300);
  scene('01');
  await sleep(2000);
  await settle();
  await tap(`d.querySelector('.choice.take')`);
  await st('go', '../kiosk-menu.html?cart=empty');

  // 02 Menu
  await caption(2, 'Pick<br>a dosa', 'मेन्यू देखिए, डोसा चुनिए।', 'Real dishes, launch prices and a homely line about each one.');
  await sleep(300);
  scene('02');
  await sleep(2600);
  await settle();
  await tap(`d.querySelector('.hero h1')`);
  await st('go', '../kiosk-item.html', `
    const a = d.querySelectorAll('.addon')[0]; a.classList.remove('on'); a.querySelector('.box').textContent = '';
    d.querySelectorAll('.note').forEach(n => n.classList.remove('on'));
    d.querySelector('.btn-benne .amt').textContent = '₹171';`);

  // 03 Customise
  await caption(3, 'Make it<br>yours', 'अपने हिसाब से बनवाइए।', 'Spice level, extra benne, a note for the kitchen and a coffee on the side.');
  await sleep(300);
  scene('03');
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
  await caption(4, 'Check<br>the order', 'ऑर्डर एक बार देख लीजिए।', 'One more coffee is one tap. GST bill and launch savings, upfront.');
  await sleep(300);
  scene('04');
  await sleep(1800);
  await tap(`d.querySelectorAll('.line')[1].querySelector('.step button:last-child')`, `w.demo.coffee(2)`);
  await sleep(1600);
  await settle();
  await tap(`d.querySelector('.foot .btn-benne')`);
  await st('go', '../kiosk-pay.html');

  // 05 Pay
  await caption(5, 'Pay the<br>Indian way', 'UPI से पेमेंट, सबसे आसान।', 'UPI first. Card on the counter machine. Cash at the counter.');
  await sleep(300);
  scene('05');
  await sleep(2400);
  await settle();
  await tap(`d.querySelector('.tile.upi')`);
  await st('go', '../kiosk-pay-upi.html');

  // 06 Scan
  await caption(6, 'Scan<br>&amp; pay', 'फ़ोन से स्कैन, पेमेंट पूरा।', 'Any UPI app. Amount locked in the QR. (Demo: no real money moves.)');
  await sleep(300);
  scene('06');
  await st('hideFinger');
  await sleep(3400);
  await settle();
  sfx('paid', 0.25);
  await st('go', '../kiosk-done.html');

  // 07 Token
  await caption(7, 'Token<br>A-042', 'शुक्रिया राहुल, डोसा तवे पर है।', 'A big paper-style token, live tracking and the bill on the phone.');
  await sleep(300);
  scene('07');
  await sleep(3800);
  await settle();

  // 08 Kitchen
  await caption(8, 'Straight to<br>the kitchen', 'रसोई में तुरंत पहुँचा।', 'Hindi chits on a rail. One tap to start, one tap when it is ready.');
  await st('show', 'kitchen', '../kitchen.html?video=1');
  await sleep(300);
  scene('08');
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
  await caption(9, 'Rahul,<br>it’s ready!', 'टीवी पर टोकन आया, खाना हाज़िर।', 'The order board calls the token and the name.');
  await st('show', 'board', '../board.html');
  await sleep(300);
  scene('09');
  await sleep(1400);
  sfx('pop', 0.1);
  await inFrame(`w.demo.ready('A-042', 'Rahul')`);
  await sleep(4000);
  await settle();

  // 10 End card: the corner logo grows back into the centre
  sfx('whoosh', 0.05);
  await st('card', true, `<div class="w">Benne <i>14</i></div><div class="t">Kiosk · Kitchen · Order board</div><div class="h">गरमा-गरम, सीधे तवे से आपकी प्लेट तक।</div><div class="s">Prototype. Next up: owner app for prices and sold-out items.</div>`);
  await sleep(300);
  scene('10');
  await sleep(3200);
  await settle();
  await sleep(1500);

  clearInterval(beat);
  await markNow();
  const total = (Date.now() - t0) / 1000;
  const video = page.video();
  await context.close();
  await browser.close();
  server.kill();

  const webm = await video.path();

  // Find each mark's first frame in the recording, then map wall-clock times to video times.
  const times = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', webm])
    .toString().trim().split('\n').map(Number);
  const px = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', webm, '-vf', 'crop=100:10:1820:1070,scale=10:1:flags=area', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
  const firstFrame = new Map();
  for (let j = 0; j < times.length; j++) {
    const cell = (i) => px[j * 10 + i] > 128;
    if (!cell(0)) continue;
    let n = 0; for (let i = 1; i < 10; i++) if (cell(i)) n |= 1 << (i - 1);
    if (!firstFrame.has(n)) firstFrame.set(n, times[j]);
  }
  const pairs = marks.sort((a, b) => a.n - b.n).filter((m) => firstFrame.has(m.n)).map((m) => [m.wall, firstFrame.get(m.n)]);
  fs.writeFileSync(path.join(OUT, 'sync.json'), JSON.stringify({ marks, pairs }, null, 1));
  // The recorder stretches still moments, so re-time the video back to the wall clock: build a
  // piecewise-linear video→wall map from the marks (simplified) and apply it with setpts.
  const mono = pairs.filter((p, i) => i === 0 || (p[0] > pairs[i - 1][0] && p[1] > pairs[i - 1][1]));
  const simplify = (pts, eps) => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let worst = 0, at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const w = a[0] + (pts[i][1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (Math.abs(w - pts[i][0]) > worst) { worst = Math.abs(w - pts[i][0]); at = i; }
    }
    return worst > eps ? [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)] : [a, b];
  };
  const knots = simplify(mono, 0.04);
  let expr = `(${knots[knots.length - 1][0].toFixed(3)}+(T-${knots[knots.length - 1][1].toFixed(3)}))`;
  for (let i = knots.length - 1; i >= 1; i--) {
    const [w0, v0] = knots[i - 1], [w1, v1] = knots[i];
    expr = `if(lt(T,${v1.toFixed(3)}),${w0.toFixed(3)}+(T-${v0.toFixed(3)})*${((w1 - w0) / (v1 - v0)).toFixed(5)},${expr})`;
  }
  expr = `if(lt(T,${knots[0][1].toFixed(3)}),T+${(knots[0][0] - knots[0][1]).toFixed(3)},${expr})`;
  const retime = `setpts='max(0,${expr})/TB',fps=25`;
  const drift = mono.map((p) => p[1] - p[0]);
  console.log(`sync: ${mono.length}/${marks.length} marks, ${knots.length} knots; recorder stretch ${Math.min(...drift).toFixed(2)}s … ${Math.max(...drift).toFixed(2)}s, re-timed to wall clock`);
  // Audio events stay on the wall clock, which the re-timed video now shares.
  const total_v = total;
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
      const vt = total_v + 2.5;
      parts.push(`[${i}:a]atrim=0:${vt.toFixed(2)},volume=${BED_GAIN},afade=t=in:d=1.5,afade=t=out:st=${(vt - 3).toFixed(2)}:d=3[bedraw]`);
      parts.push(`[bedraw][key]sidechaincompress=threshold=0.02:ratio=5:attack=30:release=400[bed]`);
      out += '[bed]'; n++;
    } else parts.push('[key]anullsink');
    parts.push(`${out}amix=inputs=${n}:normalize=0:duration=longest,alimiter=limit=0.95[a]`);
    // Playwright drops the last moment of video on close; hold the final frame so the last line finishes.
    parts.push(`[0:v]${retime},drawbox=x=1818:y=1068:w=102:h=12:color=0x0B0B09:t=fill,tpad=stop_mode=clone:stop_duration=2.5[v]`);
    args.push('-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  else args.push('-vf', `${retime},drawbox=x=1818:y=1068:w=102:h=12:color=0x0B0B09:t=fill`);
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  execFileSync('ffmpeg', args);
  fs.unlinkSync(webm);
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ timeline, fx }, null, 2));
  console.log(mp4, clips.length ? `(with ${clips.length} voice clips)` : '(no voiceover)');
})();
