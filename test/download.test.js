// בדיקות ללוגיקת ההורדה מתוך download.js בלי DOM: node test/download.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/features/download.js', 'utf8');
const noop = () => {};
const store = {};
const ctx = {
  S: { download: true }, SITE: 'www', console, URL, Blob, DOMException, AbortController, Uint8Array, Promise, JSON, Math, Date, Map, Set, WeakMap,
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
vm.runInContext(src + ';Object.assign(this, { fetchFile, dlProgressLevel, dlCountText, dlPageItem, dlServerFailToast, MSG, dlRemoveNow, dlDoneList, dlRestoreDone, dlSetDone, DL_DONE_KEY });', ctx);

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

  // טוסט כישלון: "ההורדה נכשלה" בלי פעולה מומצאת; דרייב מלא → "האחסון מלא"
  ctx.Platform = { drive: {} };
  const t = ctx.dlServerFailToast({ code: 'VIDEO_FILE_BLOCKED' });
  assert.strictEqual(t.text, 'ההורדה נכשלה');
  assert(!t.action);
  assert.strictEqual(ctx.dlServerFailToast({ code: 'DRIVE_FULL' }).text, 'האחסון מלא');
  assert.strictEqual(ctx.dlServerFailToast({ code: 'WHATEVER', message: 'x' }).sub, null);

  // fetchFile: 403 לא מנסים שוב, ושאר החלקים נעצרים (בלי עוד בקשות שייכשלו)
  const calls = [];
  ctx.fetch = async (url, opts) => {
    calls.push(url);
    await new Promise(r => setTimeout(r, 2));
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
    return { ok: false, status: 403 };
  };
  const total = 10 * 1024 * 1024 * 6; // 6 חלקים
  await assert.rejects(ctx.fetchFile({ url: 'https://x/videoplayback?a=1', contentLength: String(total) }, noop, new AbortController().signal),
    e => e.expired === true && /403/.test(e.message));
  assert(calls.length <= 3, 'לא יותר מבקשה אחת לכל worker: ' + calls.length);
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
  const size = 10 * 1024 * 1024 + 5;
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

  console.log('download.test.js: ok');
})().catch(e => { console.error(e); process.exit(1); });
