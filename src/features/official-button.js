// ---------- 7. כפתור ההורדה הרשמי של יוטיוב ----------

// לחיצה על "הורדה" של יוטיוב (בדף הצפייה, בתפריט שלוש הנקודות, בשורטס, במובייל וביוטיוב מיוזיק)
// פותחת את דיאלוג "איכות ההורדה" (download.js) במקום ההצעה לקנות Premium.

const OFFICIAL_BUTTONS = 'ytd-download-button-renderer, ytm-download-button-renderer, ytm-offline-button-renderer';
const OFFICIAL_ITEMS = 'ytd-menu-service-item-download-renderer, ytm-menu-service-item-download-renderer, ytmusic-menu-service-item-download-renderer';
const MENU_ITEMS = 'ytd-menu-service-item-renderer, ytm-menu-service-item-renderer, ytm-menu-item, yt-list-item-view-model, ytmusic-menu-service-item-renderer';
const MENU_POPUPS = 'tp-yt-iron-dropdown, ytd-popup-container, ytmusic-popup-container, yt-sheet-view-model, ytm-menu-popup-renderer, ytm-bottom-sheet-renderer, bottom-sheet-container, ytm-popup-container';
// אזורים שבהם כפתור "הורדה" שייך לסרטון הנוכחי
const ACTION_AREAS = 'ytd-watch-metadata, ytd-watch-flexy, ytm-slim-video-action-bar-renderer, ytm-slim-video-metadata-section-renderer, reel-action-bar-view-model, ytd-reel-video-renderer, ytd-reel-player-overlay-renderer, ytm-reel-player-overlay-renderer, ytd-shorts, ytm-shorts-lockup-view-model, ytmusic-player-page, ytmusic-player-bar, #movie_player';
// רשימת השמעה שלמה (הכותרת/התפריט של הפאנל בדף הצפייה, דף רשימה) – ההורדה שלה לא שייכת לסרטון אחד
const PLAYLIST_AREAS = 'ytd-playlist-panel-renderer, ytd-playlist-header-renderer, ytd-playlist-renderer, ytd-grid-playlist-renderer, ytm-playlist-panel-renderer, ytm-playlist-header-renderer, ytmusic-playlist-shelf-renderer, ytmusic-detail-header-renderer, ytmusic-responsive-header-renderer';
// כרטיס של סרטון אחר (פיד, סרטונים מוצעים, רשימת השמעה, שירים ביוטיוב מיוזיק)
const ITEM_TAG = /^(ytd|ytm|yt|ytmusic)-.*(video-renderer|lockup|rich-item|reel-item|playlist-panel-video|responsive-list-item|two-row-item)/i;
const DOWNLOAD_WORDS = ['הורדה', 'download'];

let officialHooked = false;
let lastOpener = null; // הכפתור האחרון שנלחץ – בדרך כלל מי שפתח את התפריט
let obSyntheticEscape = false; // בזמן שליחת Escape מדומה – הדיאלוג שלנו לא נסגר בגללו

const officialOn = () => !!S.download && S.hookOfficialButton !== false;
const obNorm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const isDownloadText = el => DOWNLOAD_WORDS.includes(obNorm(el.getAttribute && el.getAttribute('aria-label')))
  || DOWNLOAD_WORDS.includes(obNorm(el.textContent));

function hookOfficialButtons() {
  if (!officialHooked) {
    officialHooked = true;
    document.addEventListener('click', onOfficialClick, true);
  }
  if (officialOn()) unhideOfficial();
  obBadgeCss();
  if (SITE === 'mobile') { ensureMobileDownloadButton(); ensureMobileSheetDownload(); }
  if (SITE === 'www') ensureDesktopMenuDownload();
}

// www: יוטיוב לא תמיד מציע "הורדה" – לא בשורת הכפתורים ולא בתפריט ⋮ (סרטונים שגם מנוי לא יכול להוריד,
// חשבון מחובר עם הרבה כפתורים וכו'; דווח בפורום). ההורדה שלנו עובדת גם אז, ולכן מוסיפים לתפריט ⋮ של
// הסרטון פריט "הורדה" מקורי: ytd-menu-service-item-renderer שיוטיוב עצמו מצייר מ-data (טקסט + אייקון OFFLINE_DOWNLOAD).
// מאיפה נפתח התפריט: ⋮ של הסרטון בדף הצפייה, או ⋮ של סרטון ברשימה (דף הבית, צד, חיפוש, מנויים) – כמו ב-Premium
function desktopMenuContext() {
  if (!lastOpener || Date.now() - lastOpener.at > 15000) return null;
  if (lastOpener.el.closest('ytd-watch-metadata #actions')) {
    const rowButton = [...document.querySelectorAll('ytd-watch-metadata ytd-download-button-renderer')].some(obVisible);
    return videoId() && !rowButton ? { kind: 'watch', id: videoId() } : null;
  }
  const ctx = contextVideo(lastOpener.path);
  return ctx.known && !ctx.playlist && ctx.id && lastOpener.path.some(el => ITEM_TAG.test(el.tagName)) ? { kind: 'item', id: ctx.id } : null;
}

function ensureDesktopMenuDownload() {
  const menuCtx = officialOn() ? desktopMenuContext() : null;
  const want = !!menuCtx;
  // התפריט החדש (yt-sheet-view-model / yt-list-view-model) – בדף הבית ובצד
  for (const sheet of document.querySelectorAll('tp-yt-iron-dropdown yt-list-view-model, ytd-popup-container yt-list-view-model')) {
    let mine = sheet.querySelector(`[${DL_MENU_ITEM_ATTR}]`);
    const open = !!obVisible(sheet);
    if (!want || !open) { if (mine) mine.remove(); continue; }
    // אותו תפריט נפתח עכשיו לסרטון אחר – מחליפים
    if (mine && mine.getAttribute('data-ytu-video') !== menuCtx.id) { mine.remove(); mine = null; }
    if (mine) continue;
    const items = [...sheet.querySelectorAll('yt-list-item-view-model')].filter(obVisible);
    if (!items.length || items.some(it => it.closest('yt-download-list-item-view-model') || isDownloadText(it))) continue;
    const titleOf = it => it.querySelector('.ytListItemViewModelTitle, [class*="ListItemViewModelTitle"], [class*="list-item-view-model__title"]');
    // משכפלים שורה שכבר יש לה אייקון (האייקון נטען רגע אחרי התפריט)
    const tpl = items.find(it => it.querySelector('svg path') && titleOf(it));
    if (!tpl) continue;
    const clone = tpl.cloneNode(true);
    clone.setAttribute(DL_MENU_ITEM_ATTR, '');
    clone.setAttribute('data-ytu-video', menuCtx.id);
    titleOf(clone).textContent = MSG.download();
    for (const el of clone.querySelectorAll('[class*="Subtitle"], [class*="subtitle"]')) el.remove();
    const paths = [...clone.querySelectorAll('svg path')];
    paths.slice(1).forEach(x => x.remove());
    if (paths[0]) paths[0].setAttribute('d', MWEB_DOWNLOAD_PATH);
    const btn = clone.querySelector('button');
    if (btn) { btn.removeAttribute('aria-pressed'); btn.setAttribute('aria-label', MSG.download()); }
    // כמו ב-Premium: "הורדה" אחרי "שמירה" / "הוספה לתור", אחרת ראשונה
    const after = items.filter(it => /שמירה|save|הוספה לתור|add to queue/i.test(obNorm((titleOf(it) || it).textContent))).pop();
    if (after) after.after(clone); else items[0].before(clone);
    const dd = sheet.closest('tp-yt-iron-dropdown');
    setTimeout(() => { try { dd && dd.refit && dd.refit(); } catch {} }, 0);
    try { refreshDownloadButtons(); } catch {}
  }
  // התפריט הישן (ytd-menu-popup-renderer)
  for (const dd of document.querySelectorAll('tp-yt-iron-dropdown')) {
    const list = dd.querySelector('tp-yt-paper-listbox#items');
    if (!list) continue;
    let mine = list.querySelector(`:scope > [${DL_MENU_ITEM_ATTR}]`);
    const open = dd.getAttribute('aria-hidden') !== 'true' && !!obVisible(dd);
    if (!want || !open) { if (mine) mine.remove(); continue; }
    if (mine && mine.getAttribute('data-ytu-video') !== menuCtx.id) { mine.remove(); mine = null; }
    if (mine) continue;
    const items = [...list.children].filter(c => c !== mine);
    // יוטיוב כבר מציע הורדה בתפריט הזה – לא מוסיפים שנייה
    if (items.some(it => it.matches(OFFICIAL_ITEMS) || it.querySelector('yt-download-list-item-view-model') || isDownloadText(it))) continue;
    const first = items.find(c => c.offsetParent);
    if (!first) continue; // התפריט עוד לא צויר
    const tpl = list.querySelector('ytd-menu-service-item-renderer');
    const el = document.createElement('ytd-menu-service-item-renderer');
    el.className = tpl ? tpl.className : 'style-scope ytd-menu-popup-renderer';
    for (const a of ['system-icons', 'use-icons', 'role']) if (tpl && tpl.hasAttribute(a)) el.setAttribute(a, tpl.getAttribute(a) || '');
    el.setAttribute(DL_MENU_ITEM_ATTR, '');
    el.setAttribute('data-ytu-video', menuCtx.id);
    el.data = {
      text: { runs: [{ text: MSG.download() }] },
      icon: { iconType: 'OFFLINE_DOWNLOAD' },
      serviceEndpoint: { commandMetadata: { webCommandMetadata: { ignoreNavigation: true } } },
    };
    list.insertBefore(el, first);
    // התפריט כבר מדד את עצמו – בלי refit נוצר פס גלילה
    setTimeout(() => { try { dd.refit && dd.refit(); } catch {} try { dd.notifyResize && dd.notifyResize(); } catch {} }, 0);
    try { refreshDownloadButtons(); } catch {}
  }
}

// YouTube Music: תג "P" (Premium) ליד "הורדה" בתפריט – למנוי אין אותו
function obBadgeCss() {
  let style = document.getElementById('ytu-ob-badge-css');
  if (!style) {
    if (SITE !== 'music') return;
    style = document.createElement('style');
    style.id = 'ytu-ob-badge-css';
    style.textContent = 'ytmusic-menu-service-item-download-renderer .primary-entry-badge-icon { display: none !important; }';
    (document.head || document.documentElement).append(style);
  }
  if (style.disabled === officialOn()) style.disabled = !officialOn();
}

// m.youtube: יוטיוב לא מצייר כפתור "הורדה" בסרגל הפעולות (נבדק 16/09/2026: הרשמה, לייק, דיסלייק, שיתוף,
// שמירה בפלייליסט, דיווח). כמו באפליקציה של Premium – כפתור "הורדה" לפני "שמירה", משוכפל מהכפתור של יוטיוב.
const MWEB_DOWNLOAD_PATH = 'M12 2a1 1 0 00-1 1v11.586l-4.293-4.293a1 1 0 10-1.414 1.414L12 18.414l6.707-6.707a1 1 0 10-1.414-1.414L13 14.586V3a1 1 0 00-1-1Zm7 18H5a1 1 0 000 2h14a1 1 0 000-2Z';
function ensureMobileDownloadButton() {
  const on = officialOn() && !!videoId() && !onShorts();
  for (const b of document.querySelectorAll(`[${DL_MWEB_ATTR}]`)) {
    if (!on) b.closest('button-view-model')?.remove();
  }
  if (!on) return;
  for (const bar of document.querySelectorAll('ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions')) {
    if (bar.querySelector('ytm-download-button-renderer, ytm-offline-button-renderer')) continue;
    const label = m => (m.querySelector('button') && m.querySelector('button').getAttribute('aria-label')) || '';
    const models = [...bar.querySelectorAll(':scope > button-view-model')].filter(m => !m.querySelector(`[${DL_MWEB_ATTR}]`));
    // רק פעולה אמיתית עם שם: "שמירה" (ההורדה לפניה) או "שיתוף" (ההורדה אחריו). לא "עוד" (⋯) בסרגל המצומצם
    const save = models.find(m => /שמירה|save/i.test(label(m)));
    const share = models.find(m => /שיתוף|share/i.test(label(m)));
    const mine = bar.querySelector(`:scope > button-view-model [${DL_MWEB_ATTR}]`);
    let existing = mine && mine.closest('button-view-model');
    // שוכפל לפני שהאייקון של יוטיוב נטען (span ריק – כפתור שקוף, נבדק ב-360px) – משכפלים מחדש
    if (existing && !existing.querySelector('svg path')) { existing.remove(); existing = null; }
    // הסרגל הצטמצם (סיבוב למסך צר) – אין מקום, עוברים לגיליון "עוד"
    if (existing && bar.scrollWidth > bar.clientWidth + 1) { existing.remove(); existing = null; mwebNoRoom.set(bar, bar.clientWidth); continue; }
    if (existing) {
      // יוטיוב מצייר את הסרגל מחדש באותו מיכל – מוודאים שההורדה עדיין לפני "שמירה"
      if (save) { if (existing.nextElementSibling !== save) save.before(existing); }
      else if (share) { if (existing.previousElementSibling !== share) share.after(existing); }
      else existing.remove();
      continue;
    }
    // כבר נבדק שאין מקום ברוחב הזה – "הורדה" בגיליון "עוד" (ensureMobileSheetDownload)
    if (mwebNoRoom.get(bar) === bar.clientWidth) continue;
    const tpl = save || share;
    // האייקון נטען רגע אחרי הסרגל – משכפלים רק כשהוא כבר שם
    if (!tpl || !tpl.querySelector('svg path')) continue;
    const clone = tpl.cloneNode(true);
    const btn = clone.querySelector('button');
    if (!btn) continue;
    // בלי מחלקות של כפתור אחר (slim-action-more-button וכדומה)
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const c of [...el.classList]) if (/more|share|save|playlist/i.test(c)) el.classList.remove(c);
    }
    btn.setAttribute(DL_MWEB_ATTR, '');
    btn.setAttribute('aria-label', MSG.download());
    btn.removeAttribute('aria-pressed');
    const paths = [...clone.querySelectorAll('svg path')];
    paths.slice(1).forEach(x => x.remove());
    if (paths[0]) paths[0].setAttribute('d', MWEB_DOWNLOAD_PATH);
    const txt = clone.querySelector(DL_TEXT_SLOT);
    if (txt && txt.textContent.trim()) txt.textContent = MSG.download();
    const before = mwebWidths(bar);
    if (save) save.before(clone); else share.after(clone);
    if (mwebOverflow(bar, before)) { clone.remove(); mwebNoRoom.set(bar, bar.clientWidth); }
  }
}

// יוטיוב מתאים את הסרגל בדיוק לרוחב המסך (ב-360px: "שמירה" עוברת ל"עוד") – אם הכפתור שלנו גורם לגלילה
// או מכווץ כפתור אחר (הרשמה), אין לו מקום. נבדק שוב כשרוחב הסרגל משתנה (סיבוב / שינוי גודל)
const mwebNoRoom = new WeakMap();
// רוחב הכפתורים עצמם (לא המיכלים – אזור ההרשמה מתמתח למילוי הרווח ומתכווץ בלי שהכפתור נפגע)
const mwebWidths = bar => [...bar.querySelectorAll(`button:not([${DL_MWEB_ATTR}]), a`)].map(b => b.getBoundingClientRect().width);
function mwebOverflow(bar, before) {
  if (bar.scrollWidth > bar.clientWidth + 1) return true;
  const after = mwebWidths(bar);
  return after.length === before.length && after.some((w, i) => w < before[i] - 1);
}

// m.youtube בסרגל המצומצם (הרשמה, לייק, "עוד" – נבדק ב-360px): אין מקום לכפתור, ולכן שורת "הורדה" בגיליון "עוד"
// לפני "שמירה", משוכפלת מהשורה של יוטיוב (yt-list-item-view-model) עם אייקון OFFLINE_DOWNLOAD
function ensureMobileSheetDownload() {
  const on = officialOn() && !!videoId() && !onShorts();
  const bar = document.querySelector('ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions');
  const inBar = bar && [...bar.querySelectorAll(`[${DL_MWEB_ATTR}], ytm-download-button-renderer, ytm-offline-button-renderer`)].some(obVisible);
  for (const sheet of document.querySelectorAll('bottom-sheet-container')) {
    const mine = sheet.querySelector(`[${DL_MENU_ITEM_ATTR}]`);
    if (!on || inBar || !lastOpener || !lastOpener.el.closest('ytm-slim-video-action-bar-renderer')) { if (mine) mine.remove(); continue; }
    if (mine) continue;
    const items = [...sheet.querySelectorAll('yt-list-item-view-model')];
    const title = it => obNorm((it.querySelector('.ytListItemViewModelTitle') || it).textContent);
    const save = items.find(it => ['שמירה', 'save'].includes(title(it)));
    // האייקון של "שמירה" נטען רגע אחרי שהגיליון נפתח – משכפלים רק כשהוא כבר שם
    if (!save || !save.querySelector('svg path')) continue;
    const clone = save.cloneNode(true);
    clone.setAttribute(DL_MENU_ITEM_ATTR, '');
    clone.setAttribute('data-ytu-video', videoId());
    const t = clone.querySelector('.ytListItemViewModelTitle');
    if (t) t.textContent = MSG.download();
    const paths = [...clone.querySelectorAll('svg path')];
    paths.slice(1).forEach(x => x.remove());
    if (paths[0]) paths[0].setAttribute('d', MWEB_DOWNLOAD_PATH);
    const btn = clone.querySelector('button');
    if (btn) btn.removeAttribute('aria-pressed');
    save.before(clone);
    // יוטיוב מגביל את הגיליון לגובה השורות שלו (max-height בשורה) – מוסיפים שורה אחת, כמו בכניסת ההגדרות
    const wrap = clone.closest('.ytSpecBottomSheetLayoutContentWrapper, #content-wrapper');
    const max = wrap && parseFloat(wrap.style.maxHeight);
    const row = Math.round(save.getBoundingClientRect().height) || 48;
    if (max && max + row <= innerHeight * 0.9) wrap.style.maxHeight = (max + row) + 'px';
    try { refreshDownloadButtons(); } catch {}
  }
}

// יוטיוב מסתיר לפעמים את הכפתור (למשל במדינות בלי הורדות) – מחזירים אותו
function unhideOfficial() {
  for (const el of document.querySelectorAll('ytd-watch-metadata ytd-download-button-renderer')) {
    if (el.hasAttribute('hidden')) el.removeAttribute('hidden');
    if (el.hasAttribute('is-hidden')) el.removeAttribute('is-hidden');
    if (el.style.display === 'none') el.style.removeProperty('display');
  }
}

function obRemoveEndpoint(el) {
  try {
    const d = el.data || (el.__data && el.__data.data);
    const off = d && d.serviceEndpoint && d.serviceEndpoint.offlineVideoEndpoint;
    return off && /^ACTION_REMOVE(_WITH_PROMPT)?$/.test(off.action || '') && /^[\w-]{11}$/.test(off.videoId || '') ? off : null;
  } catch { return null; }
}

// חיפוש videoId בנתוני הרכיב של יוטיוב (Polymer), בלי להיתקע במבנים ענקיים
function dataVideoId(el) {
  const roots = [];
  try { roots.push(el.data, el.__data && el.__data.data, el.polymerController && el.polymerController.data); } catch {}
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    const queue = [root], seen = new Set();
    for (let n = 0; queue.length && n < 400; n++) {
      const o = queue.shift();
      if (!o || typeof o !== 'object' || seen.has(o)) continue;
      seen.add(o);
      if (o.offlineVideoEndpoint && /^[\w-]{11}$/.test(o.offlineVideoEndpoint.videoId || '')) return o.offlineVideoEndpoint.videoId;
      if (typeof o.videoId === 'string' && /^[\w-]{11}$/.test(o.videoId)) return o.videoId;
      for (const k in o) if (o[k] && typeof o[k] === 'object') queue.push(o[k]);
    }
  }
  return null;
}

function linkVideoId(el) {
  for (const a of el.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(/[?&]v=([\w-]{11})|\/shorts\/([\w-]{11})/);
    if (m) return m[1] || m[2];
  }
  return null;
}

// לאיזה סרטון שייך הכפתור: { known, id, playlist } – known=false כשאין הקשר ברור
function contextVideo(path) {
  for (const el of path) {
    if (ITEM_TAG.test(el.tagName)) return { known: true, id: dataVideoId(el) || linkVideoId(el) };
    if (el.matches(PLAYLIST_AREAS)) return { known: true, id: null, playlist: true };
    if (el.matches(ACTION_AREAS)) return { known: true, id: videoId() };
  }
  return { known: false, id: null };
}

function elementsOf(e) {
  const path = e.composedPath ? e.composedPath() : [];
  const out = [];
  for (const n of path) {
    if (n === document || n === document.documentElement) break;
    if (n instanceof Element) out.push(n);
  }
  return out;
}

// מה נלחץ: { kind: 'button'|'menu', el, path } או null
function officialTarget(path) {
  for (const el of path) {
    if (el.id === 'ytu-host') return null;
    if (el.hasAttribute(DL_MWEB_ATTR)) return { kind: 'button', el };
    if (el.hasAttribute(DL_MENU_ITEM_ATTR)) return { kind: 'menu', el };
    if (el.matches(OFFICIAL_BUTTONS)) return { kind: 'button', el };
    if (el.matches(OFFICIAL_ITEMS)) return { kind: 'menu', el };
    if (el.matches(MENU_ITEMS)) {
      // "הסרה מההורדות" בדף ההורדות (offlineVideoEndpoint עם ACTION_REMOVE)
      const off = obRemoveEndpoint(el);
      if (off) return { kind: 'remove', el, id: off.videoId };
      // "הורדה" בתפריט החדש – גם אחרי שצבענו אותו ל"הסרה מההורדות" / "ניסיון חוזר"
      const dlItem = el.closest('yt-download-list-item-view-model');
      if (dlItem || el.hasAttribute('data-ytu-text')) return { kind: 'menu', el: dlItem || el };
      if (el.closest(MENU_POPUPS) && isDownloadText(el)) return { kind: 'menu', el };
      return null; // פריט תפריט אחר – לא נוגעים
    }
  }
  // כפתור "הורדה" בלי רכיב ייעודי (מובייל, שורטס, הממשק החדש)
  const btn = path.find(el => el.matches('button, [role="button"]'));
  if (btn && isDownloadText(btn) && path.some(el => el.matches(ACTION_AREAS))) return { kind: 'button', el: btn };
  return null;
}

function obVisible(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? el : null;
}

function onOfficialClick(e) {
  if (!officialOn() || e.button > 0) return;
  const path = elementsOf(e);
  const hit = officialTarget(path);
  if (!hit) {
    const opener = path.find(el => el.matches('button, yt-icon-button, [role="button"]'));
    if (opener && !path.some(el => el.id === 'ytu-host')) {
      lastOpener = { el: opener, path, at: Date.now() };
      // m.youtube: "עוד" בסרגל המצומצם – הגיליון נפתח מיד, מוסיפים לו "הורדה"
      if (SITE === 'mobile' && opener.closest('ytm-slim-video-action-bar-renderer')) {
        for (const ms of [50, 200, 500, 1000]) setTimeout(() => { try { ensureMobileSheetDownload(); } catch {} }, ms);
      }
      // www: ⋮ של הסרטון – אם יוטיוב לא שם בו "הורדה", מוסיפים
      if (SITE === 'www' && (opener.closest('ytd-watch-metadata #actions') || path.some(el => ITEM_TAG.test(el.tagName)))) {
        for (const ms of [30, 150, 400, 900]) setTimeout(() => { try { ensureDesktopMenuDownload(); } catch {} }, ms);
      }
    }
    return;
  }

  if (hit.kind === 'remove') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeYouTubeMenus(path);
    dlRemoveNow(hit.id);
    return;
  }
  let id;
  if (hit.kind === 'button') {
    const ctx = contextVideo(path);
    id = ctx.playlist ? null : dataVideoId(hit.el) || ctx.id || videoId();
  } else {
    const ctx = lastOpener && Date.now() - lastOpener.at < 5 * 60 * 1000 ? contextVideo(lastOpener.path) : { known: false };
    id = ctx.playlist ? null : dataVideoId(hit.el) || ctx.id || (ctx.known ? null : videoId());
  }
  // לא ברור לאיזה סרטון – משאירים ליוטיוב
  if (!id) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  const anchor = hit.kind === 'button' ? obVisible(hit.el) : obVisible(lastOpener && lastOpener.el);
  if (hit.kind === 'menu') {
    closeYouTubeMenus(path);
    // בתפריט, אחרי הורדה / בזמן הורדה / בתור: "הסרה מההורדות" היא ACTION_REMOVE – בלי לשאול
    const st = dlButtonState(id);
    if (officialOn() && S.download && st && st.state !== 'failed' && dlRemoveNow(id)) return;
  }
  openDownloadDialog(anchor, id);
}

function closeYouTubeMenus(path) {
  let closed = false;
  for (const el of path) {
    if (el.matches('tp-yt-iron-dropdown') && typeof el.close === 'function') {
      try { el.close(); closed = true; } catch {}
    }
  }
  if (closed) return;
  // m.youtube: הגיליון התחתון נסגר כמו אצל יוטיוב – חזרה מ-#bottom-sheet, או "סגירה" של הרקע
  const sheet = path.find(el => el.matches('bottom-sheet-container'));
  if (sheet) {
    if (location.hash === '#bottom-sheet') { history.back(); return; }
    const scrim = sheet.querySelector('.ytWebScrimHiddenButton, button.close-button');
    if (scrim) { try { scrim.click(); return; } catch {} }
  }
  // מובייל / תפריטים חדשים: Escape סוגר את החלון הקופץ העליון
  const target = document.activeElement || document.body;
  obSyntheticEscape = true;
  try {
    for (const type of ['keydown', 'keyup']) {
      try { target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true })); } catch {}
    }
  } finally {
    obSyntheticEscape = false;
  }
  const overlay = document.querySelector('.bottom-sheet-overlay, ytm-bottom-sheet-renderer ~ .c3-overlay, c3-overlay');
  if (overlay && obVisible(overlay)) try { overlay.click(); } catch {}
}
