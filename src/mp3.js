// ---------- המרה ל-MP3 ----------
// יוטיוב לא מגיש MP3 בכלל. הדרך היחידה היא לפענח את ה-AAC ולקודד מחדש,
// ולכן – בניגוד למיזוג הווידאו – כאן כן יש אובדן איכות וכן לוקח זמן.
// הפענוח ב-WebAudio (מובנה בדפדפן), הקידוד ב-lamejs.

const MP3_RATES = [128, 192, 256, 320];
const MP3_DEFAULT_KBPS = 320;
// קצב הסיביות מההגדרות (mp3Bitrate). יותר גבוה = קובץ גדול יותר ואיכות טובה יותר
const mp3Kbps = () => {
  const v = typeof S !== 'undefined' ? +S.mp3Bitrate : NaN;
  return MP3_RATES.includes(v) ? v : MP3_DEFAULT_KBPS;
};
const mp3T = (he, en) => (typeof uiText === 'function' ? uiText(he, en) : he);

// ID3v2.3: כותרת + פריימים של טקסט ב-UTF-16LE (הקידוד היחיד בגרסה 2.3
// שמכסה עברית), ותמונת השער (APIC). הגודל בכותרת הוא synchsafe – 7 ביטים לבייט.
function id3(title, artist, cover) {
  const utf16 = s => {
    const b = new Uint8Array(3 + s.length * 2);
    b[0] = 1; b[1] = 0xff; b[2] = 0xfe; // encoding=UTF-16 + BOM
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      b[3 + i * 2] = c & 255;
      b[4 + i * 2] = c >> 8;
    }
    return b;
  };
  const frame = (id, text) => {
    const body = utf16(text);
    const f = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i);
    const n = body.length; // בגרסה 2.3 גודל הפריים הוא big-endian רגיל
    f[4] = n >>> 24; f[5] = (n >>> 16) & 255; f[6] = (n >>> 8) & 255; f[7] = n & 255;
    f.set(body, 10);
    return f;
  };

  // APIC: בייט קידוד (Latin-1), סוג ה-MIME ואחריו 0, סוג התמונה (3 = שער קדמי),
  // תיאור ריק ואחריו 0, ואז התמונה עצמה.
  const picture = pic => {
    const mime = pic.mime;
    const body = new Uint8Array(1 + mime.length + 1 + 1 + 1 + pic.bytes.length);
    let o = 1; // encoding = 0
    for (let i = 0; i < mime.length; i++) body[o++] = mime.charCodeAt(i) & 255;
    o++; // סוף מחרוזת ה-MIME
    body[o++] = 3; // Cover (front)
    o++; // תיאור ריק
    body.set(pic.bytes, o);
    const f = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) f[i] = 'APIC'.charCodeAt(i);
    const n = body.length;
    f[4] = n >>> 24; f[5] = (n >>> 16) & 255; f[6] = (n >>> 8) & 255; f[7] = n & 255;
    f.set(body, 10);
    return f;
  };

  const frames = [];
  if (title) frames.push(frame('TIT2', title));
  if (artist) frames.push(frame('TPE1', artist));
  if (cover && cover.bytes && cover.bytes.length) frames.push(picture(cover));
  if (!frames.length) return new Uint8Array(0);

  const size = frames.reduce((n, f) => n + f.length, 0);
  const head = new Uint8Array(10 + size);
  head.set([0x49, 0x44, 0x33, 3, 0, 0]); // "ID3", v2.3.0, בלי דגלים
  head[6] = (size >>> 21) & 127; head[7] = (size >>> 14) & 127;
  head[8] = (size >>> 7) & 127;  head[9] = size & 127;
  let o = 10;
  for (const f of frames) { head.set(f, o); o += f.length; }
  return head;
}

// תמונת השער לקובץ: התמונה הממוזערת של הסרטון. חייבת להיות JPEG או PNG –
// נגנים לא מכירים WEBP, ולכן פורמט אחר מומר ב-canvas. אם משהו נכשל – מורידים בלי תמונה.
const COVER_MAX_BYTES = 800 * 1024;
const COVER_MAX_PX = 1000;

function mp3CoverUrls(meta) {
  const thumbs = (meta && meta.thumbs) || [];
  const urls = thumbs
    .filter(t => t && t.url)
    .sort((a, b) => (b.width || 0) - (a.width || 0))
    .map(t => t.url);
  if (meta && meta.id) urls.push('https://i.ytimg.com/vi/' + meta.id + '/hqdefault.jpg');
  return urls;
}

async function mp3ToJpeg(blob, max) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!out) throw new Error('canvas');
  return out;
}

async function mp3Cover(meta) {
  for (const url of mp3CoverUrls(meta)) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) continue;
      let blob = await r.blob();
      const bad = blob.type !== 'image/jpeg' && blob.type !== 'image/png';
      if (bad || blob.size > COVER_MAX_BYTES) blob = await mp3ToJpeg(blob, COVER_MAX_PX);
      if (blob.size > COVER_MAX_BYTES) continue;
      return { mime: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch {}
  }
  return null;
}

const toI16 = f => {
  const a = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = f[i] < -1 ? -1 : f[i] > 1 ? 1 : f[i];
    a[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return a;
};

// parts: הקובץ המוזג (m4a). מחזיר חלקים ל-Blob של MP3.
async function toMp3(parts, meta, onProgress) {
  const buf = await new Blob(parts, { type: 'audio/mp4' }).arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || typeof lamejs === 'undefined') throw new Error(mp3T('הדפדפן לא תומך בהמרה ל-MP3', 'This browser cannot convert to MP3'));

  const ctx = new Ctx();
  let audio;
  try {
    audio = await ctx.decodeAudioData(buf);
  } catch {
    throw new Error(mp3T('לא הצלחתי לפענח את פס הקול', 'Could not decode the audio track'));
  } finally {
    ctx.close();
  }

  const ch = Math.min(2, audio.numberOfChannels);
  const enc = new lamejs.Mp3Encoder(ch, audio.sampleRate, mp3Kbps());
  const L = audio.getChannelData(0);
  const R = ch > 1 ? audio.getChannelData(1) : null;

  const out = [id3(meta.title, meta.author, await mp3Cover(meta))];
  const BLOCK = 1152 * 40; // כפולה של גודל פריים MP3
  for (let i = 0; i < L.length; i += BLOCK) {
    const l = toI16(L.subarray(i, i + BLOCK));
    const b = R ? enc.encodeBuffer(l, toI16(R.subarray(i, i + BLOCK))) : enc.encodeBuffer(l);
    if (b.length) out.push(new Uint8Array(b));
    onProgress(i / L.length);
    await sleep(0); // מחזיר את השליטה לדפדפן – אחרת הדף קופא
  }
  const tail = enc.flush();
  if (tail.length) out.push(new Uint8Array(tail));
  return out;
}
