// ---------- 3. תמונה בתוך תמונה ----------

// הסרטון לחלון הצף: הריל הפעיל בשורטס, הנגן של מיוזיק, ולא תצוגה מקדימה מדף הבית.
function pipVideo() {
  return mainVideo() || video();
}

async function openPip(v) {
  v.disablePictureInPicture = false;
  v.removeAttribute('disablepictureinpicture');
  await v.requestPictureInPicture();
}

// שורטס: כל ריל הוא אלמנט video אחר. כשגוללים בזמן שהחלון הצף פתוח – מעבירים אותו לריל החדש
// (כשכבר יש חלון צף, הדפדפן לא דורש לחיצה של המשתמש).
document.addEventListener('playing', e => {
  const cur = document.pictureInPictureElement, v = e.target;
  if (!S.pip || !cur || cur === v || !(v instanceof HTMLVideoElement) || !onShorts()) return;
  if (!cur.paused || v.closest(PREVIEW_SEL) || !v.videoWidth) return;
  openPip(v).catch(() => {});
}, true);

let autoPipOn = null;
let pageSetPipHandler = null;
const autoPipHandler = () => {
  const v = pipVideo();
  if (v && !v.paused && v.videoWidth && !document.pictureInPictureElement) openPip(v).catch(() => {});
};

// אם יוטיוב ירשום בעתיד handler משלו ל-enterpictureinpicture – לא נדרוס אותו ולא הוא אותנו.
try {
  const ms = navigator.mediaSession;
  const set = ms && ms.setActionHandler;
  if (set) {
    ms.setActionHandler = function (action, handler) {
      if (action === 'enterpictureinpicture') {
        pageSetPipHandler = handler;
        if (autoPipOn) return;
      }
      return set.apply(this, arguments);
    };
  }
} catch {}

// 'mobile' – רק ב-m.youtube, כמו Premium בטלפון (ברירת המחדל, וכך זה היה עד 0.0.6).
// 'always' – גם ב-www וב-Music. כרום מפעיל את זה רק מגרסה 134 ורק כשהסרטון מתנגן ונשמע,
// ובפעם הראשונה הוא שואל את המשתמש אם לאשר – ולכן זו בחירה של המשתמש ולא ברירת מחדל.
function applyAutoPip() {
  const mode = S.autoPip;
  const want = !!(S.pip && (mode === 'always' || (mode === 'mobile' && SITE === 'mobile')));
  if (want === autoPipOn || !navigator.mediaSession) return;
  const first = autoPipOn === null;
  autoPipOn = want;
  if (first && !want) return; // לא רשמנו כלום – אין מה להחזיר
  try {
    // קוראים ישירות ל-prototype כדי לעקוף את העטיפות שלמעלה.
    MediaSession.prototype.setActionHandler.call(navigator.mediaSession, 'enterpictureinpicture', want ? autoPipHandler : pageSetPipHandler);
  } catch {}
}
