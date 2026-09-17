// service worker של התוסף: עבודות השרת לדרייב, polling, התראות, תפריט לחיצה ימנית ושיתוף עוגיות.
importScripts('drive-client.js');
try { importScripts('settings.js'); } catch (e) {}

const MAX_JOBS = 30;
const POLL_MS = 5000;
const COOKIE_RETRY_MS = 30 * 60 * 1000;
const YT_TABS = ['*://*.youtube.com/*'];

async function getSettings() {
  const defaults = typeof DEFAULTS !== 'undefined' ? DEFAULTS : {};
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({ serverUrl: DRIVE_DEFAULT_SERVER, apiKey: '', shareCookies: false }, defaults, settings || {});
}

async function driveSettings() {
  const s = await getSettings();
  return { serverUrl: s.serverUrl || DRIVE_DEFAULT_SERVER, apiKey: s.apiKey || '' };
}

// --- אחסון עבודות ---
// כל השינויים עוברים בתור אחד, כדי ש-polling ו-start במקביל לא ידרסו זה את זה
let jobsLock = Promise.resolve();

function mutateJobs(fn) {
  const run = jobsLock.then(async () => {
    const { driveJobs } = await chrome.storage.local.get('driveJobs');
    const jobs = Array.isArray(driveJobs) ? driveJobs : [];
    const result = await fn(jobs);
    await chrome.storage.local.set({ driveJobs: jobs.slice(0, MAX_JOBS) });
    return result;
  });
  jobsLock = run.catch(() => {});
  return run;
}

async function getJobs() {
  await jobsLock;
  const { driveJobs } = await chrome.storage.local.get('driveJobs');
  return Array.isArray(driveJobs) ? driveJobs : [];
}

// שומר את העבודה (לפי localId) ומשדר ללשוניות יוטיוב
async function putJob(job) {
  await mutateJobs(jobs => {
    const i = jobs.findIndex(x => x.localId === job.localId);
    if (i >= 0) jobs[i] = job;
    else jobs.unshift(job);
  });
  broadcast(job);
  return job;
}

function broadcast(job) {
  chrome.tabs.query({ url: YT_TABS }, tabs => {
    if (chrome.runtime.lastError) return;
    for (const t of tabs || []) {
      // לשונית בלי bridge (לא נטענה מחדש מאז ההתקנה) – מתעלמים
      chrome.tabs.sendMessage(t.id, { ytuJob: job }, () => void chrome.runtime.lastError);
    }
  });
}

// --- התחלה ובדיקת מצב ---

// silent: כשהדף מחכה לתשובה הוא כבר מציג את השגיאה, אין צורך בהתראה
async function startJob(job, silent) {
  await putJob(job);
  const started = await DriveClient.start(await driveSettings(), job);
  await putJob(started);
  if (started.state !== 'error') pollLoop();
  else if (started.error && started.error.code === 'YT_BOT_CHECK') {
    // כשהדף מחכה לתשובה לא מחכים לשיתוף העוגיות ולניסיון החוזר (יכול לקחת דקות דרך הממסר);
    // העדכונים יגיעו לדף בשידור של אותה עבודה
    const retry = onFinished(started).catch(() => {});
    if (!silent) await retry;
  }
  else if (!silent) notify(started);
  // ייתכן שבינתיים התחיל ניסיון חוזר עם עוגיות – מחזירים את המצב השמור
  return (await getJobs()).find(j => j.localId === started.localId) || started;
}

let polling = false;

async function pollOnce() {
  const settings = await driveSettings();
  const active = (await getJobs()).filter(DriveClient.isActive);
  for (const job of active) {
    const next = await DriveClient.poll(settings, job);
    if (next === job) continue;
    const changed = JSON.stringify(next) !== JSON.stringify(job);
    if (changed) await putJob(next);
    if (!DriveClient.isActive(next)) await onFinished(next);
  }
  return (await getJobs()).some(DriveClient.isActive);
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  try {
    while (await pollOnce()) await new Promise(r => setTimeout(r, POLL_MS));
  } catch (e) {
    console.warn('YT Unlocked: polling', e && e.message);
  } finally {
    polling = false;
  }
}

async function onFinished(job) {
  if (job.state === 'error' && job.error && job.error.code === 'YT_BOT_CHECK') {
    let retried = false;
    try { retried = await cookieRetry(job); } catch (e) {}
    if (retried) return;
    // הדף מחכה לניסיון החוזר – מודיעים לו שלא יהיה, כדי שיסיים את ההורדה ויציג את השגיאה
    if (!job.cookieRetry && !job.cookieRetryDeclined) {
      job = Object.assign({}, job, { cookieRetryDeclined: true });
      try { await putJob(job); } catch (e) {}
    }
  }
  notify(job);
}

function notify(job) {
  const done = job.state === 'done';
  const detail = done ? (job.short_url || '') : ((job.error && job.error.message) || '');
  chrome.notifications.create('ytu-job-' + job.localId, {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: done ? 'ההורדה לדרייב מוכנה' : 'ההורדה לדרייב נכשלה',
    message: ((job.title || job.url) + '\n' + detail).trim(),
    priority: 1,
  }, () => void chrome.runtime.lastError);
}

// --- עוגיות ---

// ההסכמה ניתנה בחלון התוסף לשרת מסוים (shareCookiesServer); שרת אחר – אין הסכמה
function cookiesAllowed(s) {
  if (s.shareCookies !== true) return false;
  const norm = u => String(u || DRIVE_DEFAULT_SERVER).trim().replace(/\/+$/, '');
  return norm(s.shareCookiesServer) === norm(s.serverUrl);
}

// אוסף ושולח. נבדק כאן שההגדרה פעילה והשרת מקבל – גם כשהבקשה מגיעה מהדף
async function shareCookies() {
  const s = await getSettings();
  if (!cookiesAllowed(s)) {
    return { ok: false, error: { code: 'COOKIES_NOT_ALLOWED', message: 'שיתוף העוגיות כבוי בהגדרות' } };
  }
  const settings = { serverUrl: s.serverUrl || DRIVE_DEFAULT_SERVER, apiKey: s.apiKey || '' };
  const health = await DriveClient.api(settings, '/health');
  if (!health.ok) return { ok: false, error: health.error };
  if (!health.accept_cookies) {
    return { ok: false, error: { code: 'COOKIES_DISABLED', message: 'השרת לא מקבל עוגיות כרגע' } };
  }
  let all = [];
  try {
    for (const domain of ['.youtube.com', '.google.com']) all = all.concat(await chrome.cookies.getAll({ domain }));
  } catch (e) {
    return { ok: false, error: { code: 'NO_COOKIE_ACCESS', message: 'אין גישה לעוגיות. אשרו את ההרשאה לתוסף' } };
  }
  const file = DriveClient.toNetscape(all);
  all = null;
  if (!file.ok) return file;
  const r = await DriveClient.api(settings, '/cookies', { cookies: file.text });
  if (r.ok) await chrome.storage.local.set({ driveCookiesSharedAt: Date.now() });
  // מחזירים רק את מה שהשרת ענה – לא את העוגיות עצמן
  return r.ok ? { ok: true, message: r.message, pool: r.pool } : { ok: false, error: r.error };
}

// YT_BOT_CHECK: שיתוף עוגיות אוטומטי וניסיון חוזר אחד, לכל היותר פעם ב-30 דקות
async function cookieRetry(job) {
  if (job.cookieRetry) return false;
  const s = await getSettings();
  if (!cookiesAllowed(s)) return false;
  const { driveCookieRetryAt } = await chrome.storage.local.get('driveCookieRetryAt');
  if (driveCookieRetryAt && Date.now() - driveCookieRetryAt < COOKIE_RETRY_MS) return false;
  await chrome.storage.local.set({ driveCookieRetryAt: Date.now() });
  const shared = await shareCookies();
  if (!shared.ok) return false;
  // אותה עבודה (אותו localId), כדי שהדף ימשיך להציג אותה
  const retry = Object.assign({}, job, { state: 'queued', cookieRetry: true, created: Date.now() });
  for (const k of ['jobId', 'error', 'stage', 'percent', 'position', 'offlineSince']) delete retry[k];
  await startJob(retry);
  return true;
}

// --- הודעות מהדף (דרך bridge) ומה-popup ---

// הורדות שהתחילו מלשונית: כל סקריפט בדף יוטיוב יכול לבקש, אז מגבילים קצב
const TAB_START_LIMIT = 10;
const TAB_START_WINDOW = 60 * 1000;
let tabStarts = [];

function tabStartAllowed() {
  const now = Date.now();
  tabStarts = tabStarts.filter(t => now - t < TAB_START_WINDOW);
  if (tabStarts.length >= TAB_START_LIMIT) return false;
  tabStarts.push(now);
  return true;
}

// sender.tab קיים = הבקשה הגיעה מדף (דרך bridge), לא מחלון התוסף
async function handle(cmd, payload, sender) {
  const fromTab = !!(sender && sender.tab);
  switch (cmd) {
    case 'health': {
      const r = await DriveClient.api(await driveSettings(), '/health');
      return r.ok ? { ok: true, accept_cookies: !!r.accept_cookies, cookies: r.cookies } : { ok: false, error: r.error };
    }
    case 'start': {
      const p = payload || {};
      // רק סרטוני יוטיוב, והקישור נבנה מחדש מהמזהה – לא שולחים לשרת כתובת שרירותית מהדף
      const vid = [p.videoId, p.url && DriveClient.videoIdFromUrl(String(p.url))].find(v => typeof v === 'string' && /^[\w-]{11}$/.test(v));
      if (!vid) return { ok: false, error: { code: 'BAD_URL', message: 'אין קישור תקין לסרטון יוטיוב' } };
      if (fromTab && !tabStartAllowed()) return { ok: false, error: { code: 'RATE_LIMIT', message: 'יותר מדי הורדות בבת אחת. נסו שוב בעוד דקה.' } };
      const title = typeof p.title === 'string' ? p.title.slice(0, 300) : '';
      const job = DriveClient.newJob({ url: 'https://www.youtube.com/watch?v=' + vid, videoId: vid, type: p.type, quality: p.quality, title });
      const started = await startJob(job, true);
      return started.state === 'error' ? { ok: false, job: started, error: started.error } : { ok: true, job: started };
    }
    case 'jobs':
      pollLoop();
      return getJobs();
    case 'shareCookies':
      // שליחת עוגיות ידנית רק מחלון התוסף – סקריפט בדף לא יכול להפעיל אותה
      if (fromTab) return { ok: false, error: { code: 'COOKIES_NOT_ALLOWED', message: 'שיתוף עוגיות נעשה מחלון התוסף' } };
      return shareCookies();
    default:
      return { ok: false, error: { code: 'BAD_COMMAND', message: 'פקודה לא מוכרת' } };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.ytuDrive !== 'string' || sender.id !== chrome.runtime.id) return;
  handle(msg.ytuDrive, msg.payload, sender)
    .then(reply)
    .catch(e => reply({ ok: false, error: { code: 'INTERNAL', message: 'שגיאה פנימית בתוסף', detail: String(e && e.message) } }));
  return true;
});

// --- התראות ---

chrome.notifications.onClicked.addListener(async id => {
  const job = (await getJobs()).find(j => 'ytu-job-' + j.localId === id);
  if (job && job.short_url) chrome.tabs.create({ url: job.short_url });
  chrome.notifications.clear(id);
});

// --- תפריט לחיצה ימנית ---
// הוסר ב-2.1.1: ב-YouTube Premium אין תפריט כזה ("אין ממשק משלנו"). מנקים תפריטים שנשארו מגרסה קודמת.
function setupMenus() {
  try { if (chrome.contextMenus) chrome.contextMenus.removeAll(() => void chrome.runtime.lastError); } catch {}
}

// --- מחזור חיים ---

function ensureAlarm() {
  chrome.alarms.get('ytu-drive-poll', a => {
    if (!a) chrome.alarms.create('ytu-drive-poll', { periodInMinutes: 1 });
  });
}

chrome.runtime.onInstalled.addListener(() => { setupMenus(); ensureAlarm(); pollLoop(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); pollLoop(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'ytu-drive-poll') pollLoop(); });

// ה-worker מתעורר גם מהודעות – להמשיך עבודות פתוחות
ensureAlarm();
pollLoop();
