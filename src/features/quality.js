// ---------- 4. איכות מרבית ----------

let qualityDoneFor = '';

// המשתמש בחר איכות בעצמו בתפריט – לא נוגעים יותר בסרטון הזה.
function markManualQuality(e) {
  if (!e.isTrusted) return;
  const t = e.target;
  const inMenu = t.closest?.('.ytp-quality-menu .ytp-menuitem');
  const mobileSelect = t.tagName === 'SELECT' && [...t.options].some(o => /\d{3,4}p/.test(o.textContent));
  if (inMenu || mobileSelect) qualityDoneFor = videoId() || qualityDoneFor;
}
document.addEventListener('click', markManualQuality, true);
document.addEventListener('change', markManualQuality, true);

// איכויות שרק מנויי Premium יכולים לבחור ("1080p Premium") – הבחירה בהן נכשלת או פותחת הצעה.
const isPaygated = q => !!(q.paygatedQualityDetails || /premium/i.test(q.qualityLabel || ''));

function applyQuality() {
  const id = videoId();
  if (!S.maxQuality || !id || qualityDoneFor === id) return;
  const p = activePlayer();
  if (!p || typeof p.getAvailableQualityLevels !== 'function') return;
  if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) return;
  // במעבר SPA הנגן עוד מחזיק את הסרטון הקודם – מחכים שיתעדכן, אחרת נסמן את החדש כגמור.
  try {
    const current = p.getVideoData?.()?.video_id;
    if (current && current !== id) return;
  } catch {}
  // מיוזיק במצב שיר (שמע בלבד): אין איכות וידאו לבחור, ומתג השמע/וידאו הוא של המשתמש.
  if (SITE === 'music' && document.querySelector('ytmusic-player[playback-mode="ATV_PREFERRED"]')) {
    qualityDoneFor = id;
    return;
  }
  const levels = p.getAvailableQualityLevels() || [];
  if (!levels.length || levels[0] === 'auto') return;
  let best = levels.find(q => q !== 'auto');
  try {
    const data = p.getAvailableQualityData?.() || [];
    const playable = data.filter(q => q.isPlayable !== false && q.quality !== 'auto' && !isPaygated(q));
    if (playable.length) best = playable[0].quality;
    else if (data.length) return;
  } catch {}
  if (!best) return;
  p.setPlaybackQualityRange?.(best, best);
  p.setPlaybackQuality?.(best);
  qualityDoneFor = id;
}
