// בדיקות ל-src/drive-client.js עם fetch מדומה. הרצה: node test/drive-client.test.js [--live]
// --live קורא פעם אחת ל-/health בממסר האמיתי (מותר; לא מתחיל עבודות ולא שולח עוגיות).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'drive-client.js'), 'utf8');

function load(fetchImpl) {
  const ctx = vm.createContext({ fetch: fetchImpl, setTimeout, clearTimeout, AbortController, URL, console, Date, Math, JSON });
  vm.runInContext(SRC + '\n;this.__x = { DriveClient, DRIVE_DEFAULT_SERVER, DRIVE_ACTIVE_STATES, DRIVE_QUALITIES, DRIVE_ERROR_HINT };', ctx);
  const x = ctx.__x;
  x.DriveClient.retryDelay = 1;
  return x;
}

// תשובה מדומה בסגנון Response
const res = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    const r = responses.shift();
    if (!r) throw new Error('unexpected fetch');
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(url, opts) : r;
  };
  fn.calls = calls;
  return fn;
}

const RELAY = { serverUrl: '', apiKey: 'k1' };
const DIRECT = { serverUrl: 'https://ytdrive.example.com/', apiKey: 'k2' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('api: מעטפת ממסר', async () => {
  const f = mockFetch([res(200, { ok: true, service: 'yt-drive', accept_cookies: true })]);
  const { DriveClient, DRIVE_DEFAULT_SERVER } = load(f);
  const r = await DriveClient.api(RELAY, '/download', { url: 'u', type: 'audio', quality: 'mp3' });
  assert.strictEqual(r.ok, true);
  const c = f.calls[0];
  assert.strictEqual(c.url, DRIVE_DEFAULT_SERVER);
  assert.strictEqual(c.opts.method, 'POST');
  assert.strictEqual(c.opts.redirect, 'follow');
  assert.strictEqual(c.opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepStrictEqual(c.body, { path: '/download', key: 'k1', body: { url: 'u', type: 'audio', quality: 'mp3' } });
});

test('api: GET במעטפת בלי body', async () => {
  const f = mockFetch([res(200, { ok: true })]);
  const { DriveClient } = load(f);
  await DriveClient.api(RELAY, '/health');
  assert.deepStrictEqual(f.calls[0].body, { path: '/health', key: 'k1' });
});

test('api: שרת ישיר', async () => {
  const f = mockFetch([res(200, { ok: true }), res(200, { ok: true })]);
  const { DriveClient } = load(f);
  await DriveClient.api(DIRECT, '/status/abc');
  assert.strictEqual(f.calls[0].url, 'https://ytdrive.example.com/status/abc');
  assert.strictEqual(f.calls[0].opts.method, 'GET');
  assert.strictEqual(f.calls[0].opts.headers['X-API-Key'], 'k2');
  await DriveClient.api(DIRECT, '/download', { url: 'u' });
  assert.strictEqual(f.calls[1].opts.method, 'POST');
  assert.deepStrictEqual(f.calls[1].body, { url: 'u' });
});

test('api: retry על דף שגיאה של גוגל, ואז הצלחה', async () => {
  const f = mockFetch([res(200, '<html>Sorry</html>'), res(500, '<html>oops</html>'), res(200, { ok: true, x: 1 })]);
  const { DriveClient } = load(f);
  const r = await DriveClient.api(RELAY, '/queue');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.length, 3);
});

test('api: אחרי 6 כישלונות BAD_RESPONSE', async () => {
  const f = mockFetch(Array.from({ length: 6 }, () => res(200, 'x')));
  const { DriveClient } = load(f);
  const r = await DriveClient.api(RELAY, '/queue');
  assert.strictEqual(r.error.code, 'BAD_RESPONSE');
  assert.strictEqual(f.calls.length, 6);
});

test('api: 418 נטפרי → CLIENT_BLOCKED בלי retry', async () => {
  const f = mockFetch([res(418, { blockByNetFree: true })]);
  const { DriveClient } = load(f);
  const r = await DriveClient.api(DIRECT, '/health');
  assert.strictEqual(r.error.code, 'CLIENT_BLOCKED');
  const f2 = mockFetch([res(200, '<a href="https://netfree.link/block/x">')]);
  assert.strictEqual((await load(f2).DriveClient.api(DIRECT, '/health')).error.code, 'CLIENT_BLOCKED');
});

test('api: Cloudflare 5xx → SERVER_OFFLINE, רשת → SERVER_OFFLINE', async () => {
  for (const st of [502, 503, 521, 530]) {
    const f = mockFetch([res(st, '<html>cloudflare</html>')]);
    assert.strictEqual((await load(f).DriveClient.api(DIRECT, '/health')).error.code, 'SERVER_OFFLINE');
  }
  const f = mockFetch([new TypeError('Failed to fetch')]);
  assert.strictEqual((await load(f).DriveClient.api(DIRECT, '/health')).error.code, 'SERVER_OFFLINE');
});

test('api: JSON שגיאה עובר כמו שהוא בלי retry', async () => {
  const f = mockFetch([res(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'm' } })]);
  const r = await load(f).DriveClient.api(RELAY, '/download', {});
  assert.strictEqual(r.error.code, 'UNAUTHORIZED');
  assert.strictEqual(f.calls.length, 1);
});

test('newJob + start: הצלחה', async () => {
  const f = mockFetch([res(200, { ok: true, job_id: 'j1', state: 'queued' })]);
  const { DriveClient } = load(f);
  const job = DriveClient.newJob({ videoId: 'dQw4w9WgXcQ', type: 'video', quality: 720, title: 'T' });
  assert.strictEqual(job.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(job.quality, '720');
  assert.strictEqual(job.state, 'queued');
  const s = await DriveClient.start(RELAY, job);
  assert.strictEqual(s.jobId, 'j1');
  assert.strictEqual(s.localId, job.localId);
  assert.strictEqual(job.jobId, undefined, 'לא משנה את המקור');
  assert.deepStrictEqual(f.calls[0].body.body, { url: job.url, type: 'video', quality: '720' });
});

test('newJob: videoId מתוך קישור, איכות לא חוקית → ברירת מחדל', () => {
  const { DriveClient } = load(mockFetch([]));
  const j = DriveClient.newJob({ url: 'https://youtu.be/dQw4w9WgXcQ?t=3', type: 'audio', quality: 'flac' });
  assert.strictEqual(j.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(j.quality, 'mp3');
  assert.strictEqual(DriveClient.videoIdFromUrl('https://music.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.strictEqual(DriveClient.videoIdFromUrl('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.strictEqual(DriveClient.videoIdFromUrl('https://example.com/?v=x'), null);
});

test('start: שגיאה', async () => {
  const f = mockFetch([res(200, { ok: false, error: { code: 'QUEUE_FULL', message: 'full' } })]);
  const { DriveClient } = load(f);
  const s = await DriveClient.start(RELAY, DriveClient.newJob({ videoId: 'dQw4w9WgXcQ' }));
  assert.strictEqual(s.state, 'error');
  assert.strictEqual(s.error.code, 'QUEUE_FULL');
});

test('poll: התקדמות, סיום', async () => {
  const f = mockFetch([
    res(200, { ok: true, state: 'downloading', stage: 'video', percent: 42.5, title: 'שם' }),
    res(200, { ok: true, state: 'done', percent: 100, short_url: 's', drive_url: 'd', view_url: 'v', size: 5, cached: true }),
  ]);
  const { DriveClient } = load(f);
  let j = Object.assign(DriveClient.newJob({ videoId: 'dQw4w9WgXcQ' }), { jobId: 'j1' });
  j = await DriveClient.poll(RELAY, j);
  assert.strictEqual(j.state, 'downloading');
  assert.strictEqual(j.percent, 42.5);
  assert.strictEqual(j.title, 'שם');
  assert.deepStrictEqual(f.calls[0].body, { path: '/status/j1', key: 'k1' });
  j = await DriveClient.poll(RELAY, j);
  assert.strictEqual(j.state, 'done');
  assert.strictEqual(j.short_url, 's');
  assert.strictEqual(j.cached, true);
  // עבודה שהסתיימה לא נבדקת שוב
  assert.strictEqual(await DriveClient.poll(RELAY, j), j);
  assert.strictEqual(f.calls.length, 2);
});

test('poll: תקלה זמנית → offlineSince, לא הורס; שגיאת עבודה → error', async () => {
  const f = mockFetch([
    res(503, 'cf'),
    res(200, { ok: true, state: 'queued', position: 2 }),
    res(200, { ok: false, error: { code: 'YT_BOT_CHECK', message: 'bot' } }),
  ]);
  const { DriveClient } = load(f);
  let j = Object.assign(DriveClient.newJob({ videoId: 'dQw4w9WgXcQ' }), { jobId: 'j1' });
  j = await DriveClient.poll(RELAY, j);
  assert.strictEqual(j.state, 'queued');
  assert.ok(j.offlineSince > 0);
  j = await DriveClient.poll(RELAY, j);
  assert.strictEqual(j.offlineSince, undefined);
  assert.strictEqual(j.position, 2);
  j = await DriveClient.poll(RELAY, j);
  assert.strictEqual(j.state, 'error');
  assert.strictEqual(j.error.code, 'YT_BOT_CHECK');
});

test('poll: עבודה יתומה (בלי jobId)', async () => {
  const f = mockFetch([]);
  const { DriveClient } = load(f);
  const fresh = DriveClient.newJob({ videoId: 'dQw4w9WgXcQ' });
  assert.strictEqual(await DriveClient.poll(RELAY, fresh), fresh);
  const old = Object.assign({}, fresh, { created: Date.now() - 120000 });
  const r = await DriveClient.poll(RELAY, old);
  assert.strictEqual(r.state, 'error');
  assert.strictEqual(r.error.code, 'SERVER_OFFLINE');
  assert.strictEqual(f.calls.length, 0);
});

test('toNetscape: עם עוגיית התחברות', () => {
  const { DriveClient } = load(mockFetch([]));
  const r = DriveClient.toNetscape([
    { domain: '.youtube.com', path: '/', secure: true, expirationDate: 1900000000.7, name: 'SAPISID', value: 'fake-a' },
    { domain: 'www.youtube.com', path: '/', secure: false, name: 'PREF', value: 'f1=1' },
    { domain: '.youtube.com', path: '/', secure: true, expirationDate: 1900000000.7, name: 'SAPISID', value: 'dup' },
  ]);
  assert.strictEqual(r.ok, true);
  const lines = r.text.trimEnd().split(String.fromCharCode(10));
  assert.strictEqual(lines[0], '# Netscape HTTP Cookie File');
  assert.strictEqual(lines.length, 3);
  const T = String.fromCharCode(9);
  assert.strictEqual(lines[1], ['.youtube.com', 'TRUE', '/', 'TRUE', '1900000001', 'SAPISID', 'fake-a'].join(T));
  assert.strictEqual(lines[2], ['.www.youtube.com', 'TRUE', '/', 'FALSE', '0', 'PREF', 'f1=1'].join(T));
});

test('toNetscape: בלי עוגיית התחברות → NOT_LOGGED_IN', () => {
  const { DriveClient } = load(mockFetch([]));
  const r = DriveClient.toNetscape([{ domain: '.youtube.com', name: 'PREF', value: 'x' }, { domain: '.google.com', name: 'SID', value: '' }]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'NOT_LOGGED_IN');
  assert.strictEqual(r.text, undefined);
  assert.strictEqual(DriveClient.toNetscape([]).ok, false);
});

test('mapBrowserQuality', () => {
  const { DriveClient } = load(mockFetch([]));
  const m = h => JSON.stringify(DriveClient.mapBrowserQuality(h));
  assert.strictEqual(m(null), '{"type":"audio","quality":"m4a"}');
  assert.strictEqual(m(2160), '{"type":"video","quality":"best"}');
  assert.strictEqual(m(1080), '{"type":"video","quality":"1080"}');
  assert.strictEqual(m(720), '{"type":"video","quality":"720"}');
  assert.strictEqual(m(540), '{"type":"video","quality":"480"}');
  assert.strictEqual(m(144), '{"type":"video","quality":"360"}');
});

test('קבועים', () => {
  const x = load(mockFetch([]));
  assert.ok(x.DRIVE_ACTIVE_STATES.includes('shortening'));
  assert.strictEqual(x.DRIVE_QUALITIES.video.length, 5);
  assert.ok(x.DRIVE_ERROR_HINT.CLIENT_BLOCKED);
});

if (process.argv.includes('--live')) {
  test('live: /health בממסר האמיתי', async () => {
    const { DriveClient } = load(fetch);
    const r = await DriveClient.api({}, '/health');
    console.log('   ', JSON.stringify(r));
    assert.strictEqual(typeof r.ok, 'boolean');
  });
}

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok  ', t.name); }
    catch (e) { failed++; console.log('FAIL', t.name, '\n    ', e.message); }
  }
  console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
