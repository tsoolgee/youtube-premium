// בדיקת זרימה ל-src/background.js עם chrome ו-fetch מדומים. הרצה: node test/background.test.js
// אין כאן רשת אמיתית ואין עוגיות אמיתיות.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC_DIR = path.join(__dirname, '..', 'src');
const SECRET = 'fake-secret-cookie-value';

function makeEnv({ settings, serverScript }) {
  const store = { settings };
  const listeners = {};
  const on = name => ({ addListener: fn => { listeners[name] = fn; } });
  const log = { notifications: [], tabMsgs: [], fetch: [], console: [] };
  const chrome = {
    runtime: { id: 'ext', lastError: undefined, onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup') },
    storage: { local: {
      get: async k => (typeof k === 'string' ? { [k]: clone(store[k]) } : {}),
      set: async o => { Object.assign(store, clone(o)); },
    } },
    tabs: {
      query: (q, cb) => cb([{ id: 7 }]),
      sendMessage: (id, msg, cb) => { log.tabMsgs.push(clone(msg)); cb && cb(); },
      create: () => {},
    },
    notifications: { create: (id, o, cb) => { log.notifications.push(o); cb && cb(); }, onClicked: on('notif'), clear: () => {} },
    contextMenus: { removeAll: cb => cb(), create: () => {}, onClicked: on('menu') },
    alarms: { get: (n, cb) => cb(null), create: () => {}, onAlarm: on('alarm') },
    cookies: { getAll: async ({ domain }) => domain === '.youtube.com'
      ? [{ domain: '.youtube.com', path: '/', secure: true, name: 'SAPISID', value: SECRET }] : [] },
  };
  const fetch = async (url, opts) => {
    const env = JSON.parse(opts.body);
    log.fetch.push(env);
    const body = serverScript(env);
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  const cons = { log: (...a) => log.console.push(a), warn: (...a) => log.console.push(a), error: (...a) => log.console.push(a) };
  const ctx = vm.createContext({ chrome, fetch, console: cons, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout, AbortController, URL, Date, Math, JSON });
  ctx.importScripts = (...names) => {
    for (const n of names) {
      if (n === 'settings.js') vm.runInContext('const DEFAULTS = { shareCookies: false, serverUrl: DRIVE_DEFAULT_SERVER, apiKey: "" };', ctx);
      else vm.runInContext(fs.readFileSync(path.join(SRC_DIR, n), 'utf8'), ctx);
    }
  };
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, 'background.js'), 'utf8'), ctx);
  vm.runInContext('DriveClient.retryDelay = 1', ctx);
  const send = (cmd, payload) => new Promise(resolve => {
    const r = listeners.message({ ytuDrive: cmd, payload }, { id: 'ext' }, resolve);
    assert.strictEqual(r, true);
  });
  return { store, log, send };
}

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const until = async (cond, ms = 3000) => {
  const t = Date.now();
  while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); }
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// שרת מדומה: עבודה ראשונה נכשלת ב-YT_BOT_CHECK, אחרי עוגיות מצליחה
function botServer({ acceptCookies = true } = {}) {
  let n = 0, cookiesSent = false;
  return env => {
    if (env.path === '/health') return { ok: true, accept_cookies: acceptCookies };
    if (env.path === '/cookies') { cookiesSent = true; return { ok: true, message: 'saved', pool: 1 }; }
    if (env.path === '/download') return { ok: true, job_id: 'j' + (++n), state: 'queued' };
    if (env.path.startsWith('/status/')) {
      return cookiesSent ? { ok: true, state: 'done', short_url: 'https://s/x' }
        : { ok: false, error: { code: 'YT_BOT_CHECK', message: 'bot' } };
    }
    return { ok: false, error: { code: 'X', message: 'x' } };
  };
}

test('start + poll + הצלחה + שידור + התראה', async () => {
  let polls = 0;
  const { store, log, send } = makeEnv({ settings: {}, serverScript: env => {
    if (env.path === '/download') return { ok: true, job_id: 'a', state: 'queued' };
    if (env.path === '/status/a') return ++polls < 2 ? { ok: true, state: 'downloading', percent: 10 } : { ok: true, state: 'done', short_url: 'https://s/1' };
  } });
  const r = await send('start', { videoId: 'dQw4w9WgXcQ', type: 'audio', quality: 'mp3', title: 'T' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.job.jobId, 'a');
  await until(() => log.notifications.length === 1);
  assert.strictEqual(store.driveJobs[0].state, 'done');
  assert.ok(log.tabMsgs.some(m => m.ytuJob.state === 'downloading'));
  assert.ok(log.tabMsgs.some(m => m.ytuJob.state === 'done'));
  const jobs = await send('jobs');
  assert.strictEqual(jobs.length, 1);
});

test('YT_BOT_CHECK + הגדרה פעילה → עוגיות וניסיון חוזר אחד', async () => {
  const { store, log, send } = makeEnv({ settings: { shareCookies: true }, serverScript: botServer() });
  await send('start', { videoId: 'dQw4w9WgXcQ', type: 'video', quality: '720' });
  await until(() => store.driveJobs && store.driveJobs[0].state === 'done');
  const paths = log.fetch.map(e => e.path);
  assert.deepStrictEqual(paths.filter(p => p === '/download').length, 2);
  assert.strictEqual(paths.filter(p => p === '/cookies').length, 1);
  assert.ok(paths.indexOf('/health') < paths.indexOf('/cookies'));
  assert.strictEqual(store.driveJobs.length, 1, 'אותה עבודה');
  assert.strictEqual(store.driveJobs[0].cookieRetry, true);
  // העוגייה לא נשמרה ולא שודרה ולא נרשמה
  const leaked = JSON.stringify([store, log.tabMsgs, log.notifications, log.console]);
  assert.ok(!leaked.includes(SECRET));
  assert.ok(typeof store.driveCookieRetryAt === 'number');
});

test('YT_BOT_CHECK בלי ההגדרה → שגיאה, בלי עוגיות', async () => {
  const { store, log, send } = makeEnv({ settings: {}, serverScript: botServer() });
  await send('start', { videoId: 'dQw4w9WgXcQ' });
  await until(() => log.notifications.length === 1);
  assert.strictEqual(store.driveJobs[0].error.code, 'YT_BOT_CHECK');
  assert.ok(!log.fetch.some(e => e.path === '/cookies' || e.path === '/health'));
});

test('השרת לא מקבל עוגיות → לא נשלחות', async () => {
  const { store, log, send } = makeEnv({ settings: { shareCookies: true }, serverScript: botServer({ acceptCookies: false }) });
  await send('start', { videoId: 'dQw4w9WgXcQ' });
  await until(() => log.notifications.length === 1);
  assert.strictEqual(store.driveJobs[0].error.code, 'YT_BOT_CHECK');
  assert.ok(!log.fetch.some(e => e.path === '/cookies'));
  const r = await send('shareCookies');
  assert.strictEqual(r.error.code, 'COOKIES_DISABLED');
});

test('מגבלת 30 דקות', async () => {
  const { store, log, send } = makeEnv({ settings: { shareCookies: true }, serverScript: botServer() });
  store.driveCookieRetryAt = Date.now() - 10 * 60 * 1000;
  await send('start', { videoId: 'dQw4w9WgXcQ' });
  await until(() => log.notifications.length === 1);
  assert.ok(!log.fetch.some(e => e.path === '/cookies'));
});

test('shareCookies ידני עם הגדרה כבויה נחסם', async () => {
  const { log, send } = makeEnv({ settings: { shareCookies: false }, serverScript: botServer() });
  const r = await send('shareCookies');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(log.fetch.length, 0);
});

test('start שנחסם מיד ב-YT_BOT_CHECK עונה בלי לחכות לניסיון החוזר עם עוגיות', async () => {
  let cookiesSent = false, downloads = 0;
  const { store, log, send } = makeEnv({ settings: { shareCookies: true }, serverScript: env => {
    if (env.path === '/health') return { ok: true, accept_cookies: true };
    if (env.path === '/cookies') { cookiesSent = true; return { ok: true, message: 'saved', pool: 1 }; }
    if (env.path === '/download') {
      downloads++;
      return cookiesSent ? { ok: true, job_id: 'b', state: 'queued' } : { ok: false, error: { code: 'YT_BOT_CHECK', message: 'bot' } };
    }
    if (env.path === '/status/b') return { ok: true, state: 'done', short_url: 'https://s/b' };
  } });
  const r = await send('start', { videoId: 'dQw4w9WgXcQ', type: 'audio', quality: 'mp3' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'YT_BOT_CHECK');
  await until(() => store.driveJobs && store.driveJobs[0].state === 'done');
  assert.strictEqual(downloads, 2);
  assert.strictEqual(store.driveJobs.length, 1);
  assert.strictEqual(store.driveJobs[0].localId, r.job.localId);
  assert.ok(log.tabMsgs.some(m => m.ytuJob.state === 'done' && m.ytuJob.cookieRetry));
});

test('health', async () => {
  const { send } = makeEnv({ settings: {}, serverScript: () => ({ ok: true, accept_cookies: true, cookies: 2 }) });
  assert.strictEqual(JSON.stringify(await send('health')), '{"ok":true,"accept_cookies":true,"cookies":2}');
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
