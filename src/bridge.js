// רץ בעולם המבודד של התוסף: מעביר הגדרות, פקודות ובקשות שרת בין chrome.* לבין main.js שבדף.
// settings.js נטען לפניו (manifest), בשביל רשימת המפתחות הסודיים.
const SECRETS = typeof SECRET_KEYS !== 'undefined' ? SECRET_KEYS : ['apiKey'];
const LOCKED = typeof PAGE_LOCKED_KEYS !== 'undefined' ? PAGE_LOCKED_KEYS : ['apiKey', 'serverUrl', 'shareCookies'];
const PAGE_KEYS = typeof SETTINGS !== 'undefined' ? SETTINGS.map(s => s.key).filter(k => !LOCKED.includes(k)) : [];
// shareCookies לא עובר מהדף: שליחת עוגיות ידנית רק מחלון התוסף
const DRIVE_CMDS = ['health', 'start', 'jobs'];

// הדף לא צריך את מפתח ה-API – לא מעבירים אותו לשם בכלל (גם לא ל-localStorage של יוטיוב)
const stripSecrets = settings => {
  const out = { ...(settings || {}) };
  for (const k of SECRETS) delete out[k];
  return out;
};

const push = settings => {
  const safe = stripSecrets(settings);
  try { localStorage.setItem('ytu-settings', JSON.stringify(safe)); } catch {}
  window.dispatchEvent(new CustomEvent('ytu:settings', { detail: JSON.stringify(safe) }));
};

const toPage = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(detail) }));

chrome.storage.local.get('settings', r => push(r.settings || {}));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) push(changes.settings.newValue || {});
});

// כל סקריפט בדף יוטיוב יכול לשלוח ytu:save, ולכן הדף משנה רק הגדרות רגילות. כתובת השרת, המפתח
// וההסכמה לעוגיות נקבעים רק בחלון התוסף – אחרת דף זדוני יכוון את השרת אליו ויקבל את המפתח והעוגיות.
window.addEventListener('ytu:save', e => {
  let incoming;
  try { incoming = JSON.parse(e.detail); } catch { return; }
  if (!incoming || typeof incoming !== 'object') return;
  chrome.storage.local.get('settings', r => {
    const prev = r.settings || {};
    const next = { ...prev };
    for (const k of PAGE_KEYS) {
      if (k in incoming) next[k] = incoming[k];
      else delete next[k];
    }
    // כיבוי השיתוף מהדף מותר (לא מסוכן); הפעלה – רק מחלון התוסף
    if (incoming.shareCookies === false) next.shareCookies = false;
    try { chrome.storage.local.set({ settings: next }); } catch {}
  });
});

// בקשות לשרת ה-Drive: הדף → background → הדף, לפי מזהה בקשה
window.addEventListener('ytu:request', e => {
  let req;
  try { req = JSON.parse(e.detail); } catch { return; }
  if (!req || req.id == null) return;
  const answer = result => toPage('ytu:response', { id: req.id, result });
  const fail = (code, message) => answer({ ok: false, error: { code, message } });
  if (!DRIVE_CMDS.includes(req.cmd)) return fail('BAD_REQUEST', 'בקשה לא מוכרת');
  try {
    chrome.runtime.sendMessage({ ytuDrive: req.cmd, payload: req.payload }, result => {
      if (chrome.runtime.lastError || result === undefined) return fail('EXTENSION_ERROR', 'אין חיבור לתוסף. רעננו את הדף ונסו שוב.');
      answer(result);
    });
  } catch {
    // התוסף עודכן או נטען מחדש – הגשר הישן כבר לא מחובר
    fail('EXTENSION_ERROR', 'התוסף עודכן. רעננו את הדף ונסו שוב.');
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return;
  if (msg.ytuJob) toPage('ytu:job', msg.ytuJob);
  // הפקודה היחידה מחלון התוסף: פתיחת דיאלוג ההורדה בלשונית
  if (msg.ytu === 'download') window.dispatchEvent(new CustomEvent('ytu:command', { detail: 'download' }));
  reply({ ok: true });
});
