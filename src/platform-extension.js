// גרסת התוסף: הקוד רץ בעולם של הדף (MAIN) ומדבר עם bridge.js דרך אירועים.
// ההגדרות נשמרות גם ב-localStorage כדי שיהיו זמינות מיד בטעינת הדף.
const Platform = {
  kind: 'extension',
  load() {
    try { return JSON.parse(localStorage.getItem('ytu-settings')) || {}; } catch { return {}; }
  },
  save(s) {
    try { localStorage.setItem('ytu-settings', JSON.stringify(s)); } catch {}
    window.dispatchEvent(new CustomEvent('ytu:save', { detail: JSON.stringify(s) }));
  },
  onChange(cb) {
    window.addEventListener('ytu:settings', e => {
      try { cb(JSON.parse(e.detail)); } catch {}
    });
  },
  onCommand(cb) {
    window.addEventListener('ytu:command', e => cb(String(e.detail)));
  },
};
