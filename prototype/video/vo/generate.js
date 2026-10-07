// Generates the Hindi voiceover clips with ElevenLabs.
// Usage: ELEVENLABS_API_KEY=... node prototype/video/vo/generate.js
// Optional: ELEVENLABS_VOICE_ID (a voice in your library), ELEVENLABS_MODEL (default eleven_multilingual_v2).
// Writes NN.mp3 per scene and durations.json next to this file; record.js then times scenes to the clips.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('Set ELEVENLABS_API_KEY first.'); process.exit(1); }
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const DIR = __dirname;
const API = 'https://api.elevenlabs.io';
const H = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

async function api(p, opts = {}) {
  const r = await fetch(API + p, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${p} → ${r.status} ${await r.text()}`);
  return r;
}

// Pick a warm native Hindi female voice from the shared library and add it to the account.
async function pickVoice() {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  const q = new URLSearchParams({ language: 'hi', gender: 'female', page_size: '30', sort: 'trending' });
  const { voices = [] } = await (await api(`/v1/shared-voices?${q}`)).json();
  const score = (v) => {
    const t = `${v.name} ${v.description} ${v.descriptive} ${v.use_case} ${v.accent}`.toLowerCase();
    return ['warm', 'friendly', 'cheer', 'conversational', 'young', 'sweet', 'soft', 'natural', 'hindi'].filter((w) => t.includes(w)).length
      + (v.accent && /hindi|indian|delhi/i.test(v.accent) ? 2 : 0);
  };
  voices.sort((a, b) => score(b) - score(a));
  const v = voices[0];
  if (!v) throw new Error('No Hindi voices found; set ELEVENLABS_VOICE_ID.');
  console.log(`Voice: ${v.name} (${v.voice_id}) — ${v.descriptive || ''} ${v.accent || ''}`);
  try {
    await api(`/v1/voices/add/${v.public_owner_id}/${v.voice_id}`, { method: 'POST', body: JSON.stringify({ new_name: `Benne14 VO — ${v.name}` }) });
  } catch (e) { if (!/already/i.test(String(e))) console.warn('Could not add voice to library:', String(e).slice(0, 200)); }
  return v.voice_id;
}

(async () => {
  const { lines } = JSON.parse(fs.readFileSync(path.join(DIR, 'script.json'), 'utf8'));
  const voice = await pickVoice();
  const keys = Object.keys(lines).sort();
  const durations = {};
  for (const [i, k] of keys.entries()) {
    const body = {
      text: lines[k],
      model_id: MODEL,
      previous_text: i ? lines[keys[i - 1]] : undefined,
      next_text: lines[keys[i + 1]],
      voice_settings: { stability: 0.38, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true, speed: 1.0 },
    };
    const r = await api(`/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, { method: 'POST', body: JSON.stringify(body) });
    const file = path.join(DIR, `${k}.mp3`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    durations[k] = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
    console.log(`${k}  ${durations[k].toFixed(2)}s  ${lines[k]}`);
  }
  fs.writeFileSync(path.join(DIR, 'durations.json'), JSON.stringify({ voice, model: MODEL, durations }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
