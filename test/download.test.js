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
vm.runInContext(src + ';Object.assign(this, { fetchFile, dlProgressLevel, dlCountText, dlPageItem, MSG, dlRemoveNow, dlDoneList, dlRestoreDone, dlSetDone, DL_DONE_KEY, DL_CHOICES, dlIsAudio, id3, lamejs, toMp3, mp3Kbps, dlChoices, dlLowerChoice, dlPickVideo, dlInfoReady, dlSizeText, mp3Cover, mp3CoverUrls });', ctx);

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
  const total = 8 * 1024 * 1024 * 6; // 6 חלקים בגודל ההתחלתי (8MB)
  await assert.rejects(ctx.fetchFile({ url: 'https://x/videoplayback?a=1', contentLength: String(total) }, noop, new AbortController().signal),
    e => e.expired === true && /403/.test(e.message));
  assert(calls.length <= 6, 'לא יותר מבקשה אחת לכל worker (LANES=6): ' + calls.length);
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
  const size = 8 * 1024 * 1024 + 5; // חלק שלם של 8MB ועוד שארית
  const out = await ctx.fetchFile({ url: 'https://x/videoplayback?a=1', contentLength: String(size) }, noop, new AbortController().signal);
  assert.strictEqual(out.length, size);
  assert(ranges.every(([, b]) => b <= size - 1));
  assert.strictEqual(ranges.length, 3); // 2 חלקים + ניסיון חוזר אחד

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

  // "רק H.264" (ברירת מחדל): איכות שיש לה רק AV1 לא מוצגת, ובוחרים תמיד H.264
  const av1info = { ...info, videos: [
    { height: 2160, fps: 30, mimeType: 'video/mp4; codecs="av01.0.12M.08"', contentLength: '5000' },
    { height: 1080, fps: 30, mimeType: 'video/mp4; codecs="av01.0.08M.08"', contentLength: '800' },
    { height: 1080, fps: 30, mimeType: 'video/mp4; codecs="avc1.640028"', contentLength: '900' },
    { height: 720, fps: 30, mimeType: 'video/mp4; codecs="avc1.4d401f"', contentLength: '500' },
  ] };
  ctx.S.h264Only = true;
  assert.strictEqual(ctx.dlChoices(av1info).map(c => c.value).join(','), '1080,720,audio,mp3');
  assert.ok(/avc1/.test(ctx.dlPickVideo(av1info, '2160').mimeType));
  assert.strictEqual(ctx.dlPickVideo(av1info, '2160').height, 1080);
  ctx.S.h264Only = false;
  const all = ctx.dlChoices(av1info);
  assert.strictEqual(all.map(c => c.value).join(','), '2160,1080,720,audio,mp3');
  assert.ok(/AV1/.test(all[0].he));
  ctx.S.h264Only = true;

  // חלוקה מסתגלת: חיתוך באמצע מקטין את החלקים, וחיבור נקי מגדיל אותם
  const sizes = [];
  let cutLeft = 2;
  ctx.fetch = async url => {
    const [a, b] = url.split('&range=')[1].split('-').map(Number);
    const want = b - a + 1;
    sizes.push(want);
    const send = cutLeft-- > 0 ? Math.floor(want / 4) : want; // שתי הבקשות הראשונות נחתכות
    const buf = new Uint8Array(send);
    let sent = false;
    return { ok: true, body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: buf })) }) } };
  };
  const big = 8 * 1024 * 1024 * 10;
  const out2 = await ctx.fetchFile({ url: 'https://x/videoplayback?a=1', contentLength: String(big) }, noop, new AbortController().signal);
  assert.strictEqual(out2.length, big);
  const MB = 1024 * 1024;
  assert.strictEqual(sizes[0], 8 * MB);                       // מתחילים ב-8MB
  const news = sizes.filter((n, i) => i > 5);                 // אחרי החיתוכים
  assert(news.some(n => n <= 4 * MB), 'הוקטן אחרי חיתוך: ' + sizes.slice(0, 12).map(n => n / MB).join(','));
  assert(sizes.every(n => n >= MB && n <= 16 * MB), 'בתוך הגבולות');
  assert(sizes[sizes.length - 1] >= 4 * MB, 'גדל בחזרה בחיבור נקי: ' + sizes.slice(-6).map(n => n / MB).join(','));

  // MP3: קצב הסיביות לפי ההגדרה, עם נפילה לברירת מחדל על ערך לא חוקי
  ctx.S.mp3Bitrate = '128';
  assert.strictEqual(ctx.mp3Kbps(), 128);
  ctx.S.mp3Bitrate = '999';
  assert.strictEqual(ctx.mp3Kbps(), 320);
  delete ctx.S.mp3Bitrate;
  assert.strictEqual(ctx.mp3Kbps(), 320);

  // ID3: תמונת שער (APIC) אחרי פריימי הטקסט
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 250, 251]);
  const pic = ctx.id3('שיר', 'אמן', { mime: 'image/png', bytes: png });
  const str = (a, b) => String.fromCharCode(...pic.subarray(a, b));
  assert.strictEqual(str(0, 3), 'ID3');
  const picSize = (pic[6] << 21) | (pic[7] << 14) | (pic[8] << 7) | pic[9]; // synchsafe
  assert.strictEqual(picSize, pic.length - 10);
  // מדלגים על פריימי הטקסט עד ה-APIC
  let at = 10, seen = [];
  while (at < pic.length) {
    const id = str(at, at + 4);
    const n = (pic[at + 4] << 24) | (pic[at + 5] << 16) | (pic[at + 6] << 8) | pic[at + 7];
    seen.push(id);
    if (id === 'APIC') {
      const body = pic.subarray(at + 10, at + 10 + n);
      assert.strictEqual(body[0], 0);                              // Latin-1
      assert.strictEqual(String.fromCharCode(...body.subarray(1, 10)), 'image/png');
      assert.strictEqual(body[10], 0);                             // סוף ה-MIME
      assert.strictEqual(body[11], 3);                             // שער קדמי
      assert.strictEqual(body[12], 0);                             // תיאור ריק
      assert.strictEqual([...body.subarray(13)].join(), [...png].join());
    }
    at += 10 + n;
  }
  assert.strictEqual(at, pic.length);
  assert.deepStrictEqual(seen, ['TIT2', 'TPE1', 'APIC']);
  // בלי תמונה – בדיוק כמו קודם
  assert.strictEqual(tag.length, pic.length - (10 + 13 + png.length));

  // כתובות התמונה: מהגדולה לקטנה, ובסוף ברירת המחדל של יוטיוב
  assert.deepStrictEqual(ctx.mp3CoverUrls({ id: 'abcdefghijk', thumbs: [{ url: 's', width: 120 }, { url: 'L', width: 1280 }] }),
    ['L', 's', 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg']);
  // אין תמונה ואין מזהה – יורד בלי שער, בלי לזרוק
  assert.strictEqual(await ctx.mp3Cover({}), null);

  console.log('download.test.js: ok');
})().catch(e => { console.error(e); process.exit(1); });
