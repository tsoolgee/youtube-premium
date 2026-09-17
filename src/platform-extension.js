// גרסת התוסף: הקוד רץ בעולם של הדף (MAIN) ומדבר עם bridge.js דרך אירועים.
// ההגדרות נשמרות גם ב-localStorage כדי שיהיו זמינות מיד בטעינת הדף.
const Platform = (() => {
  const pending = new Map();
  let seq = 0;

  window.addEventListener('ytu:response', e => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    const p = msg && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg.result);
  });

  // הממסר של גוגל איטי ומנסה שוב על תקלות, אז זמני ההמתנה נדיבים
  function request(cmd, payload, timeout) {
    return new Promise(resolve => {
      const id = 'r' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: { code: 'TIMEOUT', message: 'התוסף לא ענה בזמן. נסו שוב.' } });
      }, timeout);
      pending.set(id, { resolve, timer });
      window.dispatchEvent(new CustomEvent('ytu:request', { detail: JSON.stringify({ id, cmd, payload }) }));
    });
  }

  const jobListeners = [];
  window.addEventListener('ytu:job', e => {
    let job;
    try { job = JSON.parse(e.detail); } catch { return; }
    if (!job || typeof job !== 'object') return;
    for (const cb of jobListeners) {
      try { cb(job); } catch {}
    }
  });

  return {
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
    drive: {
      canShareCookies: true,
      health: () => request('health', null, 45000),
      // שליחה אחת דרך הממסר: עד 3 ניסיונות של 60 שניות. הניסיון החוזר עם עוגיות לא נכלל – הוא מגיע בשידור
      start: opts => request('start', opts || {}, 200000),
      async jobs() {
        const r = await request('jobs', null, 15000);
        return Array.isArray(r) ? r : (r && Array.isArray(r.jobs) ? r.jobs : []);
      },
      onJob(cb) {
        if (typeof cb === 'function') jobListeners.push(cb);
      },
      // שליחת עוגיות רק מחלון התוסף (הגשר לא מעביר את הפקודה מהדף)
      shareCookies: async () => ({ ok: false, error: { code: 'COOKIES_NOT_ALLOWED', message: 'שיתוף העוגיות נעשה מחלון התוסף (לחיצה על סמל התוסף).' } }),
    },
  };
})();
