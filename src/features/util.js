// עזרים משותפים לכל הרכיבים.

// הליבה: כל הפיצ'רים. רץ בהקשר של דף יוטיוב, מ-document_start.
// יוטיוב אוכף Trusted Types, ולכן כל ה-DOM נבנה ב-createElement ולא ב-innerHTML.

const S = migrateSettings({ ...DEFAULTS, ...Platform.load() });

// ---------- עזרים ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// מחזיר את השליטה לדפדפן בלי setTimeout: בלשונית שברקע כרום מאט טיימרים (עד פעם בדקה
// אחרי כמה דקות), ולולאה שנשענת על sleep(0) פשוט נתקעת עד שחוזרים ללשונית.
// הודעות MessageChannel לא מואטות – ולכן ההמרה ממשיכה גם כשעובדים בחלון אחר.
const taskWaiters = [];
const taskChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
if (taskChannel) taskChannel.port1.onmessage = () => { const r = taskWaiters.shift(); if (r) r(); };
const nextTask = () => (taskChannel
  ? new Promise(res => { taskWaiters.push(res); taskChannel.port2.postMessage(0); })
  : sleep(0));
const onReady = fn => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : fn());

function videoId() {
  const u = new URL(location.href);
  const v = u.searchParams.get('v');
  if (/^[\w-]{11}$/.test(v || '')) return v;
  const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function player() {
  return document.querySelector('#movie_player');
}

function video() {
  const all = [...document.querySelectorAll('video')];
  return all.find(v => !v.paused && v.readyState > 1)
    || all.find(v => v.readyState > 0 && v.offsetWidth)
    || document.querySelector('#movie_player video')
    || all[0] || null;
}

const safeName = t => [...(t || '')].map(c => (c < ' ' || '\\/:*?"<>|'.includes(c) ? ' ' : c)).join('').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
const fill = (el, ...kids) => el.replaceChildren(...kids.filter(k => k != null && k !== false));

// ---------- תוספות (רכיב D) ----------

// באיזה אתר אנחנו: www / m.youtube / music – לכל אחד רכיבים אחרים (ytd-* / ytm-* / ytmusic-*).
const SITE = location.hostname.startsWith('music.') ? 'music' : location.hostname.startsWith('m.') ? 'mobile' : 'www';
const onShorts = () => location.pathname.startsWith('/shorts');

// תצוגות מקדימות (ריחוף בדף הבית) מנגנות וידאו משלהן – הן לא "הסרטון".
const PREVIEW_SEL = 'ytd-video-preview, #inline-preview-player, ytm-inline-playback-renderer, ytd-inline-player';

// הנגן הפעיל: בשורטס של www זה #shorts-player בתוך הריל הפעיל, אחרת #movie_player.
function activePlayer() {
  if (onShorts()) {
    const p = document.querySelector('ytd-reel-video-renderer[is-active] .html5-video-player, #shorts-player, ytm-reel-player-renderer .html5-video-player');
    if (p) return p;
  }
  return player() || document.querySelector('.html5-video-player');
}

// הסרטון שהמשתמש צופה בו: מדלג על תצוגות מקדימות, מעדיף את הריל הפעיל, מנגן וגלוי.
function mainVideo() {
  const all = [...document.querySelectorAll('video')];
  const score = v => {
    let s = 0;
    if (v.closest(PREVIEW_SEL)) s -= 100;
    if (v.closest('ytd-reel-video-renderer[is-active]')) s += 40;
    if (!v.paused) s += 20;
    if (v.readyState > 1) s += 10;
    if (v.closest('#movie_player, #shorts-player, ytmusic-player')) s += 5;
    const r = v.getBoundingClientRect();
    if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) s += 8;
    return s;
  };
  let best = null, bestScore = -Infinity;
  for (const v of all) {
    const s = score(v);
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best && bestScore > -50 ? best : null;
}

// האם אירוע מקלדת הגיע משדה טקסט: תגובות, חיפוש, צ'אט (גם דרך shadow DOM).
function isTyping(e) {
  for (const el of e.composedPath ? e.composedPath() : [e.target]) {
    if (!el || el === document || el === window || el.nodeType !== 1) continue;
    // החלונית שלנו ב-shadow סגור: מבחוץ רואים רק את ה-host, אז בודקים את השדה הממוקד בפנים
    if (el.id === 'ytu-host') {
      const inner = typeof shadow !== 'undefined' && shadow ? shadow.activeElement : null;
      if (inner && /^(INPUT|TEXTAREA|SELECT)$/.test(inner.tagName) && inner.type !== 'checkbox') return true;
    }
    if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    const role = el.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  }
  return false;
}
