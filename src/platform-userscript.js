// גרסת הטמפרמונקי (@grant none): ההגדרות ב-localStorage של יוטיוב.
// שרת ה-Drive: הממסר נגיש ב-fetch ישירות מהדף, אז DriveClient רץ כאן והעבודות נשמרות ב-localStorage.
const Platform = (() => {
  const JOBS_KEY = 'ytu-drive-jobs';
  const LEASE_KEY = 'ytu-drive-poller';
  const MAX_JOBS = 30;
  const POLL_MS = 5000;
  const tabId = Math.random().toString(36).slice(2);

  const load = () => {
    try { return JSON.parse(localStorage.getItem('ytu-settings')) || {}; } catch { return {}; }
  };
  const driveSettings = () => {
    const s = { ...DEFAULTS, ...load() };
    return { serverUrl: s.serverUrl, apiKey: s.apiKey || '' };
  };
  const hasClient = () => typeof DriveClient !== 'undefined';
  const noClient = () => ({ ok: false, error: { code: 'INTERNAL', message: 'רכיב השרת לא נטען' } });
  const isActive = j => !!j && (hasClient() ? DriveClient.isActive(j) : ['queued', 'checking', 'downloading', 'converting', 'copying', 'uploading', 'shortening'].includes(j.state));

  const readJobs = () => {
    try {
      const list = JSON.parse(localStorage.getItem(JOBS_KEY));
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  };
  const writeJobs = list => {
    try { localStorage.setItem(JOBS_KEY, JSON.stringify(list.slice(0, MAX_JOBS))); } catch {}
  };

  const listeners = [];
  const emit = job => {
    for (const cb of listeners) {
      try { cb(job); } catch {}
    }
  };

  // מחליף עבודה לפי localId על גבי הרשימה העדכנית (לשונית אחרת אולי הוסיפה בינתיים)
  const putJob = job => {
    const list = readJobs();
    const i = list.findIndex(x => x.localId === job.localId);
    if (i >= 0) list[i] = job;
    else list.unshift(job);
    writeJobs(list);
    emit(job);
  };

  // כמה לשוניות יוטיוב פתוחות – רק אחת בודקת מול השרת (כל בדיקה עולה מהמכסה של הממסר).
  // בזמן בדיקה החכירה ארוכה מקריאה אחת לממסר (עד 3 ניסיונות של timeout), כדי שלשונית אחרת לא תיכנס באמצע.
  const callBudget = () => (hasClient() ? (DriveClient.timeout || 60000) + (DriveClient.retryDelay || 1500) : 60000) * 3 + 5000;
  const takeLease = ms => {
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
      if (lease && lease.tab !== tabId && Date.now() < lease.until) return false;
      localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: tabId, until: Date.now() + ms }));
      return true;
    } catch { return true; }
  };
  // לשונית שנסגרת משחררת את החכירה מיד
  window.addEventListener('pagehide', () => {
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
      if (lease && lease.tab === tabId) localStorage.removeItem(LEASE_KEY);
    } catch {}
  });

  let timer = null, polling = false;
  async function pollOnce() {
    if (polling || !hasClient()) return;
    const active = readJobs().filter(isActive);
    if (!active.length) {
      clearInterval(timer);
      timer = null;
      return;
    }
    if (!takeLease(POLL_MS * 3)) return;
    polling = true;
    try {
      const settings = driveSettings();
      for (const job of active) {
        // חידוש לפני כל קריאה; אם לשונית אחרת לקחה בינתיים – עוצרים
        if (!takeLease(callBudget())) break;
        let next;
        try { next = await DriveClient.poll(settings, job); } catch { continue; }
        if (!next || JSON.stringify(next) === JSON.stringify(job)) continue;
        // כותבים רק אם העבודה השמורה לא השתנתה מאז שנקראה – תשובה ישנה לא דורסת מצב חדש
        const stored = readJobs().find(x => x.localId === job.localId);
        if (!stored || JSON.stringify(stored) !== JSON.stringify(job)) continue;
        putJob(next);
      }
    } finally {
      polling = false;
      takeLease(POLL_MS * 3);
    }
  }

  function ensurePolling() {
    if (timer || !readJobs().some(isActive)) return;
    timer = setInterval(pollOnce, POLL_MS);
  }

  // עדכונים שלשונית אחרת כתבה
  window.addEventListener('storage', e => {
    if (e.key !== JOBS_KEY) return;
    let prev = [], next = [];
    try { prev = JSON.parse(e.oldValue) || []; } catch {}
    try { next = JSON.parse(e.newValue) || []; } catch {}
    const before = new Map(prev.map(j => [j.localId, JSON.stringify(j)]));
    for (const j of next) if (before.get(j.localId) !== JSON.stringify(j)) emit(j);
    ensurePolling();
  });

  // אחרי רענון – ממשיכים לעקוב אחרי עבודות שעוד רצות
  setTimeout(ensurePolling, 2000);

  return {
    kind: 'userscript',
    load,
    save(s) {
      try { localStorage.setItem('ytu-settings', JSON.stringify(s)); } catch {}
    },
    onChange(cb) {
      window.addEventListener('storage', e => {
        if (e.key !== 'ytu-settings') return;
        try { cb(JSON.parse(e.newValue) || {}); } catch {}
      });
    },
    onCommand() {},
    drive: {
      canShareCookies: false,
      async health() {
        if (!hasClient()) return noClient();
        try { return await DriveClient.api(driveSettings(), '/health'); } catch { return noClient(); }
      },
      async start(opts) {
        if (!hasClient()) return noClient();
        const settings = driveSettings();
        let job = DriveClient.newJob(opts || {});
        putJob(job);
        try {
          job = await DriveClient.start(settings, job);
        } catch {
          job = { ...job, state: 'error', error: { code: 'INTERNAL', message: 'שליחת ההורדה נכשלה' } };
        }
        putJob(job);
        ensurePolling();
        return job.state === 'error' ? { ok: false, job, error: job.error } : { ok: true, job };
      },
      async jobs() {
        ensurePolling();
        return readJobs();
      },
      onJob(cb) {
        if (typeof cb === 'function') listeners.push(cb);
      },
      async shareCookies() {
        return { ok: false, error: { code: 'UNSUPPORTED', message: 'שיתוף עוגיות זמין רק בגרסת התוסף לכרום' } };
      },
    },
  };
})();
