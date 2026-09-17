// ---------- 2. ניגון ברקע ----------

const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
const realVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

Object.defineProperty(Document.prototype, 'hidden', {
  configurable: true, enumerable: true,
  get() { return S.background ? false : realHidden.get.call(this); },
});
Object.defineProperty(Document.prototype, 'visibilityState', {
  configurable: true, enumerable: true,
  get() { return S.background ? 'visible' : realVisibility.get.call(this); },
});
for (const name of ['webkitHidden', 'webkitVisibilityState']) {
  const real = Object.getOwnPropertyDescriptor(Document.prototype, name);
  if (!real) continue;
  Object.defineProperty(Document.prototype, name, {
    configurable: true, enumerable: true,
    get() { return S.background ? (name === 'webkitHidden' ? false : 'visible') : real.get.call(this); },
  });
}

// מתי הדף באמת הוסתר – לפי הערך האמיתי, לפני שחוסמים את האירוע.
let hiddenAt = 0;
for (const target of [window, document]) {
  for (const ev of ['visibilitychange', 'webkitvisibilitychange']) {
    target.addEventListener(ev, e => {
      if (target === window && realHidden.get.call(document)) hiddenAt = Date.now();
      if (S.background) e.stopImmediatePropagation();
    }, true);
  }
}

// במובייל ובמיוזיק הנגן עוצר גם על blur של החלון (מעבר אפליקציה / מסך נעול).
// חוסמים רק blur של window עצמו – blur של שדות ותפריטים ממשיך כרגיל. ב-www לא צריך
// (blur שם קורה גם כשסתם עוברים לחלון אחר, ולא עוצר את הנגן).
window.addEventListener('blur', e => {
  if (!S.background || e.target !== window || SITE === 'www') return;
  hiddenAt = Date.now();
  e.stopImmediatePropagation();
}, true);

// עצירה שהמשתמש ביקש דרך כפתורי המדיה (התראה, מקלדת, אוזניות) – לא מחדשים אחריה.
let mediaPauseAt = 0;
try {
  const ms = navigator.mediaSession;
  const set = ms && ms.setActionHandler;
  if (set) {
    ms.setActionHandler = function (action, handler) {
      if ((action === 'pause' || action === 'stop') && typeof handler === 'function') {
        const orig = handler;
        handler = function () { mediaPauseAt = Date.now(); return orig.apply(this, arguments); };
      }
      return set.call(this, action, handler);
    };
  }
} catch {}

// הנגן עצר את הסרטון מיד אחרי שהדף הוסתר (ולא בגלל המשתמש) – ממשיכים לנגן.
document.addEventListener('pause', e => {
  const v = e.target;
  if (!S.background || !(v instanceof HTMLMediaElement) || v.ended) return;
  const now = Date.now();
  if (now - hiddenAt > 1000 || now - mediaPauseAt < 2000) return;
  if (v.closest(PREVIEW_SEL)) return;
  if (document.querySelector('.html5-video-player.ad-showing')) return;
  setTimeout(() => { if (v.paused && !v.ended) v.play().catch(() => {}); }, 50);
}, true);

// "הסרטון הושהה. להמשיך לצפות?" ב-www מגיע כ-yt-confirm-dialog-renderer רגיל, אז בודקים
// שזה באמת הדיאלוג הזה (youThereRenderer בנתונים או הטקסט המוכר) – לא לוחצים על שום דיאלוג אחר.
const IDLE_TEXT = /continue watching|still watching|להמשיך (?:לצפות|בצפייה)|עדיין צופים/i;

function isIdlePrompt(dialog) {
  try {
    const data = dialog.data || dialog.polymerController?.data || dialog.__data?.data;
    if (data && /youThere/i.test(JSON.stringify(data).slice(0, 4000))) return true;
  } catch {}
  const text = (dialog.querySelector('#main, yt-formatted-string#title, #scrollable') || dialog).textContent || '';
  return text.length < 200 && IDLE_TEXT.test(text);
}

function dismissIdlePrompt() {
  if (!S.background) return;
  // מיוזיק ומובייל: רכיב ייעודי, בטוח ללחוץ.
  document.querySelector('ytmusic-you-there-renderer button, ytmusic-you-there-renderer tp-yt-paper-button, ytm-you-there-renderer button')?.click();
  for (const dialog of document.querySelectorAll('ytd-popup-container yt-confirm-dialog-renderer')) {
    if (!dialog.getClientRects().length || !isIdlePrompt(dialog)) continue;
    const ok = dialog.querySelector('#confirm-button button, #confirm-button tp-yt-paper-button, #confirm-button');
    if (!ok) continue;
    ok.click();
    const v = mainVideo();
    if (v && v.paused && !v.ended) v.play().catch(() => {});
  }
}

function keepAwake() {
  if (!S.background) return;
  // יוטיוב מחשב חוסר פעילות לפי _lact ושואל "עדיין צופים?"
  window._lact = Date.now();
  dismissIdlePrompt();
}

// keepAwake רץ פעם בדקה מ-main; הדיאלוג עוצר את הסרטון מיד, אז בודקים אותו לעתים קרובות יותר.
setInterval(() => { try { dismissIdlePrompt(); } catch {} }, 2000);
