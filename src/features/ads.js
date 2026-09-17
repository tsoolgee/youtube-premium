// ---------- 1. חסימת פרסומות ----------

// מפתחות שמכילים רק פרסומות – מוחקים אותם בכל עומק (תשובת player, next, browse, reel).
const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds'];

// renderer-ים של פרסומת בתוך מערכי contents/items. פריט שכולו אחד מאלה יוצא מהמערך.
const AD_RENDERERS = new Set([
  'adSlotRenderer', 'displayAdRenderer', 'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer',
  'promotedVideoRenderer', 'compactPromotedVideoRenderer', 'searchPyvRenderer', 'inFeedAdLayoutRenderer',
  'actionCompanionAdRenderer', 'playerLegacyDesktopWatchAdsRenderer', 'adBreakServiceRenderer',
]);

// אורך הסרטון לפי ה-videoDetails שעברו כאן – כדי לזהות פרסומת "תפורה" (SSAP) בזמן ניגון.
const contentLength = {};

function strip(o) {
  if (!o || typeof o !== 'object') return;
  for (const k of AD_KEYS) if (k in o) delete o[k];
}

// האם פריט במערך הוא פרסומת. בודקים רק מבנים מוכרים כדי לא להעיף תוכן אמיתי.
function isAdItem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const keys = Object.keys(x);
  if (keys.length === 1 && AD_RENDERERS.has(keys[0])) return true;
  // עטיפות: פריט בגריד / סקשן / שורטס שכל התוכן שלו פרסומת.
  const inner = x.richItemRenderer?.content || x.richSectionRenderer?.content;
  if (inner && isAdItem(inner)) return true;
  // ריל בשורטס (reel_watch_sequence): הפרסומת מסומנת ב-adClientParams.isAd.
  if (x.command?.reelWatchEndpoint?.adClientParams?.isAd) return true;
  if (x.reelWatchEndpoint?.adClientParams?.isAd) return true;
  // לוח הצד של המפרסם בדף הצפייה.
  if (x.engagementPanelSectionListRenderer?.targetId === 'engagement-panel-ads') return true;
  return false;
}

// JSON.parse עובר על כל ה-JSON של הדף – מטפלים רק במה שנראה כמו תשובה של יוטיוב.
function looksLikeYt(o) {
  if (Array.isArray(o)) return o.some(x => x && typeof x === 'object' && (x.playerResponse || x.response || x.responseContext));
  return !!(o.responseContext || o.playabilityStatus || o.playerResponse || o.response?.responseContext || o.adPlacements || o.adSlots);
}

// פריטי תפריט של הצעת Premium ("צפייה בלי פרסומות · מינוי Premium ב-0$" בתפריט ⋮ ליד "הורדה")
const PREMIUM_UPSELL_PANEL = 'PApremium_upsell';
function isUpsellItem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const li = x.listItemViewModel;
  if (li) {
    if (li.entitySelectorType === 'LIST_ITEM_VIEW_MODEL_ENTITY_SELECTOR_TYPE_REMOVE_ADS_AD_STATE') return true;
    const cmd = li.rendererContext?.commandContext?.onTap?.innertubeCommand;
    if (cmd?.showDialogCommand?.panelLoadingStrategy?.requestTemplate?.panelId === PREMIUM_UPSELL_PANEL) return true;
  }
  const svc = x.menuServiceItemRenderer?.serviceEndpoint;
  if (svc?.showDialogCommand?.panelLoadingStrategy?.requestTemplate?.panelId === PREMIUM_UPSELL_PANEL) return true;
  return false;
}

// מה ש-Premium מקבל מהשרת: מהירות עד 4 בלי צ'יפ הצעה, בלי איכויות "Premium" נעולות
function premiumize(o) {
  // בלי הצעת Premium במהירות (צ'יפ 3.0 עם אייקון ההצעה, פריט "4" עם תג Premium) – גם כשמהירויות Premium כבויות
  if (S.speed || S.hidePromos) {
    const g = o.granularVariableSpeedConfig;
    if (g && typeof g === 'object') {
      // רק המהירויות עצמן תלויות בהגדרה
      if (S.speed && !(+g.maximumPlaybackRate >= 400)) g.maximumPlaybackRate = 400;
      const opts = Array.isArray(g.defaultPlaybackRateOptions) ? g.defaultPlaybackRateOptions : [];
      const max = +g.maximumPlaybackRate || 200;
      for (let i = opts.length - 1; i >= 0; i--) {
        const opt = opts[i];
        if (!opt || typeof opt !== 'object') continue;
        if (S.speed) { if (opt.isPremiumUpsell) opt.isPremiumUpsell = false; continue; }
        // מהירויות Premium כבויות: צ'יפ 3.0 בלי ההצעה היה נראה כמו של Premium אבל מנגן ב-2 – מוציאים אותו
        if (opt.isPremiumUpsell || +opt.value > max) opts.splice(i, 1);
      }
    }
    // הצעת Premium בצ'יפ 3.0 (watch next → playerOverlays.playerOverlayRenderer)
    if ('showPlaybackRateUpsellPanelCommand' in o) delete o.showPlaybackRateUpsellPanelCommand;
  }
  // "1080p Premium" בתפריט האיכות ולחיצה שפותחת הצעה. מגבלה ידועה: השרת לא מזרים את קצב הנתונים המשופר
  // למי שאינו מנוי, ולכן לא מציגים פריט "Premium" מזויף שמנגן בקצב הרגיל
  if (S.hidePromos && 'paygatedQualitiesMetadata' in o) delete o.paygatedQualitiesMetadata;
}

function walk(o, depth, ads) {
  if (depth > 60 || !o || typeof o !== 'object') return;
  if (Array.isArray(o)) {
    // מסננים במקום (splice) כדי לשמור על אותו אובייקט מערך.
    for (let i = o.length - 1; i >= 0; i--) {
      if ((ads && isAdItem(o[i])) || (S.hidePromos && isUpsellItem(o[i]))) o.splice(i, 1);
      else walk(o[i], depth + 1, ads);
    }
    return;
  }
  if (ads) strip(o);
  premiumize(o);
  const d = o.videoDetails;
  if (d && d.videoId && +d.lengthSeconds > 0) contentLength[d.videoId] = +d.lengthSeconds;
  for (const k in o) {
    const v = o[k];
    if (v && typeof v === 'object') walk(v, depth + 1, ads);
  }
}

function prune(o) {
  if (!o || typeof o !== 'object') return o;
  // הכניסה "הורדות" בתפריט הצד (download.js) – בתשובת /youtubei/v1/guide
  if (typeof dlPatchGuide === 'function') try { dlPatchGuide(o); } catch {}
  const ads = !!(S.adblock && S.adPrune);
  if (!ads && !S.speed && !S.hidePromos) return o;
  try {
    if (looksLikeYt(o)) walk(o, 0, ads);
  } catch {}
  return o;
}

(() => {
  const parse = JSON.parse;
  JSON.parse = function () { return prune(parse.apply(this, arguments)); };

  const json = Response.prototype.json;
  Response.prototype.json = function () { return json.apply(this, arguments).then(prune); };

  // var ytInitialPlayerResponse = {...} / ytInitialData בתוך ה-HTML עוברים דרך ה-setter הזה.
  // בטמפרמונקי הסקריפט עלול להיטען אחרי שהערך כבר נקבע – שומרים אותו.
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData', 'ytInitialReelWatchSequenceResponse']) {
    let value = prune(window[name]);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: v => { value = prune(v); },
      });
    } catch {}
  }
})();

let adState = null;

// הנגן שמציג פרסומת כרגע: www, שורטס (#shorts-player), מובייל ומיוזיק – כולם .html5-video-player.
function adShowingPlayer() {
  for (const p of document.querySelectorAll('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting')) {
    const v = p.querySelector('video');
    if (v) return { p, v };
  }
  return null;
}

// פרסומת תפורה לתוך הזרם: אורך הווידאו הוא אורך הסרטון כולו (או יותר). אסור לקפוץ לסוף –
// זה מדלג על הסרטון עצמו. אם האורך לא ידוע – רק פרסומות קצרות נחשבות רגילות.
function isStitched(p, v) {
  let id = null;
  try { id = p.getVideoData?.()?.video_id; } catch {}
  const len = contentLength[id || videoId()];
  if (len) return v.duration >= len - 2;
  return !(v.duration < 150);
}

const SKIP_SEL = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytp-ad-skip-button-container button, .ytp-ad-overlay-close-button';

// הרגע שבו יוטיוב מוריד את ad-showing מהנגן: מחזירים מהירות ושמע מיד, ולא רק באירוע המדיה הבא
// (בפרסומת תפורה אותו אלמנט ממשיך לנגן את התוכן – ב-16x זה מדלג על שניות מהסרטון)
const adClassObserved = new WeakSet();
function watchAdClass(p) {
  if (adClassObserved.has(p)) return;
  adClassObserved.add(p);
  new MutationObserver(() => {
    if (adState && !p.classList.contains('ad-showing') && !p.classList.contains('ad-interrupting')) {
      try { handleAds(); } catch {}
    }
  }).observe(p, { attributes: true, attributeFilter: ['class'] });
}

function handleAds(e) {
  const found = S.adblock ? adShowingPlayer() : null;
  if (found) {
    const { p, v } = found;
    watchAdClass(p);
    const src = v.currentSrc || v.src || '';
    // הסרטון עצמו נטען (src חדש) בזמן שהנגן עוד מסומן ad-showing – לא מאיצים אותו; ה-observer יחזיר הכל
    if (e && (e.type === 'loadedmetadata' || e.type === 'durationchange') && adState && adState.v === v && adState.src !== src) return;
    if (!adState || adState.v !== v) {
      // המהירות שיוטיוב עצמו רוצה (getPlaybackRate) עדיפה על הערך שעל האלמנט.
      let rate = v.playbackRate;
      try { rate = p.getPlaybackRate?.() || rate; } catch {}
      adState = { v, src, muted: adState ? adState.muted : v.muted, rate: adState ? adState.rate : rate };
    } else if (!e || e.type === 'timeupdate' || e.type === 'playing') {
      adState.src = src;
    }
    v.muted = true;
    if (v.playbackRate !== 16) v.playbackRate = 16;
    if (v.duration > 0 && v.currentTime < v.duration - 0.2 && !isStitched(p, v)) v.currentTime = v.duration - 0.1;
    for (const b of p.querySelectorAll(SKIP_SEL)) b.click();
    return;
  }
  if (!adState) return;
  const v = adState.v.isConnected ? adState.v : mainVideo();
  if (v) {
    // משחזרים רק את מה שאנחנו שינינו: אם יוטיוב כבר קבע מהירות אחרת מ-16 – לא נוגעים.
    if (v.playbackRate === 16) {
      const wanted = typeof speedWanted === 'function' ? speedWanted(v) : null;
      let rate = adState.rate;
      try { rate = activePlayer()?.getPlaybackRate?.() || rate; } catch {}
      v.playbackRate = wanted || rate || 1;
    }
    if (v.muted && !adState.muted) {
      let muted = false;
      try { muted = !!activePlayer()?.isMuted?.(); } catch {}
      v.muted = muted;
    }
  }
  adState = null;
}

for (const ev of ['timeupdate', 'playing', 'loadedmetadata', 'durationchange']) document.addEventListener(ev, handleAds, true);

// ריל של פרסומת בשורטס: לא מסתירים ב-CSS (נשאר ריל ריק בגלילה) אלא עוברים לריל הבא.
let shortsAdSkippedAt = 0;
function skipShortsAd() {
  if (!S.adblock || !onShorts() || Date.now() - shortsAdSkippedAt < 1500) return;
  const active = document.querySelector('ytd-reel-video-renderer[is-active], ytm-reel-player-renderer[is-active]');
  if (!active || !active.querySelector('ytd-ad-slot-renderer, ad-slot-renderer, .ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) return;
  const next = document.querySelector('#navigation-button-down button, #navigation-button-down yt-button-shape button');
  if (!next) return;
  shortsAdSkippedAt = Date.now();
  next.click();
}
document.addEventListener('yt-navigate-finish', () => setTimeout(skipShortsAd, 300));
setInterval(() => { try { skipShortsAd(); } catch {} }, 1000);

const AD_CSS = `
#masthead-ad, #player-ads, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer,
ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-compact-promoted-video-renderer,
ytd-action-companion-ad-renderer, ytd-companion-slot-renderer, ytd-player-legacy-desktop-watch-ads-renderer,
ytd-search-pyv-renderer, ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
ytd-rich-section-renderer:has(ytd-ad-slot-renderer), ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
ytd-rich-shelf-renderer[is-shorts] ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
.ytp-ad-overlay-container, .ytp-ad-overlay-slot, .ytd-ad-slot-renderer, panel-ad-header-image-lockup-view-model,
ytd-ad-inline-playback-meta-block,
ad-slot-renderer, ytm-promoted-sparkles-web-renderer, ytm-companion-ad-renderer, ytm-promoted-video-renderer,
ytm-rich-item-renderer:has(ad-slot-renderer), ytm-item-section-renderer:has(> ad-slot-renderer),
.html5-video-player.ad-showing .video-ads, .html5-video-player.ad-interrupting .video-ads,
.ytp-ad-player-overlay-layout, .ytp-ad-module, .ytp-ad-persistent-progress-bar-container,
.html5-video-player.ad-showing .ytp-chrome-bottom, .html5-video-player.ad-showing .ytp-chrome-top
{ display: none !important; }
/* פרסומת שעוד לא דולגה (למשל תפורה לזרם) – בלי תמונה של הפרסומת, כמו ב-Premium. הכפתור "דילוג" מוסתר אבל עדיין נלחץ ב-click() */
.html5-video-player.ad-showing video.html5-main-video { opacity: 0 !important; }`;

// אזהרת חוסם הפרסומות: לא מסתירים את ytd-enforcement-message-view-model עצמו ב-display:none –
// יוטיוב בודק את ה-display המחושב שלו. מסתירים את הדיאלוג שעוטף אותו ואת הרקע האפור.
const PROMO_CSS = `
ytd-mealbar-promo-renderer, yt-mealbar-promo-renderer, ytmusic-mealbar-promo-renderer, ytm-mealbar-promo-renderer,
ytd-statement-banner-renderer, ytd-banner-promo-renderer, ytd-primetime-promo-renderer, ytmusic-statement-banner-renderer,
tp-yt-paper-dialog:has(ytd-mealbar-promo-renderer),
.ytp-quality-menu .ytp-menuitem:has(.ytp-premium-label)
{ display: none !important; }
tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), bottom-sheet-container:has(ytm-enforcement-message-view-model),
body:has(ytd-enforcement-message-view-model) > tp-yt-iron-overlay-backdrop
{ visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }`;

const styles = {};
function addStyle(name, css) {
  const el = h('style', { id: 'ytu-' + name });
  el.textContent = css;
  (document.head || document.documentElement).append(el);
  styles[name] = el;
}
addStyle('ads', AD_CSS);
addStyle('promos', PROMO_CSS);

// אזהרת "חוסמי פרסומות מפרים את התנאים": סוגרים כמו שיוטיוב סוגר (close() משחרר את נעילת
// הגלילה של iron-overlay), ומחדשים ניגון רק אם הסרטון נעצר בגלל הדיאלוג.
let enforcementUntil = 0;
let enforcementResume = false;  // הסרטון התנגן כשהדיאלוג הופיע (ונעצר בגללו)
let lastPauseAt = 0, lastUserAt = 0;
document.addEventListener('pause', e => {
  if (!(e.target instanceof HTMLVideoElement)) return;
  lastPauseAt = Date.now();
  // השהיה שלא באה מהמשתמש בשנייה הראשונה אחרי הדיאלוג – גם היא של הדיאלוג
  if (Date.now() < enforcementUntil - 3000 && lastPauseAt - lastUserAt > 500) enforcementResume = true;
}, true);
// המשתמש עצמו לחץ / הקליד (השהיה, k, רווח) – לא מחדשים ניגון בשבילו
for (const type of ['pointerdown', 'keydown', 'click']) {
  document.addEventListener(type, e => {
    if (!e.isTrusted) return;
    lastUserAt = Date.now();
    enforcementUntil = 0;
    enforcementResume = false;
  }, true);
}
// הדיאלוג נסגר מיד כשהוא נוסף (ולא רק ב-tick של חצי שנייה), כדי שהרקע ונעילת הגלילה לא יהבהבו
const promoObserved = new WeakSet();
function observePromos() {
  for (const root of document.querySelectorAll('ytd-popup-container, ytmusic-popup-container, body')) {
    if (promoObserved.has(root)) continue;
    promoObserved.add(root);
    new MutationObserver(muts => {
      if (!S.hidePromos) return;
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (/ENFORCEMENT-MESSAGE/.test(n.tagName) || (n.querySelector && n.querySelector('ytd-enforcement-message-view-model, ytm-enforcement-message-view-model')))) {
          try { handlePromos(); } catch {}
          return;
        }
      }
    }).observe(root, root === document.body ? { childList: true } : { childList: true, subtree: true });
  }
}

function handlePromos() {
  if (!S.hidePromos) return;
  observePromos();
  const enforcement = document.querySelector('ytd-enforcement-message-view-model, ytm-enforcement-message-view-model');
  if (enforcement) {
    const dialog = enforcement.closest('tp-yt-paper-dialog');
    const dismiss = enforcement.querySelector('#dismiss-button button, button[aria-label="Close"], button[aria-label="סגירה"]');
    try { dismiss?.click(); } catch {}
    try { dialog?.close?.(); } catch {}
    (dialog || enforcement.closest('bottom-sheet-container') || enforcement).remove();
    // הרקע האפור: רק אם אין חלון אחר של יוטיוב פתוח (הרקע אולי שלו), ורק רקע שמסומן פתוח.
    // close() ולא remove() – iron-overlay מחזיק הפניה לאלמנט ומשתמש בו שוב בחלון הבא.
    const isOpen = el => el.opened === true || el.hasAttribute('opened');
    const otherOpen = [...document.querySelectorAll('tp-yt-paper-dialog, tp-yt-iron-dropdown')].some(o => o.isConnected && isOpen(o));
    if (!otherOpen) {
      for (const b of document.querySelectorAll('tp-yt-iron-overlay-backdrop')) {
        if (!isOpen(b)) continue;
        try {
          if (typeof b.close === 'function') b.close();
          else b.removeAttribute('opened');
        } catch {}
      }
    }
    // מחדשים רק אם הסרטון התנגן, או נעצר בשנייה האחרונה בלי לחיצה של המשתמש
    const v = mainVideo();
    const now = Date.now();
    enforcementResume = !!v && (!v.paused || (now - lastPauseAt < 1000 && lastPauseAt - lastUserAt > 500));
    enforcementUntil = now + 4000;
  }
  if (enforcementResume && Date.now() < enforcementUntil) {
    const v = mainVideo();
    if (v && v.paused && !v.ended && v.readyState > 0) {
      enforcementResume = false; // פעם אחת
      v.play().catch(() => {});
    }
  }
}
