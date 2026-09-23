// ---------- 5. מהירויות ----------
// הדרך של Premium: השרת שולח playerConfig.granularVariableSpeedConfig.maximumPlaybackRate=400 ובלי
// showPlaybackRateUpsellPanelCommand – ads.js (prune) משנה את זה בתשובה, והנגן של יוטיוב עצמו מצייר
// את הסליידר עד 4, את תג ה-Premium, + / −, Shift+> ושמירה בין סרטונים. כל מה שבקובץ הזה הוא גיבוי
// כשהנגן לא קיבל את הנתונים (טמפרמונקי שנטען מאוחר, m.youtube) – ואז לא נוגעים כשהנגן כבר תומך בעצמו.
// אין קיצורים ואין ממשק משלנו: תפריט ⚙ → "מהירות הפעלה" של יוטיוב עצמו מגיע עד 4
// (הסליידר, + / −, והצ'יפ 3.0 של Premium). הקיצורים המקוריים של יוטיוב (Shift+> / Shift+<)
// לא קוראים ל-API הציבורי של הנגן (נבדק ביוטיוב האמיתי: נעצרים ב-2), לכן מעל 2 ממשיכים
// אותם כאן באותם צעדים של Premium ועם הבזל של יוטיוב – זה הקיצור של יוטיוב, לא קיצור חדש.

const SPEED_MAX = 4;
const SPEED_YT_MAX = 2;
const SPEED_KEY = 'ytu-speed'; // מגרסאות קודמות – נמחק, המהירות לא נשמרת בין טעינות

// מהירות מעל 2 שביקשנו: הנגן של יוטיוב לא מכיר אותה ומחזיר את האלמנט למהירות שלו
// (בסוף פרסומת, החלפת איכות, סרטון הבא). שומרים אותה ומחילים שוב – אלא אם המשתמש שינה
// מהירות דרך הממשק של יוטיוב (getPlaybackRate השתנה).
let speedWant = null; // { rate, ytRate, v, fixes, since }

function speedWanted(v) {
  if (!S.speed) return null;
  return speedWant && speedWant.v === v ? speedWant.rate : null;
}

function ytRate(p) {
  try {
    const get = p && (p.__ytuGetRate || p.getPlaybackRate);
    return get ? get.call(p) : null;
  } catch { return null; }
}

function ytSetRate(p, rate) {
  try {
    const set = p && (p.__ytuSetRate || p.setPlaybackRate);
    if (set) set.call(p, rate);
  } catch {}
}

// כמו ביוטיוב עצמו (נבדק 23/09/2026): המהירות נשמרת בין סרטונים באותה לשונית, אבל ריענון
// מחזיר ל"רגילה" – יוטיוב לא שומר אותה באחסון. לכן גם אצלנו זה בזיכרון בלבד.
let speedSaved = null;
try { localStorage.removeItem(SPEED_KEY); } catch {}
const speedStore = {
  get() { return speedSaved > SPEED_YT_MAX && speedSaved <= SPEED_MAX ? speedSaved : null; },
  set(r) { speedSaved = r > SPEED_YT_MAX ? r : null; },
};

// הנגן של יוטיוב כבר מכיר מהירויות מעל 2 (קיבל את נתוני Premium) – הגיבוי לא פועל
function nativePremium(p) {
  p = p || activePlayer();
  try {
    const get = p && (p.__ytuGetRates || p.getAvailablePlaybackRates);
    const rates = get ? get.call(p) : null;
    return Array.isArray(rates) && rates.some(r => r > SPEED_YT_MAX);
  } catch { return false; }
}

function setRate(rate) {
  if (!S.speed) return;
  const v = mainVideo() || video();
  if (!v) return;
  rate = Math.min(SPEED_MAX, Math.max(0.25, Math.round(rate * 20) / 20));
  const p = activePlayer();
  // עד 2 – נותנים לנגן של יוטיוב לקבוע, וזה גם מה שהוא זוכר לסרטון הבא.
  // מעל 2 לא נוגעים בו: פעם סנכרנו אותו ל-2 (המקסימום שלו), והוא היה מחזיר את הסרטון
  // ל-2 בכל טעינה, פרסומת או החלפת איכות – משם הגיע ה"חוזר לכפול 2".
  if (rate <= SPEED_YT_MAX) ytSetRate(p, rate);
  // נמדד לפני שינוי האלמנט: יש גרסאות נגן ש-getPlaybackRate שלהן קורא מהאלמנט עצמו.
  const yt = ytRate(p);
  // גם עד 2: הנגן לא משנה את האלמנט כשהוא כבר "חושב" שהמהירות 2 (למשל 2.25 → 2)
  if (v.playbackRate !== rate) v.playbackRate = rate;
  speedWant = rate > SPEED_YT_MAX ? { rate, ytRate: yt, v, fixes: 0, since: Date.now() } : null;
  speedStore.set(rate);
  syncSpeedUi();
}

// המשתמש בחר מהירות עד 2 בממשק של יוטיוב – מוותרים על המהירות שלנו
function dropSpeedWant() {
  if (!speedWant) return;
  speedWant = null;
  speedStore.set(null);
}

document.addEventListener('ratechange', e => {
  const w = speedWant, v = e.target;
  if (!S.speed || !w || v !== w.v || v.playbackRate === w.rate) return;
  if (!v.isConnected || document.querySelector('.html5-video-player.ad-showing')) return;
  const cur = ytRate(activePlayer());
  if (cur != null && w.ytRate != null && cur !== w.ytRate) { dropSpeedWant(); syncSpeedUi(); return; }
  // הגנה מלולאה מול הנגן: לכל היותר 5 תיקונים בשתי שניות.
  if (Date.now() - w.since > 2000) { w.since = Date.now(); w.fixes = 0; }
  if (++w.fixes > 5) { speedWant = null; return; }
  v.playbackRate = w.rate;
}, true);

// סרטון חדש (גם אלמנט video חדש, למשל בשורטס) – המהירות נשמרת כמו ביוטיוב
document.addEventListener('loadeddata', e => {
  const v = e.target;
  if (!S.speed || !(v instanceof HTMLVideoElement) || v.closest(PREVIEW_SEL)) return;
  if (speedWant && speedWant.v === v) return;
  // הנגן כבר תומך ב-Premium בעצמו – הגיבוי לא מתחרה בו
  if (nativePremium(activePlayer())) { speedStore.set(null); return; }
  const saved = speedStore.get();
  if (!saved || document.querySelector('.html5-video-player.ad-showing')) return;
  if (v !== mainVideo()) return;
  setRate(saved);
}, true);

// ---------- getAvailablePlaybackRates / setPlaybackRate של הנגן ----------

// הרשימה של Premium בנגן (N$e ב-base.js): 2.5, 3, 3.5, 4
const PREMIUM_RATES = [2.5, 3, 3.5, 4];

function patchPlayerRates(p) {
  if (!p || p.__ytuRatesPatched || typeof p.getAvailablePlaybackRates !== 'function') return;
  const getRates = p.getAvailablePlaybackRates, setR = p.setPlaybackRate, getR = p.getPlaybackRate;
  try {
    p.__ytuSetRate = setR;
    p.__ytuGetRate = getR;
    p.__ytuGetRates = getRates;
    p.getAvailablePlaybackRates = function () {
      const base = getRates.apply(this, arguments) || [];
      if (!S.speed || base.some(r => r > SPEED_YT_MAX)) return base;
      return [...base.filter(r => r <= SPEED_YT_MAX), ...PREMIUM_RATES];
    };
    if (typeof setR === 'function') {
      p.setPlaybackRate = function (rate) {
        if (S.speed && +rate > SPEED_YT_MAX && !nativePremium(this)) return setRate(+rate);
        dropSpeedWant();
        return setR.apply(this, arguments);
      };
    }
    if (typeof getR === 'function') {
      p.getPlaybackRate = function () {
        const w = speedWanted(mainVideo());
        return w != null ? w : getR.apply(this, arguments);
      };
    }
    p.__ytuRatesPatched = true;
  } catch {}
}

function patchPlayers() {
  for (const p of document.querySelectorAll('#movie_player, #shorts-player, .html5-video-player')) patchPlayerRates(p);
}

// ---------- תפריט "מהירות הפעלה" המקורי ----------

const SPEED_SLIDER = 'input.ytp-varispeed-input-slider';
const fmtRate = r => r.toFixed(2) + 'x';
const currentRate = () => { const v = mainVideo() || video(); return v ? v.playbackRate : 1; };
const chipRate = btn => { const m = (btn.textContent || '').match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; };
const incSign = btn => (/^\s*\+\s*$/.test(btn.textContent || '') ? 1 : /^\s*[-−]\s*$/.test(btn.textContent || '') ? -1 : 0);

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

const MWEB_SPEED = 'variable-speed-controller-view-model';
const MWEB_SLIDER = 'variable-speed-controller-view-model input.ytSliderShapeHostSlider';
let speedTouched = false; // המשתמש עבר את 2 בסשן הזה – מעדכנים גם את השורה בתפריט הראשי
let speedDragging = null; // הסליידר שנגרר עכשיו – לא כותבים לו ערך באמצע
window.addEventListener('pointerdown', e => {
  const t = e.target;
  if (t && t.matches && t.matches(SPEED_SLIDER + ', ' + MWEB_SLIDER)) speedDragging = t;
}, true);
window.addEventListener('pointerup', () => { speedDragging = null; }, true);

function syncSpeedUi() {
  if (!S.speed || nativePremium()) return;
  // תמיד לפי המהירות האמיתית של הסרטון: אחרי 2.25 → 2 יוטיוב לא מצייר מחדש (אצלו המהירות כבר 2)
  const rate = currentRate();
  for (const slider of document.querySelectorAll(SPEED_SLIDER)) {
    if (slider.max !== String(SPEED_MAX)) slider.max = String(SPEED_MAX);
    if (slider.getAttribute('aria-valuemax') !== String(SPEED_MAX)) slider.setAttribute('aria-valuemax', String(SPEED_MAX));
    const panelEl = slider.closest('.ytp-variable-speed-panel-content') || slider.closest('.ytp-panel');
    // מעבר לכפתורים: יוטיוב עשוי להשבית את "+" ב-2
    for (const b of panelEl ? panelEl.querySelectorAll('.ytp-variable-speed-panel-increment-button') : []) {
      if (b.disabled && incSign(b) > 0 && rate < SPEED_MAX) b.disabled = false;
    }
    // הצ'יפ 3.0: בלי סמל ההצעה של Premium
    for (const icon of panelEl ? panelEl.querySelectorAll('.ytp-variable-speed-panel-premium-upsell-icon') : []) {
      if (icon.style.display !== 'none') icon.style.display = 'none';
    }
    const shown = slider === speedDragging ? +slider.value : rate;
    if (slider !== speedDragging) {
      if (Math.abs(+slider.value - rate) > 1e-6) slider.value = String(rate);
      if (slider.getAttribute('aria-valuenow') !== String(rate)) slider.setAttribute('aria-valuenow', String(rate));
      if (slider.getAttribute('aria-valuetext') !== rate.toFixed(2)) slider.setAttribute('aria-valuetext', rate.toFixed(2));
    }
    const pct = ((shown - 0.25) / (SPEED_MAX - 0.25) * 100) + '%';
    if (slider.style.getPropertyValue('--yt-slider-shape-gradient-percent') !== pct) slider.style.setProperty('--yt-slider-shape-gradient-percent', pct);
    if (!panelEl) continue;
    setText(panelEl.querySelector('.ytp-variable-speed-panel-display span'), fmtRate(shown));
    setText(panelEl.querySelector('.ytp-speedslider-text'), fmtRate(shown));
    // תג ה-Premium ליד "3.00x" (כמו oO() בנגן: מוצג מעל 2)
    const badge = panelEl.querySelector('.ytp-variable-speed-panel-premium-badge');
    const above = shown > SPEED_YT_MAX;
    if (badge && badge.classList.contains('ytp-variable-speed-panel-premium-badge-visible') !== above) {
      badge.classList.toggle('ytp-variable-speed-panel-premium-badge-visible', above);
    }
  }
  syncMwebSpeed(rate);
  if (!speedTouched && speedWanted(mainVideo()) == null) return;
  // התפריט הראשי: "מהירות הפעלה | 3" (ב-1 "רגילה" – יוטיוב כותב בעצמו)
  for (const item of document.querySelectorAll('.ytp-settings-menu .ytp-menuitem')) {
    const label = item.querySelector('.ytp-menuitem-label');
    if (!label || !/מהירות|speed/i.test(label.textContent || '')) continue;
    if (rate !== 1) setText(item.querySelector('.ytp-menuitem-content'), String(+rate.toFixed(2)));
  }
}

// ---------- m.youtube: הגיליון ⚙ → "מהירות" (variable-speed-controller-view-model) ----------
// נבדק ב-16/09/2026: .ytwVariableSpeedControllerViewModelPlaybackSpeedDisplay "1.00x",
// input.ytSliderShapeHostSlider min=0.25 max=2, שני .ytSliderShapeHostIncrementButton (− ראשון ב-DOM), צ'יפים עד 2x.
function syncMwebSpeed(rate) {
  for (const host of document.querySelectorAll(MWEB_SPEED)) {
    const slider = host.querySelector('input.ytSliderShapeHostSlider');
    if (!slider) continue;
    if (slider.max !== String(SPEED_MAX)) slider.max = String(SPEED_MAX);
    if (slider.getAttribute('aria-valuemax') !== String(SPEED_MAX)) slider.setAttribute('aria-valuemax', String(SPEED_MAX));
    const shown = slider === speedDragging ? +slider.value : rate;
    if (slider !== speedDragging && Math.abs(+slider.value - rate) > 1e-6) {
      slider.value = String(rate);
      slider.setAttribute('aria-valuenow', String(rate));
      slider.setAttribute('aria-valuetext', String(rate));
    }
    const pct = ((shown - 0.25) / (SPEED_MAX - 0.25) * 100) + '%';
    if (slider.style.getPropertyValue('--yt-slider-shape-gradient-percent') !== pct) slider.style.setProperty('--yt-slider-shape-gradient-percent', pct);
    setText(host.querySelector('.ytwVariableSpeedControllerViewModelPlaybackSpeedDisplay'), fmtRate(shown));
    for (const b of host.querySelectorAll('.ytSliderShapeHostIncrementButton')) {
      if (rate < SPEED_MAX && b.disabled) b.disabled = false;
    }
  }
}

function mwebIncSign(btn) {
  const box = btn.closest('slider-shape, .ytSliderShapeHost');
  const all = box ? [...box.querySelectorAll('.ytSliderShapeHostIncrementButton')] : [];
  if (all.length < 2) return 0;
  return btn === all[0] ? -1 : btn === all[all.length - 1] ? 1 : 0;
}

// מקבלים את האירועים לפני יוטיוב (capture על window) רק כשהערך מעבר ל-2
function speedIntercept(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function onSpeedSlider(e) {
  const t = e.target;
  if (!S.speed || !t || !t.matches || !t.matches(SPEED_SLIDER + ', ' + MWEB_SLIDER) || nativePremium()) return;
  const val = +t.value;
  if (val > SPEED_YT_MAX) {
    e.stopImmediatePropagation();
    speedTouched = true;
    setRate(val);
  } else {
    const was = currentRate();
    if (speedWant) dropSpeedWant();
    // אחרי ה-handler של יוטיוב: מ-2.25 ל-2 הנגן לא משנה את הסרטון (אצלו המהירות כבר 2) – משנים בעצמנו,
    // ומתקנים את המילוי לסקאלה של 4
    setTimeout(() => {
      try {
        const v = mainVideo() || video();
        if (v && was > SPEED_YT_MAX && Math.abs(v.playbackRate - val) > 1e-6) v.playbackRate = val;
        syncSpeedUi();
      } catch {}
    }, 0);
  }
}

function onSpeedClick(e) {
  if (!S.speed || !e.target || !e.target.closest || nativePremium()) return;
  const chip = e.target.closest('.ytp-variable-speed-panel-preset-button, ytw-variable-speed-controller-speed-button-view-model button');
  if (chip) {
    const r = chipRate(chip);
    if (r == null) return;
    if (r > SPEED_YT_MAX) {
      speedIntercept(e);
      if (e.type === 'click') { speedTouched = true; setRate(r); }
    } else if (e.type === 'click') {
      // מעל 2 → "2.0": הנגן כבר חושב שהמהירות 2 ולא ישנה את הסרטון – משנים בעצמנו אחרי יוטיוב
      const above = currentRate() > SPEED_YT_MAX;
      dropSpeedWant();
      if (above) setTimeout(() => { try { setRate(r); } catch {} }, 0);
    }
    return;
  }
  const inc = e.target.closest('.ytp-variable-speed-panel-increment-button, ' + MWEB_SPEED + ' .ytSliderShapeHostIncrementButton');
  if (!inc) return;
  const sign = inc.classList.contains('ytSliderShapeHostIncrementButton') ? mwebIncSign(inc) : incSign(inc);
  const cur = currentRate();
  if (!sign) return;
  const next = Math.round((cur + sign * 0.05) * 20) / 20;
  if ((sign > 0 && cur >= SPEED_YT_MAX) || (sign < 0 && cur > SPEED_YT_MAX)) {
    speedIntercept(e);
    if (e.type === 'click') { speedTouched = true; setRate(Math.min(SPEED_MAX, next)); }
  }
}

window.addEventListener('input', onSpeedSlider, true);
window.addEventListener('change', onSpeedSlider, true);
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend', 'click']) {
  window.addEventListener(type, onSpeedClick, true);
}

// מקשי חצים על הסליידר (הטיפול המקורי של יוטיוב נעצר ב-2)
window.addEventListener('keydown', e => {
  const t = e.target;
  if (!S.speed || !t || !t.matches || !t.matches(SPEED_SLIDER + ', ' + MWEB_SLIDER) || nativePremium()) return;
  const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!dir) return;
  const sign = getComputedStyle(t).direction === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') ? -dir : dir;
  const cur = currentRate();
  if ((sign > 0 && cur >= SPEED_YT_MAX) || (sign < 0 && cur > SPEED_YT_MAX)) {
    speedIntercept(e);
    speedTouched = true;
    setRate(Math.min(SPEED_MAX, Math.round((cur + sign * 0.05) * 20) / 20));
  }
}, true);

// ---------- Shift+> / Shift+< של יוטיוב מעל 2 ----------

const SPEED_ICON_UP = 'M 10.00 13.37 v 9.24 c .00 1.12 1.15 1.76 1.98 1.11 L 18.33 18.66 v 3.95 c .00 1.12 1.15 1.77 1.98 1.11 L 27.50 18.00 l -7.18 -5.73 C 19.49 11.60 18.33 12.25 18.33 13.37 v 3.95 l -6.34 -5.06 C 11.15 11.60 10.00 12.25 10.00 13.37 Z';
const SPEED_ICON_DOWN = 'M 26.00 13.37 c .00 -1.12 -1.15 -1.77 -1.98 -1.11 L 17.66 17.33 V 13.37 c .00 -1.12 -1.15 -1.77 -1.98 -1.11 L 8.50 18.00 l 7.18 5.73 c .82 .65 1.98 .01 1.98 -1.11 v -3.96 l 6.34 5.06 c .82 .66 1.98 .01 1.98 -1.10 V 13.37 Z';
let bezelTimer = 0;

// הבזל של יוטיוב ("2.5x" עם אייקון המהירות), כמו אחרי Shift+> רגיל – מופיע כשנייה
function showSpeedBezel(rate, up) {
  const p = activePlayer();
  const text = p && p.querySelector && p.querySelector('.ytp-bezel-text');
  const wrap = text && text.closest('.ytp-bezel-text-wrapper');
  const layer = wrap && wrap.parentElement;
  if (!layer) return;
  const label = String(+rate.toFixed(2));
  text.textContent = label + 'x';
  const bezel = layer.querySelector('.ytp-bezel');
  if (bezel) {
    const old = bezel.getAttribute('aria-label') || '';
    bezel.setAttribute('aria-label', /\d/.test(old) && /מהירות|speed/i.test(old)
      ? old.replace(/\d+(?:\.\d+)?/, label) : uiText('המהירות היא ', 'Speed is ') + label);
    const icon = bezel.querySelector('.ytp-bezel-icon');
    if (icon) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      for (const [k, val] of [['fill', 'currentColor'], ['height', '100%'], ['viewBox', '0 0 36 36'], ['width', '100%']]) svg.setAttribute(k, val);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', up ? SPEED_ICON_UP : SPEED_ICON_DOWN);
      svg.append(path);
      icon.replaceChildren(svg);
    }
  }
  // כמו ck() בנגן: בבזל עם טקסט מסירים את ytp-bezel-text-hide (נשאר מבזל השהיה/ניגון קודם)
  layer.classList.remove('ytp-bezel-text-hide');
  // מפעילים מחדש את אנימציית ההיעלמות של יוטיוב
  layer.style.display = 'none';
  void layer.offsetWidth;
  layer.style.display = '';
  clearTimeout(bezelTimer);
  bezelTimer = setTimeout(() => { layer.style.display = 'none'; }, 1000);
}

window.addEventListener('keydown', e => {
  if (!S.speed || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
  const dir = e.key === '>' || e.code === 'Period' ? 1 : e.key === '<' || e.code === 'Comma' ? -1 : 0;
  if (!dir || isTyping(e) || (e.target && e.target.id === 'ytu-host')) return; // שדה טקסט או דיאלוג פתוח
  if (!activePlayer() || !mainVideo() || nativePremium()) return;
  const cur = currentRate();
  if (dir > 0 ? cur < SPEED_YT_MAX || cur >= SPEED_MAX : cur <= SPEED_YT_MAX) return; // עד 2 – יוטיוב עצמו
  // Shift+> של Premium: +0.25 (api.setPlaybackRate(b+.25)) עד 4
  const steps = [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4];
  const next = dir > 0 ? steps.find(r => r > cur + 1e-6) : [...steps].reverse().find(r => r < cur - 1e-6);
  if (next == null) return;
  speedIntercept(e);
  speedTouched = true;
  setRate(next);
  showSpeedBezel(next, dir > 0);
}, true);

// כיבוי "מהירויות Premium": חוזרים למהירות של יוטיוב ולסליידר עד 2
function applySpeedSetting() {
  if (S.speed) return;
  if (speedWant) {
    const v = speedWant.v;
    speedWant = null;
    const r = ytRate(activePlayer());
    try { v.playbackRate = r > 0 && r <= SPEED_YT_MAX ? r : 1; } catch {}
  }
  speedStore.set(null);
  if (nativePremium()) return;
  for (const slider of document.querySelectorAll(SPEED_SLIDER + ', ' + MWEB_SLIDER)) {
    if (+slider.max > SPEED_YT_MAX) slider.max = String(SPEED_YT_MAX);
    if (+slider.getAttribute('aria-valuemax') > SPEED_YT_MAX) slider.setAttribute('aria-valuemax', String(SPEED_YT_MAX));
  }
}

let speedObserved = new WeakSet();
function handleSpeed() {
  if (!S.speed) return;
  patchPlayers();
  // ברגע שהנגן תומך בעצמו – מוחקים את המהירות השמורה של הגיבוי
  if (!speedWant && nativePremium()) speedStore.set(null);
  // www: תפריט ⚙ של הנגן; m.youtube: הגיליון התחתון שבו נפתח "מהירות"
  for (const menu of document.querySelectorAll('.ytp-settings-menu, bottom-sheet-container')) {
    if (speedObserved.has(menu)) continue;
    speedObserved.add(menu);
    // התפריט נבנה כשפותחים את "מהירות הפעלה" – מעדכנים מיד ולא רק ב-tick
    // גם style/max של הסליידר: יוטיוב כותב מחדש את אחוז המילוי לפי הסקאלה שלו (עד 2)
    new MutationObserver(() => { try { syncSpeedUi(); } catch {} }).observe(menu, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'max', 'aria-valuemax'],
    });
  }
  syncSpeedUi();
}
