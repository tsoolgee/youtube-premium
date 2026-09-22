// בדיקות ללוגיקת ההורדה מתוך download.js בלי DOM: node test/download.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
// אותו סדר כמו ב-build.py: lame (vendor) → mp3.js → download.js
const src = ['/../src/vendor/lame.min.js', '/../src/mp3.js', '/../src/features/download.js']
  .map(f => fs.readFileSync(__dirname + f, 'utf8')).join(';\n');
const noop = () => {};
const store = {};
const ctx = {
  S: { download: true }, SITE: 'www', console, URL, Blob, DOMException, AbortController, Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Promise, JSON, Math, Date, Map, Set, WeakMap, String,
  setTimeout, clearTimeout,
  sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 5))),
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  window: { addEventListener: noop, removeEventListener: noop, yt: { msgs_: { TRANSFER_FAILED: 'ההורדה נכשלה', VIDEO_COUNT: { case1: 'סרטון אחד', other: '‫# סרטונים' }, DOWNLOADING_PERCENT: 'רגע, תכף נסיים להוריד... $percent%' } } },
  document: { documentElement: { lang: 'he' }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, title: '' },
  location: { pathname: '/watch' },
  videoId: () => null, player: () => null, h: () => ({}), mb: n => n + 'B', safeName: x => x,
  uiText: he => he, uiHebrew: () => true,
};
vm.createContext(ctx);
vm.runInContext(src + ';Object.assign(this, { fetchFile, dlProgressLevel, dlCountText, dlPageItem, MSG, dlRemoveNow, dlDoneList, dlRestoreDone, dlSetDone, DL_DONE_KEY, DL_CHOICES, dlIsAudio, id3, lamejs, toMp3, dlChoices, dlLowerChoice, dlPickVideo, dlInfoReady, dlSizeText });', ctx);

(async () => {
  // מדרגות הטבעת כמו updateProgress של יוטיוב
  assert.deepStrictEqual([0, 10, 11, 30, 31, 50, 69, 70, 71, 99].map(ctx.dlProgressLevel), [0, 0, 20, 20, 40, 40, 60, 60, 80, 80]);

  // VIDEO_COUNT של יוטיוב
  assert.strictEqual(ctx.dlCountText(1), 'סרטון אחד');
  assert.strictEqual(ctx.dlCountText(3), '‫3 סרטונים');

  // שורה בדף ההורדות: בהורדה – אחוז ושכבת "יורד", בלי מעבר לצפייה; הסרה = ACTION_REMOVE
  const busyItem = ctx.dlPageItem({ id: 'abcdefghijk', title: 't', state: 'progress', percent: 41.7 }).richItemRenderer.content.videoRenderer;
  assert.strictEqual(busyItem.shortViewCountText.runs[0].text, 'רגע, תכף נסיים להוריד... 41%');
  assert.strictEqual(busyItem.thumbnailOverlays[0].thumbnailOverlayDownloadingRenderer.state, 'THUMBNAIL_OVERLAY_DOWNLOADING_RENDERER_STATE_DOWNLOADING');
  assert(!busyItem.navigationEndpoint);
  const doneItem = ctx.dlPageItem({ id: 'abcdefghijk', title: 't', length: 65 }).richItemRenderer.content.videoRenderer;
  assert(doneItem.navigationEndpoint.watchEndpoint);
  assert.strictEqual(doneItem.menu.menuRenderer.items[0].menuServiceItemRenderer.serviceEndpoint.offlineVideoEndpoint.action, 'ACTION_REMOVE');

  // הטקסטים של יוטיוב לכישלון
  assert.strictEqual(ctx.MSG.failed(), 'ההורדה נכשלה');
  assert.strictEqual(ctx.MSG.storageFull(), 'האחסון מלא');

  // fetchFile: 403 לא מנסים שוב, ושאר החלקים נעצרים (בלי עוד בקשות שייכשלו)
  const calls = [];
  ctx.fetch = async (url, opts) => {
    calls.push(url);
    await new Promise(r => setTimeout(r, 2));
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
    return { ok: false, status: 403 };
  };
  const total = 4 * 1024 * 1024 * 6; // 6 חלקים (CHUNK = 4MB)
  await assert.rejects(ctx.fetchFile({ url: 'https://x/videoplayback?a=1', contentLength: String(total) }, noop, new AbortController().signal),
    e => e.expired === true && /403/.test(e.message));
  assert(calls.length <= 4, 'לא יותר מבקשה אחת לכל worker (LANES=4): ' + calls.length);
  assert(calls.every(u => /&range=\d+-\d+$/.test(u)));

  // fetchFile: טווחים בדיוק עד סוף הקובץ, ו-5xx כן מנסים שוב
  const ranges = [];
  let failed = false;
  ctx.fetch = async url => {
    const [a, b] = url.split('&range=')[1].split('-').map(Number);
    ranges.push([a, b]);
    if (!failed) { failed = true; return { ok: false, status: 503 }; }
    const buf = new Uint8Array(b - a + 1);
    let sent = false;
    return { ok: true, body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: buf })) }) } };
  };
  const size = 4 * 1024 * 1024 * 2 + 5; // 3 חלקים של 4MB
  const out = await ctx.fetchFile({ url: 'https://x/videoplayback?a=1', contentLength: String(size) }, noop, new AbortController().signal);
  assert.strictEqual(out.length, size);
  assert(ranges.every(([, b]) => b <= size - 1));
  assert.strictEqual(ranges.length, 4); // 3 חלקים + ניסיון חוזר אחד

  // הסרה מתפריט: מיד, וטוסט "ביטול" מחזיר את הרשומה
  let toast = null;
  ctx.ytToast = o => { toast = o; };
  ctx.refreshDownloadButtons = noop;
  store[ctx.DL_DONE_KEY] = JSON.stringify([{ id: 'aaaaaaaaaaa', title: 'a', at: 1 }, { id: 'bbbbbbbbbbb', title: 'b', at: 2 }]);
  assert.strictEqual(ctx.dlRemoveNow('aaaaaaaaaaa'), true);
  assert.deepStrictEqual(ctx.dlDoneList().map(x => x.id), ['bbbbbbbbbbb']);
  assert.strictEqual(toast.text, 'הסרטון נמחק מההורדות.');
  assert(toast.close);
  toast.action.run();
  assert.deepStrictEqual(ctx.dlDoneList().map(x => x.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.strictEqual(ctx.dlRemoveNow('ccccccccccc'), false);

  // MP3: אפשרות בדיאלוג ותג ID3 עם כותרת בעברית
  assert(ctx.DL_CHOICES.some(c => c.value === 'mp3' && c.mp3));
  assert.strictEqual(ctx.dlIsAudio('mp3'), true);
  assert.strictEqual(ctx.dlIsAudio('720'), false);
  const tag = ctx.id3('שיר', 'אמן');
  assert.strictEqual(String.fromCharCode(tag[0], tag[1], tag[2]), 'ID3');
  assert.strictEqual(tag[3], 3);
  const tagSize = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  assert.strictEqual(tagSize, tag.length - 10);
  assert(tag.every(b => b !== undefined));
  assert.strictEqual(typeof ctx.lamejs, 'function');
  assert.strictEqual(typeof ctx.lamejs.Mp3Encoder, 'function');

  // כל האפשרויות: שורה לכל איכות שיוטיוב מציע + M4A + MP3, עם שמות Premium לפריסטים
  const vids = [
    { height: 1080, fps: 60, mimeType: 'video/mp4; codecs="avc1"', contentLength: '900' },
    { height: 720, fps: 30, mimeType: 'video/mp4; codecs="avc1"', contentLength: '500' },
    { height: 480, fps: 30, mimeType: 'video/mp4; codecs="avc1"', contentLength: '300' },
    { height: 144, fps: 15, mimeType: 'video/mp4; codecs="avc1"', contentLength: '90' },
  ];
  const info = { title: 't', author: 'a', length: 10, audio: { contentLength: '100' }, videos: vids };
  const ch = ctx.dlChoices(info);
  assert.strictEqual(ch.map(c => c.value).join(','), '1080,720,480,144,audio,mp3');
  assert.strictEqual(ch[0].he, 'Full HD (1080p)');   // פריסט – השם של יוטיוב
  assert.strictEqual(ch[2].he, '480p');              // לא פריסט – הגובה
  assert.strictEqual(ctx.dlChoices(null), ctx.DL_CHOICES);
  assert.strictEqual(ctx.dlSizeText(info, '480'), '400B');
  assert.strictEqual(ctx.dlPickVideo(info, '480').height, 480);

  // אין זיכרון → יורדים לאיכות הבאה שקיימת, ומהנמוכה אין לאן
  ctx.dlInfoReady.set('abcdefghijk', info);
  assert.strictEqual(ctx.dlLowerChoice('abcdefghijk', '1080'), '720');
  assert.strictEqual(ctx.dlLowerChoice('abcdefghijk', '480'), '144');
  assert.strictEqual(ctx.dlLowerChoice('abcdefghijk', '144'), null);
  assert.strictEqual(ctx.dlLowerChoice('abcdefghijk', 'mp3'), null);
  assert.strictEqual(ctx.dlLowerChoice('zzzzzzzzzzz', '1080'), null);

  console.log('download.test.js: ok');
})().catch(e => { console.error(e); process.exit(1); });
