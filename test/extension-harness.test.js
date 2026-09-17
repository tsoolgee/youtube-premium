// בדיקת שילוב לחלקים של התוסף שלא נטענים בדפדפן הבדיקה: background.js (עם drive-client.js ו-settings.js
// האמיתיים דרך importScripts מדומה), bridge.js ו-platform-extension.js – מחוברים זה לזה כמו בכרום.
// chrome.* ו-fetch מדומים: אין רשת אמיתית ואין עוגיות אמיתיות. הרצה: node test/extension-harness.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const read = name => fs.readFileSync(path.join(SRC, name), 'utf8');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const tick = (ms = 2) => new Promise(r => setTimeout(r, ms));
const until = async (cond, what, ms = 4000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timeout: ' + what);
    await tick(3);
  }
};
const SECRET = 'fake-cookie-value-never-real';

// Node 18 בלי CustomEvent גלובלי
class CustomEventPoly extends Event {
  constructor(type, opts) { super(type, opts); this.detail = opts && opts.detail; }
}

function makeWorld({ settings = {}, server }) {
  const store = { settings: clone(settings) };
  const log = { fetch: [], cookieReads: [], notifications: [], tabMsgs: [], console: [] };

  // --- chrome.storage.local משותף ---
  const changeListeners = [];
  const local = {
    get(keys, cb) {
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
      const out = {};
      for (const k of list) if (store[k] !== undefined) out[k] = clone(store[k]);
      if (cb) { setTimeout(() => cb(out), 0); return undefined; }
      return Promise.resolve(out);
    },
    set(obj, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(store[k]), newValue: clone(v) };
        store[k] = clone(v);
      }
      setTimeout(() => { for (const fn of changeListeners) fn(changes, 'local'); }, 0);
      if (cb) { setTimeout(cb, 0); return undefined; }
      return Promise.resolve();
    },
  };
  const storage = { local, onChanged: { addListener: fn => changeListeners.push(fn) } };

  const bgMsg = [], tabMsg = [];
  const ev = () => { const l = []; return { addListener: fn => l.push(fn), l }; };
  const listenerOf = (arr) => ({ addListener: fn => arr.push(fn) });

  // שליחה ל-background כמו runtime.sendMessage: תשובה אסינכרונית רק אם המאזין החזיר true
  function deliverToBg(msg, sender, cb) {
    let answered = false, async = false;
    const reply = r => { if (answered) return; answered = true; cb && setTimeout(() => cb(clone(r)), 0); };
    for (const fn of bgMsg) if (fn(clone(msg), sender, reply) === true) async = true;
    if (!async && !answered) cb && setTimeout(() => cb(undefined), 0);
  }

  const runtimeBase = { id: 'ext', lastError: undefined, getManifest: () => JSON.parse(read('manifest.json')) };

  // --- background ---
  const bgChrome = {
    runtime: { ...runtimeBase, onMessage: listenerOf(bgMsg), onInstalled: ev(), onStartup: ev() },
    storage,
    tabs: {
      query: (q, cb) => cb([{ id: 7, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }]),
      sendMessage: (id, msg, cb) => {
        log.tabMsgs.push(clone(msg));
        setTimeout(() => { for (const fn of tabMsg) fn(clone(msg), { id: 'ext' }, () => {}); cb && cb(); }, 0);
      },
      create: () => {},
    },
    notifications: { create: (id, o, cb) => { log.notifications.push(o); cb && cb(); }, onClicked: ev(), clear: () => {} },
    contextMenus: { removeAll: cb => cb && cb(), create: () => {}, onClicked: ev() },
    alarms: { get: (n, cb) => cb(null), create: () => {}, onAlarm: ev() },
    cookies: {
      getAll: async q => {
        log.cookieReads.push(q.domain);
        return q.domain === '.youtube.com' ? [{ domain: '.youtube.com', path: '/', secure: true, name: 'SAPISID', value: SECRET, expirationDate: 1 }] : [];
      },
    },
  };
  const fetch = async (url, opts) => {
    assert.ok(/^https:\/\/script\.google\.com\//.test(url), 'רק לממסר המדומה: ' + url);
    const env = JSON.parse(opts.body);
    log.fetch.push(env);
    return { status: 200, text: async () => JSON.stringify(server(env)) };
  };
  const cons = { log: (...a) => log.console.push(a), warn: (...a) => log.console.push(a), error: (...a) => log.console.push(a) };
  // זמני המתנה מקוצרים (polling של 5 שניות, retry של הממסר)
  const fastTimeout = (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5));
  const bgCtx = vm.createContext({ chrome: bgChrome, fetch, console: cons, setTimeout: fastTimeout, clearTimeout, AbortController, URL, Date, Math, JSON, Promise });
  bgCtx.self = bgCtx;
  bgCtx.importScripts = (...names) => { for (const n of names) vm.runInContext(read(n), bgCtx, { filename: n }); };
  vm.runInContext(read('background.js'), bgCtx, { filename: 'background.js' });
  vm.runInContext('DriveClient.retryDelay = 1', bgCtx);

  // --- הדף: window משותף לעולם המבודד (bridge) ולעולם הדף (main.js) ---
  const win = new EventTarget();
  const ls = new Map();
  const localStorage = { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  const pageGlobals = { window: win, localStorage, CustomEvent: CustomEventPoly, setTimeout, clearTimeout, JSON, Math, Date, Promise, console: cons };

  const bridgeChrome = {
    runtime: {
      ...runtimeBase,
      onMessage: listenerOf(tabMsg),
      sendMessage: (msg, cb) => deliverToBg(msg, { id: 'ext', tab: { id: 7 } }, cb),
    },
    storage,
  };
  const bridgeCtx = vm.createContext({ ...pageGlobals, chrome: bridgeChrome });
  vm.runInContext(read('settings.js'), bridgeCtx, { filename: 'settings.js' });
  vm.runInContext(read('bridge.js'), bridgeCtx, { filename: 'bridge.js' });

  const pageCtx = vm.createContext({ ...pageGlobals });
  vm.runInContext(read('platform-extension.js') + '\n;this.Platform = Platform;', pageCtx, { filename: 'platform-extension.js' });
  const Platform = pageCtx.Platform;

  // ה-popup שולח ישירות ל-background
  const popupSend = (cmd, payload) => new Promise(r => deliverToBg({ ytuDrive: cmd, payload }, { id: 'ext', url: 'chrome-extension://ext/popup.html' }, r));

  const foreignSend = cmd => new Promise(r => deliverToBg({ ytuDrive: cmd }, { id: 'other-ext' }, r));

  return { store, log, Platform, win, localStorage, popupSend, foreignSend, deliverToBg };
}

// שרת מדומה. mode: 'ok' | 'bot' (כישלון עד שנשלחו עוגיות)
function relay({ mode = 'ok', acceptCookies = true } = {}) {
  let n = 0;
  const jobs = {};
  const state = { cookiesPosted: 0 };
  const fn = env => {
    if (env.path === '/health') return { ok: true, service: 'yt-drive', accept_cookies: acceptCookies, cookies: state.cookiesPosted };
    if (env.path === '/cookies') {
      assert.ok(String(env.body.cookies).startsWith('# Netscape HTTP Cookie File'));
      state.cookiesPosted++;
      return { ok: true, message: 'נשמר', pool: 1 };
    }
    if (env.path === '/download') {
      const id = 'j' + (++n);
      jobs[id] = { polls: 0, withCookies: state.cookiesPosted > 0 };
      return { ok: true, job_id: id, state: 'queued' };
    }
    const m = /^\/status\/(.+)$/.exec(env.path);
    if (m) {
      const j = jobs[m[1]];
      if (!j) return { ok: false, error: { code: 'JOB_NOT_FOUND', message: 'x' } };
      j.polls++;
      if (mode === 'bot' && !j.withCookies) return { ok: true, state: 'error', error: { code: 'YT_BOT_CHECK', message: 'בוט' } };
      if (j.polls === 1) return { ok: true, state: 'downloading', stage: 'video', percent: 50 };
      return { ok: true, state: 'done', percent: 100, short_url: 'https://did.li/x', drive_url: 'https://drive/x', view_url: 'https://view/x' };
    }
    return { ok: false, error: { code: 'BAD', message: 'x' } };
  };
  fn.state = state;
  return fn;
}

const pageJobs = win => {
  const seen = [];
  win.addEventListener('ytu:job', e => seen.push(JSON.parse(e.detail)));
  return seen;
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('דף → bridge → background: start, polling, done, שידור לדף והתראה', async () => {
  const w = makeWorld({ server: relay() });
  const updates = [];
  w.Platform.drive.onJob(j => updates.push(j));
  const r = await w.Platform.drive.start({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', videoId: 'jNQXAC9IVRw', type: 'video', quality: '720', title: 'T' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(r.job.localId && r.job.jobId);
  await until(() => updates.some(j => j.state === 'done'), 'done update');
  assert.ok(updates.some(j => j.state === 'downloading' && j.percent === 50));
  const done = updates.find(j => j.state === 'done');
  assert.strictEqual(done.localId, r.job.localId);
  assert.strictEqual(done.short_url, 'https://did.li/x');
  await until(() => w.log.notifications.length === 1, 'notification');
  assert.strictEqual(w.log.notifications[0].title, 'ההורדה לדרייב מוכנה');
  const jobs = await w.Platform.drive.jobs();
  assert.ok(Array.isArray(jobs) && jobs.length === 1 && jobs[0].state === 'done');
  const h = await w.Platform.drive.health();
  assert.strictEqual(h.ok, true);
  assert.strictEqual(h.accept_cookies, true);
});

test('YT_BOT_CHECK עם shareCookies=false: אין קריאת עוגיות בכלל', async () => {
  const server = relay({ mode: 'bot' });
  const w = makeWorld({ settings: { shareCookies: false }, server });
  const seen = pageJobs(w.win);
  await w.Platform.drive.start({ videoId: 'jNQXAC9IVRw', type: 'audio', quality: 'mp3' });
  await until(() => seen.some(j => j.state === 'error'), 'error update');
  await until(() => w.log.notifications.length === 1, 'failure notification');
  await tick(30);
  assert.deepStrictEqual(w.log.cookieReads, []);
  assert.strictEqual(server.state.cookiesPosted, 0);
  assert.ok(!w.log.fetch.some(e => e.path === '/cookies'));
  const manual = await w.Platform.drive.shareCookies();
  assert.strictEqual(manual.ok, false);
  assert.deepStrictEqual(w.log.cookieReads, []);
});

test('YT_BOT_CHECK עם shareCookies=true ו-accept_cookies: עוגיות פעם אחת, אותה עבודה עם cookieRetry, ולא שוב תוך 30 דק\'', async () => {
  const server = relay({ mode: 'bot' });
  const w = makeWorld({ settings: { shareCookies: true }, server });
  const seen = pageJobs(w.win);
  const r = await w.Platform.drive.start({ videoId: 'jNQXAC9IVRw', type: 'video', quality: '480' });
  await until(() => seen.some(j => j.state === 'done' && j.localId === r.job.localId), 'retry done');
  assert.deepStrictEqual([...w.log.cookieReads].sort(), ['.google.com', '.youtube.com']);
  assert.strictEqual(server.state.cookiesPosted, 1);
  const paths = w.log.fetch.map(e => e.path);
  assert.ok(paths.lastIndexOf('/health') < paths.indexOf('/cookies'), 'health לפני cookies');
  assert.strictEqual(paths.filter(p => p === '/download').length, 2);
  const stored = w.store.driveJobs;
  assert.strictEqual(stored.length, 1, 'אותה עבודה, לא חדשה');
  assert.strictEqual(stored[0].cookieRetry, true);
  assert.ok(seen.some(j => j.cookieRetry === true && j.localId === r.job.localId));
  // העוגיות לא נשמרו, לא שודרו ולא נרשמו
  assert.ok(!JSON.stringify([w.store, w.log.tabMsgs, w.log.notifications, w.log.console, [...seen]]).includes(SECRET));

  // עבודה שנייה נחסמת (השרת "שכח" את העוגיות): בתוך 30 דקות – בלי שיתוף נוסף
  server.state.cookiesPosted = 0;
  const reads = w.log.cookieReads.length;
  const r2 = await w.Platform.drive.start({ videoId: 'jNQXAC9IVRw', type: 'audio', quality: 'm4a' });
  await until(() => seen.some(j => j.localId === r2.job.localId && j.state === 'error'), 'second error');
  await until(() => w.log.notifications.some(n => n.title === 'ההורדה לדרייב נכשלה'), 'failure notification');
  await tick(30);
  assert.strictEqual(w.log.cookieReads.length, reads);
  assert.strictEqual(server.state.cookiesPosted, 0);
  // הדף מקבל סימון שהניסיון החוזר לא יקרה, כדי לא להמתין לנצח
  await until(() => seen.some(j => j.localId === r2.job.localId && j.cookieRetryDeclined === true), 'declined broadcast');
  assert.ok(w.store.driveJobs.some(j => j.localId === r2.job.localId && j.cookieRetryDeclined === true && !j.cookieRetry));
});

test('accept_cookies=false: לא נקראות עוגיות', async () => {
  const w = makeWorld({ settings: { shareCookies: true }, server: relay({ mode: 'bot', acceptCookies: false }) });
  await w.Platform.drive.start({ videoId: 'jNQXAC9IVRw', type: 'audio', quality: 'mp3' });
  await until(() => w.log.notifications.length === 1, 'notification');
  assert.deepStrictEqual(w.log.cookieReads, []);
  assert.ok(w.store.driveJobs.every(j => j.cookieRetryDeclined === true), 'השרת לא מקבל עוגיות – העבודה מסומנת');
  const r = await w.popupSend('shareCookies');
  assert.strictEqual(r.error.code, 'COOKIES_DISABLED');
  assert.deepStrictEqual(w.log.cookieReads, []);
});

test('bridge: apiKey לא מגיע לדף, ושמירה מהדף לא דורסת אותו, את כתובת השרת או את ההסכמה לעוגיות', async () => {
  const w = makeWorld({ settings: { apiKey: 'k-123', shareCookies: true, downloadMethod: 'auto' }, server: relay() });
  const pushed = [];
  w.Platform.onChange(s => pushed.push(s));
  await until(() => w.localStorage.getItem('ytu-settings'), 'initial push');
  assert.ok(!('apiKey' in JSON.parse(w.localStorage.getItem('ytu-settings'))));
  w.Platform.save({ downloadMethod: 'server', shareCookies: true, apiKey: 'evil' });
  await until(() => w.store.settings.downloadMethod === 'server', 'save');
  assert.strictEqual(w.store.settings.apiKey, 'k-123');
  assert.strictEqual(w.store.settings.shareCookies, true);
  await until(() => pushed.some(s => s.downloadMethod === 'server'), 'onChange');
  assert.ok(pushed.every(s => !('apiKey' in s)));
  // הדף לא מכוון את השרת למקום אחר (המפתח והעוגיות היו נשלחים לשם)
  w.Platform.save({ downloadMethod: 'browser', shareCookies: true, serverUrl: 'https://script.google.com/macros/s/OTHER/exec' });
  await until(() => w.store.settings.downloadMethod === 'browser', 'save 2');
  assert.ok(!('serverUrl' in w.store.settings));
  assert.strictEqual(w.store.settings.shareCookies, true);
  // כיבוי מהדף מותר, הפעלה מחדש לא
  w.Platform.save({ downloadMethod: 'browser', shareCookies: false });
  await until(() => w.store.settings.shareCookies === false, 'turn off');
  w.Platform.save({ downloadMethod: 'auto', shareCookies: true });
  await until(() => w.store.settings.downloadMethod === 'auto', 'save 3');
  assert.strictEqual(w.store.settings.shareCookies, false);
  // הממסר מקבל את המפתח מהאחסון ולא מהדף
  await w.Platform.drive.health();
  assert.strictEqual(w.log.fetch[w.log.fetch.length - 1].key, 'k-123');
});

test('פקודות ה-popup וה-platform תואמות ל-background', async () => {
  const w = makeWorld({ settings: { shareCookies: false }, server: relay() });
  const cmdsIn = (file, re) => [...new Set([...read(file).matchAll(re)].map(m => m[1]))];
  const popupCmds = cmdsIn('popup.js', /bg\('(\w+)'/g);
  const platformCmds = cmdsIn('platform-extension.js', /request\('(\w+)'/g);
  const bridgeCmds = JSON.parse(/DRIVE_CMDS = (\[[^\]]*\])/.exec(read('bridge.js'))[1].replace(/'/g, '"'));
  assert.deepStrictEqual([...popupCmds].sort(), ['health', 'jobs', 'shareCookies']);
  assert.deepStrictEqual([...platformCmds].sort(), ['health', 'jobs', 'start']);
  assert.ok(!bridgeCmds.includes('shareCookies'), 'הגשר לא מעביר shareCookies מהדף');
  for (const c of platformCmds) assert.ok(bridgeCmds.includes(c), 'bridge מעביר ' + c);
  for (const c of new Set([...popupCmds, ...platformCmds])) {
    const r = await w.popupSend(c, c === 'start' ? { videoId: 'jNQXAC9IVRw', type: 'audio', quality: 'mp3' } : null);
    assert.ok(r !== undefined, c + ' ענה');
    if (c === 'jobs') assert.ok(Array.isArray(r), 'jobs מחזיר מערך (popup בודק Array.isArray)');
    else {
      assert.strictEqual(typeof r.ok, 'boolean', c + ' מחזיר ok');
      assert.notStrictEqual(r.error && r.error.code, 'BAD_COMMAND');
    }
  }
  const h = await w.popupSend('health');
  assert.ok('accept_cookies' in h);
  const s = await w.popupSend('start', { videoId: 'jNQXAC9IVRw', type: 'video', quality: '720' });
  assert.ok(s.ok && s.job && s.job.localId && s.job.type === 'video' && s.job.quality === '720');
  // בקשה לא מוכרת מהדף נענית בשגיאה ולא מגיעה ל-background
  const before = w.log.fetch.length;
  const answer = new Promise(res => w.win.addEventListener('ytu:response', e => { const m = JSON.parse(e.detail); if (m.id === 'x1') res(m.result); }));
  w.win.dispatchEvent(new CustomEventPoly('ytu:request', { detail: JSON.stringify({ id: 'x1', cmd: 'evil', payload: {} }) }));
  const bad = await answer;
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(w.log.fetch.length, before);
  // הודעה מתוסף אחר נדחית (background לא עונה)
  const foreign = await w.foreignSend('health');
  assert.strictEqual(foreign, undefined);
});

test('דף זדוני: shareCookies מלשונית נדחה, start רק ליוטיוב ובהגבלת קצב, הסכמה קשורה לשרת', async () => {
  const w = makeWorld({ settings: { shareCookies: true }, server: relay() });
  // עקיפת הגשר: הודעה ישירה עם sender.tab (כמו content script) – background מסרב
  const viaTab = (cmd, payload) => new Promise(r => w.deliverToBg({ ytuDrive: cmd, payload }, { id: 'ext', tab: { id: 7 } }, r));
  const sc = await viaTab('shareCookies');
  assert.strictEqual(sc.ok, false);
  assert.deepStrictEqual(w.log.cookieReads, []);
  // דרך הגשר: פקודה לא מוכרת
  const answer = new Promise(res => w.win.addEventListener('ytu:response', e => { const m = JSON.parse(e.detail); if (m.id === 'c1') res(m.result); }));
  w.win.dispatchEvent(new CustomEventPoly('ytu:request', { detail: JSON.stringify({ id: 'c1', cmd: 'shareCookies' }) }));
  assert.strictEqual((await answer).ok, false);
  assert.deepStrictEqual(w.log.cookieReads, []);

  const before = w.log.fetch.length;
  const bad = await w.Platform.drive.start({ url: 'https://evil.example/x', type: 'video', quality: 'best' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, 'BAD_URL');
  assert.strictEqual(w.log.fetch.length, before);
  // קישור יוטיוב נבנה מחדש מהמזהה
  const good = await w.Platform.drive.start({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw&x=<evil>', type: 'audio', quality: 'mp3' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(w.log.fetch.filter(e => e.path === '/download').pop().body.url, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  let limited = null;
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await viaTab('start', { videoId: 'jNQXAC9IVRw', type: 'audio', quality: 'mp3' });
    if (!r.ok && r.error.code === 'RATE_LIMIT') limited = r;
  }
  assert.ok(limited, 'הגבלת קצב להורדות מלשונית');
  // מה-popup אין הגבלה
  assert.strictEqual((await w.popupSend('start', { videoId: 'jNQXAC9IVRw', type: 'audio', quality: 'mp3' })).ok, true);

  // הסכמה שניתנה לשרת אחר לא חלה על השרת הנוכחי
  w.store.settings = { shareCookies: true, shareCookiesServer: 'https://script.google.com/macros/s/OTHER/exec' };
  const other = await w.popupSend('shareCookies');
  assert.strictEqual(other.ok, false);
  assert.strictEqual(other.error.code, 'COOKIES_NOT_ALLOWED');
  assert.deepStrictEqual(w.log.cookieReads, []);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok  ', t.name); }
    catch (e) { failed++; console.log('FAIL', t.name, '\n    ', e.stack); }
  }
  console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
