// ---------- חלון ההורדה ----------
// ההורדה רצה בדף, ולכן סגירת הלשונית הורגת אותה. בטמפרמונקי אין "רקע" של תוסף,
// אבל כן אפשר לפתוח חלון קטן משלנו: הוא נפתח על robots.txt של יוטיוב – דף טקסט
// במשקל בקשה אחת, מאותו מקור (ולכן /youtubei/v1/player עובד) ושהסקריפט שלנו רץ בו.
// החלון מקבל את העבודה, מוריד בעצמו וממשיך גם אחרי שסוגרים את הלשונית של הסרטון.
// אם הדפדפן חוסם חלונות קופצים – חוזרים להורדה רגילה בדף, בלי שהמשתמש יראה תקלה.

const DLW_NAME = 'ytu-download';
const DLW_URL = 'https://www.youtube.com/robots.txt#' + DLW_NAME;
const DLW_JOBS = 'ytu-dl-jobs';
const DLW_ACK_MS = 10000;       // אין סימן חיים מהחלון (טעינה + סקריפט) – מורידים בדף כמו קודם
const DLW_CLOSE_MS = 4000;      // סגירה אוטומטית אחרי שהכול ירד

// בזמן שהחלון נפתח הוא יושב רגע על about:blank – שם אין מקור (location.origin === 'null')
// ואי אפשר לבקש כלום מיוטיוב, ולכן מחכים לדף האמיתי לפני שלוקחים את העבודה.
const dlwIsWindow = () => {
  try {
    if (window.name !== DLW_NAME || window.opener === window) return false;
    return /(^|\.)youtube\.com$/.test(location.hostname);
  } catch { return false; }
};

const dlwChannel = () => {
  try { return new BroadcastChannel('ytu-dl'); } catch { return null; }
};
const dlwBus = dlwChannel();
const dlwSend = msg => { try { if (dlwBus) dlwBus.postMessage(msg); } catch {} };

function dlwReadJobs() {
  try { return JSON.parse(localStorage.getItem(DLW_JOBS)) || []; } catch { return []; }
}
function dlwWriteJobs(jobs) {
  try { localStorage.setItem(DLW_JOBS, JSON.stringify(jobs.slice(-20))); } catch {}
}

// ---------- הצד של הדף ----------

let dlwWin = null;
let dlwAcked = false;
const dlwPending = new Map(); // id -> טיימר נפילה חזרה להורדה בדף

const dlwOn = () => !!(S.downloadWindow && !dlwIsWindow());

// חייב לרוץ בתוך הלחיצה עצמה – אחרת הדפדפן חוסם את החלון
function dlwOpen() {
  try {
    if (dlwWin && !dlwWin.closed) { try { dlwWin.focus(); } catch {} return dlwWin; }
    dlwWin = window.open(DLW_URL, DLW_NAME, 'width=460,height=300,menubar=no,toolbar=no,location=no,status=no');
    return dlwWin && !dlwWin.closed ? dlwWin : null;
  } catch { return null; }
}

// מעביר הורדה לחלון. מחזיר false אם אי אפשר – ואז ההורדה נשארת בדף.
function dlwHandOff(id, choice) {
  if (!dlwOn() || !dlwBus) return false;
  if (!dlwOpen()) return false;
  const job = { id, choice, meta: dlMeta(id), at: Date.now() };
  dlwWriteJobs([...dlwReadJobs().filter(j => j.id !== id), job]);
  dlwSend({ ytu: 'job', job });
  dlSnack(dlT('ההורדה עוברת לחלון הנפרד. אפשר לסגור את הלשונית',
    'The download is moving to the separate window. You can close this tab'), null, 5000);
  clearTimeout(dlwPending.get(id));
  // אם החלון לא ענה (מנהל סקריפטים שלא מזריק לדף טקסט, למשל) – מורידים בדף כרגיל
  dlwPending.set(id, setTimeout(() => {
    dlwPending.delete(id);
    dlwWriteJobs(dlwReadJobs().filter(j => j.id !== id));
    // חלון שאף פעם לא ענה הוא סתם חלון ריק – סוגרים אותו
    if (!dlwAcked && dlwWin && !dlwWin.closed) { try { dlwWin.close(); } catch {} dlwWin = null; }
    dlSnack(dlT('החלון הנפרד לא נטען – ההורדה ממשיכה כאן',
      "The separate window didn't load – downloading here instead"), null, 5000);
    runDownload(id, choice);
  }, DLW_ACK_MS));
  return true;
}

if (dlwBus) {
  dlwBus.onmessage = e => {
    const m = e && e.data;
    if (!m || m.ytu !== 'ack' || dlwIsWindow()) return;
    dlwAcked = true;
    clearTimeout(dlwPending.get(m.id));
    dlwPending.delete(m.id);
  };
}

// ---------- הצד של החלון ----------

const dlwTaken = new Map(); // id -> { choice, meta }

function dlwTake(job) {
  if (!job || dlwTaken.has(job.id)) return;
  dlwTaken.set(job.id, job);
  dlwWriteJobs(dlwReadJobs().filter(j => j.id !== job.id));
  dlwSend({ ytu: 'ack', id: job.id });
  startDownload(job.id, job.choice);
  dlwRender();
}

function dlwWindowStyle() {
  const style = h('style', {}, `
    :root { color-scheme: light dark; }
    body { margin: 0; font: 400 14px/1.4 Roboto, Arial, sans-serif; background: #0f0f0f; color: #f1f1f1;
      direction: ${uiHebrew() ? 'rtl' : 'ltr'}; }
    /* robots.txt הוא דף טקסט – מה שהדפדפן צייר ממנו מוסתר, גם אם הוא נוסף אחרינו */
    body > *:not(.ytu-w) { display: none !important; }
    .ytu-w { padding: 14px 16px; }
    .ytu-w h1 { font-size: 15px; font-weight: 500; margin: 0 0 2px; }
    .ytu-w p { font-size: 12px; color: #aaa; margin: 0 0 12px; }
    .ytu-row { padding: 8px 0; border-top: 1px solid rgba(255,255,255,.1); }
    .ytu-row .t { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ytu-row .s { font-size: 12px; color: #aaa; margin-top: 2px; }
    .ytu-row .s.err { color: #f28b82; }
    .ytu-bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,.2); margin-top: 6px; overflow: hidden; }
    .ytu-bar i { display: block; height: 100%; background: #f03; transition: width .2s; }
  `);
  document.documentElement.append(style);
}

let dlwBody = null;
function dlwRender() {
  if (!dlwBody) return;
  const rows = [...dlwTaken.entries()].map(([id, job]) => {
    const meta = (dlBusy && dlBusy.id === id && dlBusy.meta) || job.meta || {};
    const title = meta.title || id;
    const running = dlBusy && dlBusy.id === id;
    const failed = dlFailed.has(id);
    const done = !running && !failed && dlIsDone(id);
    const pct = running ? (dlBusy.preparing ? 0 : Math.round(dlBusy.percent || 0)) : done ? 100 : 0;
    const state = failed ? MSG.failed()
      : done ? MSG.downloaded()
      : running ? (dlBusy.converting ? dlT('ממיר ל-MP3... ', 'Converting to MP3... ') + pct + '%'
        : dlBusy.preparing ? MSG.preparing() : MSG.percent(pct))
      : MSG.waiting();
    return h('div', { class: 'ytu-row' },
      h('div', { class: 't' }, title),
      h('div', { class: 's' + (failed ? ' err' : '') }, state),
      (running || done) && h('div', { class: 'ytu-bar' }, h('i', { style: 'width:' + pct + '%' })));
  });
  fill(dlwBody,
    h('h1', {}, dlT('הורדות – יוטיוב פרימיום', 'Downloads – YouTube Premium')),
    h('p', {}, dlT('אפשר לסגור את הלשונית של הסרטון. את החלון הזה צריך להשאיר פתוח עד הסוף.',
      'You can close the video tab. Keep this window open until the download finishes.')),
    ...rows);
  document.title = dlBusy
    ? (Math.round(dlBusy.percent || 0) + '% · ' + dlT('הורדות', 'Downloads'))
    : dlT('הורדות – יוטיוב פרימיום', 'Downloads – YouTube Premium');
  // הכול ירד ואין תקלות – סוגרים את החלון לבד
  const idle = !dlBusy && !dlQueue.length && dlwTaken.size;
  const allDone = idle && [...dlwTaken.keys()].every(id => !dlFailed.has(id) && dlIsDone(id));
  if (allDone && !dlwClosing) {
    dlwClosing = setTimeout(() => { try { window.close(); } catch {} }, DLW_CLOSE_MS);
  } else if (!allDone && dlwClosing) {
    clearTimeout(dlwClosing);
    dlwClosing = 0;
  }
}
let dlwClosing = 0;

function dlwStartWindow() {
  document.title = dlT('הורדות – יוטיוב פרימיום', 'Downloads – YouTube Premium');
  dlwWindowStyle();
  dlwBody = h('div', { class: 'ytu-w' });
  document.body.append(dlwBody);
  if (dlwBus) {
    dlwBus.onmessage = e => { const m = e && e.data; if (m && m.ytu === 'job') dlwTake(m.job); };
  }
  for (const job of dlwReadJobs()) dlwTake(job);
  setInterval(dlwRender, 250);
  dlwRender();
}
