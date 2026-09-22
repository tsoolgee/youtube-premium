// גרסת הטמפרמונקי (@grant none): ההגדרות ב-localStorage של יוטיוב.
const Platform = {
  kind: 'userscript',
  load() {
    try { return JSON.parse(localStorage.getItem('ytu-settings')) || {}; } catch { return {}; }
  },
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
};
