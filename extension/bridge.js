// רץ בעולם המבודד של התוסף: מעביר הגדרות ופקודות בין chrome.* לבין main.js שבדף.
// settings.js נטען לפניו (manifest), בשביל רשימת המפתחות.
const PAGE_KEYS = typeof SETTINGS !== 'undefined' ? SETTINGS.map(s => s.key) : [];

// רק מפתחות מוכרים (ערכים ישנים שנשארו באחסון מגרסאות קודמות לא עוברים לדף)
const known = settings => Object.fromEntries(Object.entries(settings || {}).filter(([k]) => PAGE_KEYS.includes(k)));

const push = settings => {
  const safe = known(settings);
  try { localStorage.setItem('ytu-settings', JSON.stringify(safe)); } catch {}
  window.dispatchEvent(new CustomEvent('ytu:settings', { detail: JSON.stringify(safe) }));
};

chrome.storage.local.get('settings', r => push(r.settings || {}));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) push(changes.settings.newValue || {});
});

// הדף שומר רק מפתחות מוכרים של ההגדרות
window.addEventListener('ytu:save', e => {
  let incoming;
  try { incoming = JSON.parse(e.detail); } catch { return; }
  if (!incoming || typeof incoming !== 'object') return;
  try { chrome.storage.local.set({ settings: known(incoming) }); } catch {}
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return;
  // הפקודה היחידה מחלון התוסף: פתיחת דיאלוג ההורדה בלשונית
  if (msg.ytu === 'download') window.dispatchEvent(new CustomEvent('ytu:command', { detail: 'download' }));
  reply({ ok: true });
});
