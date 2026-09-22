// ---------- ממשק בתוך יוטיוב: רק במקומות של יוטיוב, בעיצוב של יוטיוב ----------
// אין כפתור בנגן, אין כפתור צף ואין חלונית משלנו. מה שנשאר כאן:
// - host עם shadow סגור לטוסט (yt-notification-action-renderer) ולדיאלוגים, בצבעים של יוטיוב (בהיר/כהה לפי ytDark()).
// - טמפרמונקי בלבד: דיאלוג הגדרות + פריט "הגדרות יוטיוב פרימיום" בתפריט ⚙ של הנגן ובתפריט האווטאר/⋮ של יוטיוב.
//   בתוסף ההגדרות נמצאות רק בחלון התוסף.

let host, shadow;

// שפת הממשק של יוטיוב: עברית, אחרת אנגלית
const uiHebrew = () => /^(he|iw)\b/i.test(document.documentElement.lang || navigator.language || 'he');
const uiText = (he, en) => (uiHebrew() || !en ? he : en);
// כיוון הדף כמו שיוטיוב קבע (html[dir] ב-www, body[dir] ב-m.youtube) – גם בערבית/פרסית, כי הכותרות מגיעות מ-yt.msgs_ בשפת הדף.
// uiHebrew() נשאר רק לבחירה בין הטקסטים שלנו בעברית/אנגלית
function pageDir() {
  for (const el of [document.documentElement, document.body]) {
    const d = el && (el.getAttribute('dir') || '').toLowerCase();
    if (d === 'rtl' || d === 'ltr') return d;
  }
  try {
    const d = document.body && getComputedStyle(document.body).direction;
    if (d === 'rtl' || d === 'ltr') return d;
  } catch {}
  return /^(he|iw|ar|fa|ur|yi|ps|sd|ug|ckb)/i.test(document.documentElement.lang || navigator.language || 'he') ? 'rtl' : 'ltr';
}
// ערכת הצבעים שמצוירת בפועל. www: html[dark]. מיוזיק תמיד כהה. m.youtube: אין html[dark]
// (נבדק 16/09/2026: רק darker-dark-theme, זהה בבהיר ובכהה) – לפי הבהירות של צבע הרקע.
function ytDark() {
  if (SITE === 'music') return true;
  if (SITE === 'www' && document.documentElement.hasAttribute('dark')) return true;
  for (const el of [document.documentElement, document.body, document.querySelector('ytm-app, ytd-app')]) {
    if (!el) continue;
    const m = (getComputedStyle(el).backgroundColor || '').match(/[\d.]+/g);
    if (!m || m.length < 3 || (m.length > 3 && +m[3] === 0)) continue;
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] < 128;
  }
  return false;
}

const SETTINGS_TITLE = () => uiText('הגדרות יוטיוב פרימיום', 'YouTube Premium settings');
const GEAR_PATH = 'M12.844 1h-1.687a2 2 0 00-1.962 1.616 3 3 0 01-3.92 2.263 2 2 0 00-2.38.891l-.842 1.46a2 2 0 00.417 2.507 3 3 0 010 4.525 2 2 0 00-.417 2.507l.843 1.46a2 2 0 002.38.892 3.001 3.001 0 013.918 2.263A2 2 0 0011.157 23h1.686a2 2 0 001.963-1.615 3.002 3.002 0 013.92-2.263 2 2 0 002.38-.892l.842-1.46a2 2 0 00-.418-2.507 3 3 0 010-4.526 2 2 0 00.418-2.508l-.843-1.46a2 2 0 00-2.38-.891 3 3 0 01-3.919-2.263A2 2 0 0012.844 1Zm-1.767 2.347a6 6 0 00.08-.347h1.687a4.98 4.98 0 002.407 3.37 4.98 4.98 0 004.122.4l.843 1.46A4.98 4.98 0 0018.5 12a4.98 4.98 0 001.716 3.77l-.843 1.46a4.98 4.98 0 00-4.123.4A4.979 4.979 0 0012.843 21h-1.686a4.98 4.98 0 00-2.408-3.371 4.999 4.999 0 00-4.12-.399l-.844-1.46A4.979 4.979 0 005.5 12a4.98 4.98 0 00-1.715-3.77l.842-1.459a4.98 4.98 0 004.123-.399 4.981 4.981 0 002.327-3.025ZM16 12a4 4 0 11-7.999 0 4 4 0 018 0Zm-4 2a2 2 0 100-4 2 2 0 000 4Z';

// הצבעים והמידות נלקחו מהדף האמיתי (16/09/2026): תפריט ⋮ לבן/‎#282828, טקסט ‎#0f0f0f/‎#f1f1f1, כחול ‎#065fd4/‎#3ea6ff.
const PANEL_CSS = `
:host { all: initial; }
:host {
  --yt-bg: #fff; --yt-raised: #fff; --yt-text: #0f0f0f; --yt-text2: #606060; --yt-line: rgba(0,0,0,.1);
  --yt-hover: rgba(0,0,0,.05); --yt-blue: #065fd4; --yt-blue-hover: #def1ff; --yt-on-blue: #fff;
  --yt-chip: rgba(0,0,0,.05); --yt-chip-hover: rgba(0,0,0,.1); --yt-err: #cc0000; --yt-ok: #107516;
  --yt-snack-bg: #0f0f0f; --yt-snack-text: #f1f1f1; --yt-snack-act: #3ea6ff; --yt-snack-track: #606060; --yt-track: #717171; --yt-track-on: rgba(6,95,212,.5); --yt-knob: #fff;
}
:host([dark]) {
  --yt-bg: #212121; --yt-raised: #282828; --yt-text: #f1f1f1; --yt-text2: #aaa; --yt-line: rgba(255,255,255,.2);
  --yt-hover: rgba(255,255,255,.1); --yt-blue: #3ea6ff; --yt-blue-hover: #263850; --yt-on-blue: #0f0f0f;
  --yt-chip: rgba(255,255,255,.1); --yt-chip-hover: rgba(255,255,255,.2); --yt-err: #ff8983; --yt-ok: #81c995;
  --yt-snack-bg: #f1f1f1; --yt-snack-text: #0f0f0f; --yt-snack-act: #065fd4; --yt-snack-track: #606060; --yt-track: #aaa; --yt-track-on: rgba(62,166,255,.5); --yt-knob: #f1f1f1;
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
/* טוסט כמו tp-yt-paper-toast.yt-notification-action-renderer (margin 16, radius 8, #text-container padding 12);
   בהורדה: yt-notification-action-renderer.is-download – radius 8 8 0 0 ופס tp-yt-paper-progress בתחתית */
.toast { position: fixed; bottom: 0; left: 0; margin: 16px; z-index: 2147483647; display: flex; flex-direction: row; align-items: center;
  min-width: 288px; max-width: min(568px, calc(100vw - 32px)); min-height: 48px; padding: 0; border-radius: 8px;
  background: var(--yt-snack-bg); color: var(--yt-snack-text); font: 400 14px/20px Roboto, Arial, sans-serif; box-shadow: 0 0 24px 0 rgba(0,0,0,.1);
  opacity: 0; transform: translateY(24px); transition: opacity .2s, transform .2s; pointer-events: none; }
.toast[dir=rtl] { left: auto; right: 0; }
.toast.show { opacity: 1; transform: none; pointer-events: auto; }
.toast.is-download { border-radius: 8px 8px 0 0; }
.toast-text { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; padding: 12px; overflow-wrap: anywhere; }
.toast.is-download .toast-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toast-act { flex: none; height: 36px; padding: 0 16px; border-radius: 18px; font: 500 14px/36px Roboto, Arial, sans-serif; color: var(--yt-snack-act); white-space: nowrap; }
.toast-act:hover { background: rgba(62,166,255,.15); }
.toast-close { flex: none; width: 40px; height: 40px; padding: 8px; margin-inline-start: 4px; border-radius: 50%; color: var(--yt-snack-text); }
.toast-close:hover { background: rgba(127,127,127,.2); }
.toast-close svg { display: block; width: 24px; height: 24px; fill: currentColor; }
/* tp-yt-paper-progress: #606060 בשתי הערכות, ומתמלא משמאל לימין גם בעברית (transform-origin: left) */
.toast-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--yt-snack-track); overflow: hidden; direction: ltr; }
.toast-progress i { display: block; height: 100%; width: 0; background: var(--yt-snack-act); transition: width 1.3s ease-out; }
@media (max-width: 600px) { .toast { min-width: 0; left: 0; right: 0; } .toast.is-download .toast-sub { white-space: normal; } }
/* m.youtube: c3-toast – 8px מהקצוות, padding 14 12 14 10, מעל סרגל הניווט התחתון (bottom נקבע ב-JS) */
.toast.mweb { margin: 8px; left: 0; right: 0; min-width: 0; max-width: none; padding: 14px 12px 14px 10px; }
.toast.mweb .toast-text { padding: 0; }
.toast.mweb .toast-act { margin-inline-start: 8px; }
.toast.mweb .toast-sub { white-space: normal; }
.dlg-back { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 16px;
  font: 400 14px/20px Roboto, Arial, sans-serif; }
.dlg { width: min(480px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--yt-raised); color: var(--yt-text);
  border-radius: 12px; box-shadow: 0 4px 32px rgba(0,0,0,.1); overflow: hidden; }
.dlg-head { padding: 24px 24px 8px; }
.dlg h2 { margin: 0; font: 400 20px/28px "YouTube Sans", Roboto, Arial, sans-serif; }
.dlg-body { padding: 8px 24px; overflow: auto; }
.dlg-body p { margin: 0 0 12px; color: var(--yt-text2); }
.dlg-acts { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px 16px; }
.btn { height: 36px; padding: 0 16px; border-radius: 18px; font: 500 14px/36px Roboto, Arial, sans-serif; color: var(--yt-blue); white-space: nowrap; }
.btn:hover { background: var(--yt-blue-hover); }
.btn.filled { background: var(--yt-blue); color: var(--yt-on-blue); }
.btn.filled:hover { filter: brightness(1.08); }
.btn.tonal { background: var(--yt-chip); color: var(--yt-text); }
.btn.tonal:hover { background: var(--yt-chip-hover); }
.btn:disabled { opacity: .5; cursor: default; background: none; }
.btn:focus-visible, .sw:focus-visible, select:focus-visible { outline: 2px solid var(--yt-blue); outline-offset: 2px; }
.group { margin: 16px 0 4px; font: 500 16px/22px Roboto, Arial, sans-serif; }
.group:first-child { margin-top: 4px; }
.opt { display: flex; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--yt-line); cursor: pointer; }
.opt .txt { flex: 1; min-width: 0; }
.opt small { display: block; color: var(--yt-text2); font-size: 12px; line-height: 18px; margin-top: 2px; }
.sw { appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 36px; height: 14px; margin: 3px 3px; border-radius: 7px;
  background: var(--yt-track); cursor: pointer; transition: background .15s; }
.sw::after { content: ''; position: absolute; top: -3px; inset-inline-start: -3px; width: 20px; height: 20px; border-radius: 50%; background: var(--yt-knob);
  box-shadow: 0 1px 5px rgba(0,0,0,.6); transition: inset-inline-start .15s, background .15s; }
.sw:checked { background: var(--yt-track-on); }
.sw:checked::after { inset-inline-start: 19px; background: var(--yt-blue); }
select { font: 400 14px/20px Roboto, Arial, sans-serif; color: var(--yt-text); background: var(--yt-chip); border: 0; border-bottom: 1px solid var(--yt-line); border-radius: 8px 8px 0 0; padding: 8px 10px; }
select { flex: none; max-width: 180px; cursor: pointer; }
select option { background: var(--yt-raised); color: var(--yt-text); }
.credit { padding: 12px 24px 0; color: var(--yt-text2); font-size: 12px; line-height: 18px; text-align: center; }
.credit a { color: var(--yt-blue); text-decoration: none; font-weight: 500; }
.credit a:hover { text-decoration: underline; }
`;

function ui() {
  if (!host) {
    host = h('div', { id: 'ytu-host' });
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS + (typeof DOWNLOAD_CSS !== 'undefined' ? DOWNLOAD_CSS : '');
    shadow.append(style, h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }));
  }
  host.toggleAttribute('dark', ytDark());
  const t = shadow.querySelector('.toast');
  if (t) t.setAttribute('dir', pageDir());
  if (!host.isConnected) (document.body || document.documentElement).append(host);
}

// ---------- טוסט של יוטיוב (טוסט אחד בכל פעם, כמו ytd-popup-container) ----------

const CLOSE_PATH = 'M12.7 12l6.6 6.6-.7.7-6.6-6.6-6.6 6.6-.7-.7 6.6-6.6-6.6-6.6.7-.7 6.6 6.6 6.6-6.6.7.7-6.6 6.6z';
function ytIcon(d, size) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size || 24));
  s.setAttribute('height', String(size || 24));
  s.setAttribute('aria-hidden', 'true');
  for (const path of [].concat(d)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    s.append(p);
  }
  return s;
}

let toastTimer = 0;
let toastToken = 0;

// כמה להרים את הטוסט (ערך bottom): פס הנגן במיוזיק, סרגל הניווט התחתון במובייל
function toastLift() {
  if (SITE === 'music') {
    const bar = document.querySelector('ytmusic-player-bar');
    const lift = bar && bar.getClientRects().length ? bar.offsetHeight : 0;
    return lift ? lift + 'px' : '';
  }
  if (SITE === 'mobile') {
    if (document.querySelector('[modal-open-body], [shorts-player="true"]')) return '';
    const pivot = document.querySelector('ytm-pivot-bar-renderer');
    const shown = document.querySelector('[has-pivot-bar="true"]') && pivot && pivot.getClientRects().length && pivot.offsetHeight;
    return shown ? `calc(${pivot.offsetHeight}px + env(safe-area-inset-bottom, 0px))` : 'env(safe-area-inset-bottom, 0px)';
  }
  return '';
}
// opts: { text, sub?, action?: { label, run }, close?: bool, progress?: number|null (0–100, רק בהורדה), ms?: 0 = עד שנסגר }
// מחזיר { update(opts), hide() } – update מעדכן רק אם הטוסט עדיין שלנו
function ytToast(opts) {
  ui();
  const el = shadow.querySelector('.toast');
  const token = ++toastToken;
  const hide = () => { if (toastToken === token) { clearTimeout(toastTimer); el.classList.remove('show'); } };
  const render = o => {
    const kids = [h('div', { class: 'toast-text' },
      h('div', { class: 'toast-main' }, o.text || ''),
      o.sub ? h('div', { class: 'toast-sub' }, o.sub) : null)];
    if (o.action) kids.push(h('button', { class: 'toast-act', onclick: () => { hide(); o.action.run(); } }, o.action.label));
    if (o.close) {
      kids.push(h('button', { class: 'toast-close', 'aria-label': uiText('סגירה', 'Close'), onclick: hide }, ytIcon(CLOSE_PATH)));
    }
    const isDl = o.progress !== undefined;
    el.classList.toggle('is-download', isDl);
    if (isDl) {
      const bar = h('i');
      bar.style.width = Math.max(0, Math.min(100, +o.progress || 0)) + '%';
      kids.push(h('div', { class: 'toast-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(+o.progress || 0)) }, bar));
    }
    el.replaceChildren(...kids);
    // יוטיוב מיוזיק: מעל פס הנגן; m.youtube: מעל סרגל הניווט ([has-pivot-bar="true"] c3-toast)
    el.classList.toggle('mweb', SITE === 'mobile');
    el.style.bottom = toastLift();
    el.classList.add('show');
    clearTimeout(toastTimer);
    const ms = o.ms != null ? o.ms : o.action ? 8000 : 4000;
    if (ms > 0) toastTimer = setTimeout(hide, ms);
  };
  render(opts);
  return {
    update(o) {
      if (toastToken !== token) return false;
      // עדכון התקדמות בלבד – בלי לבנות מחדש (שהאנימציה של הפס תעבוד)
      const bar = el.querySelector('.toast-progress');
      const main = el.querySelector('.toast-main');
      if (bar && o.progress !== undefined && main && main.textContent === (o.text || '') && el.classList.contains('show')) {
        bar.firstChild.style.width = Math.max(0, Math.min(100, +o.progress || 0)) + '%';
        bar.setAttribute('aria-valuenow', String(Math.round(+o.progress || 0)));
        el.style.bottom = toastLift(); // מעבר SPA בזמן ההורדה (למשל לדף הבית עם סרגל הניווט)
        return true;
      }
      if (!el.classList.contains('show')) return false; // המשתמש סגר – לא פותחים שוב
      render(o);
      return true;
    },
    hide,
    get visible() { return toastToken === token && el.classList.contains('show'); },
  };
}

// ---------- דיאלוג בעיצוב של יוטיוב ----------

// מקלדת בתוך דיאלוג לא מגיעה לקיצורים של יוטיוב (k, f, רווח…)
const stopKeys = el => {
  for (const type of ['keydown', 'keypress', 'keyup']) el.addEventListener(type, e => e.stopPropagation());
  return el;
};

// פותח דיאלוג. מחזיר { back, close }. onClose(value) נקרא פעם אחת
function ytDialog({ title, body, actions, onClose, label, className, dir: forceDir }) {
  ui();
  let closed = false;
  const dir = forceDir || pageDir();
  const close = value => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    back.remove();
    if (onClose) onClose(value);
  };
  const onKey = e => {
    if (e.key !== 'Escape' || !back.isConnected) return;
    // Escape מדומה שנשלח כדי לסגור תפריט של יוטיוב לא סוגר את הדיאלוג
    if (typeof obSyntheticEscape !== 'undefined' && obSyntheticEscape) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close(false);
  };
  const back = h('div', { class: 'dlg-back', dir, onclick: e => { if (e.target === back) close(false); } },
    h('div', { class: 'dlg' + (className ? ' ' + className : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title || '' },
      title ? h('div', { class: 'dlg-head' }, h('h2', null, title)) : null,
      h('div', { class: 'dlg-body' }, body),
      actions && actions.length ? h('div', { class: 'dlg-acts' }, actions) : null));
  stopKeys(back);
  window.addEventListener('keydown', onKey, true);
  shadow.append(back);
  return { back, close };
}

// ---------- הגדרות (טמפרמונקי בלבד) ----------

const settingLabel = s => uiText(s.label, s.labelEn);
const settingDesc = s => uiText(s.desc || '', s.descEn);

function settingRow(s) {
  const desc = settingDesc(s);
  const text = h('div', { class: 'txt' }, settingLabel(s), desc ? h('small', null, desc) : null);
  if (s.type === 'select') {
    const opts = (s.options || []).map(o => h('option', { value: o.value, selected: String(S[s.key]) === String(o.value) }, uiText(o.label, o.labelEn)));
    return h('label', { class: 'opt' }, text, h('select', { onchange: e => update({ [s.key]: e.target.value }) }, opts));
  }
  const box = h('input', { class: 'sw', type: 'checkbox', role: 'switch', checked: !!S[s.key] });
  box.addEventListener('change', () => update({ [s.key]: box.checked }));
  return h('label', { class: 'opt' }, text, box);
}

function renderSettings(container) {
  const kids = [];
  for (const g of SETTING_GROUPS) {
    const items = SETTINGS.filter(s => s.group === g.id);
    if (!items.length) continue;
    kids.push(h('div', { class: 'group' }, uiText(g.label, g.labelEn)), ...items.map(settingRow));
  }
  container.append(...kids);
  return container;
}

function creditLine() {
  return h('div', { class: 'credit' }, uiText('נוצר ע"י צול גאה · ', 'Made by Tsool Gaeh · '),
    h('a', { href: 'https://tsoolgee.uk', target: '_blank', rel: 'noopener' }, 'TSOOLGEE.UK'));
}

let settingsDlg = null;

function openSettingsDialog() {
  if (Platform.kind === 'extension') return; // בתוסף – רק בחלון התוסף
  if (settingsDlg && settingsDlg.back.isConnected) return;
  const body = renderSettings(h('div', { class: 'settings' }));
  body.append(creditLine());
  const done = h('button', { class: 'btn', onclick: () => settingsDlg && settingsDlg.close(true) }, uiText('סגירה', 'Close'));
  // כל הטקסטים כאן שלנו (עברית/אנגלית) – הכיוון לפי השפה שלהם
  settingsDlg = ytDialog({ title: SETTINGS_TITLE(), body, actions: [done], dir: uiHebrew() ? 'rtl' : 'ltr', onClose: () => { settingsDlg = null; } });
  done.focus();
}

// שינוי הגדרות מלשונית אחרת בזמן שהדיאלוג פתוח – מציירים את התוכן מחדש
function refreshSettingsDialog() {
  if (!settingsDlg || !settingsDlg.back.isConnected) return;
  const box = settingsDlg.back.querySelector('.settings');
  const active = shadow && shadow.activeElement;
  if (!box || (active && box.contains(active) && active.matches('select'))) return;
  box.replaceChildren();
  renderSettings(box);
  box.append(creditLine());
}

// ---------- נקודות כניסה מקוריות להגדרות (טמפרמונקי בלבד) ----------

const ENTRY_ATTR = 'data-ytu-settings';

function gearIcon(fill) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '24');
  s.setAttribute('height', '24');
  s.setAttribute('fill', 'none');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', GEAR_PATH);
  p.setAttribute('fill', fill);
  p.setAttribute('fill-rule', 'evenodd');
  s.append(p);
  return s;
}

// 1. תפריט ⚙ של הנגן: פריט .ytp-menuitem כמו "איכות" / "מהירות הפעלה" (העיצוב מגיע מה-CSS של יוטיוב)
function playerMenuItem(menu) {
  const open = e => {
    e.preventDefault();
    e.stopPropagation();
    // סוגרים את תפריט ⚙ כמו שיוטיוב סוגר אחרי בחירה
    const btn = menu.closest('.html5-video-player')?.querySelector('.ytp-settings-button');
    if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
    openSettingsDialog();
  };
  return h('div', {
    class: 'ytp-menuitem', role: 'menuitem', tabindex: '0', [ENTRY_ATTR]: '',
    onclick: open,
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') open(e); },
  },
  h('div', { class: 'ytp-menuitem-icon' }, gearIcon('white')),
  h('div', { class: 'ytp-menuitem-label' }, SETTINGS_TITLE()),
  h('div', { class: 'ytp-menuitem-content' }));
}

// יוטיוב קובע גובה קבוע לתפריט לפי הפריטים שלו – מוסיפים את הגובה של הפריט שלנו אם יש מקום בנגן
// התפריט הראשי של ⚙ הוא הפאנל בלי כותרת (לתתי-התפריטים "איכות", "מהירות הפעלה" יש .ytp-panel-header)
const mainSettingsPanel = popup => [...popup.querySelectorAll('.ytp-panel')].find(p => !p.querySelector(':scope > .ytp-panel-header'));

function fitPlayerMenu(popup) {
  const panel = mainSettingsPanel(popup);
  const list = panel && panel.querySelector(':scope > .ytp-panel-menu');
  const item = list && list.querySelector(`:scope > [${ENTRY_ATTR}]`);
  if (!item || popup.style.display === 'none') return;
  const need = list.scrollHeight - list.clientHeight;
  if (need <= 0) return;
  const playerEl = popup.closest('.html5-video-player');
  const room = playerEl ? playerEl.clientHeight - 60 : Infinity; // מקום מעל פס הכפתורים
  const cur = parseFloat(popup.style.height) || popup.offsetHeight;
  const next = Math.min(cur + need, room);
  if (next <= cur) return;
  for (const el of [popup, panel, list]) if (el.style.height) el.style.height = next + 'px';
}

const watchedMenus = new WeakSet();

function ensurePlayerEntry() {
  for (const popup of document.querySelectorAll('.ytp-settings-menu')) {
    // רק בתפריט הראשי (לא בתתי-התפריטים כמו "מהירות הפעלה")
    const panel = mainSettingsPanel(popup);
    const list = panel && panel.querySelector(':scope > .ytp-panel-menu');
    if (!list || !list.querySelector('.ytp-menuitem:not([' + ENTRY_ATTR + '])')) continue;
    const mine = list.querySelector(`:scope > [${ENTRY_ATTR}]`);
    if (!mine) list.append(playerMenuItem(popup));
    else if (mine !== list.lastElementChild) list.append(mine); // יוטיוב הוסיף פריט – נשארים אחרונים
    if (!watchedMenus.has(popup)) {
      watchedMenus.add(popup);
      new MutationObserver(() => fitPlayerMenu(popup)).observe(popup, { attributes: true, attributeFilter: ['style'] });
    }
    fitPlayerMenu(popup);
  }
}

// 2. תפריט האווטאר / ⋮ בראש הדף: שורה כמו "הגדרות" (40px, אייקון 24, רווח 16, Roboto 14)
const MASTHEAD_CSS_ID = 'ytu-masthead-entry-css';
function ensureMastheadCss() {
  if (document.getElementById(MASTHEAD_CSS_ID)) return;
  const style = document.createElement('style');
  style.id = MASTHEAD_CSS_ID;
  style.textContent = `
[${ENTRY_ATTR}].ytu-compact { display: flex; align-items: center; height: 40px; min-height: 40px; padding: 0 16px; cursor: pointer;
  color: #0f0f0f; font: 400 14px/20px Roboto, Arial, sans-serif; outline: none; }
[${ENTRY_ATTR}].ytu-compact:hover, [${ENTRY_ATTR}].ytu-compact:focus-visible { background: rgba(0,0,0,.05); }
/* יוטיוב כבר לא מגדיר --yt-spec-* (טוקנים מוצפנים) – צבעים מפורשים. מיוזיק תמיד כהה */
html[dark] [${ENTRY_ATTR}].ytu-compact, ytmusic-popup-container [${ENTRY_ATTR}].ytu-compact { color: #f1f1f1; }
html[dark] [${ENTRY_ATTR}].ytu-compact:hover, html[dark] [${ENTRY_ATTR}].ytu-compact:focus-visible,
ytmusic-popup-container [${ENTRY_ATTR}].ytu-compact:hover, ytmusic-popup-container [${ENTRY_ATTR}].ytu-compact:focus-visible { background: rgba(255,255,255,.1); }
[${ENTRY_ATTR}].ytu-compact .ytu-icon { flex: none; width: 24px; height: 24px; margin-inline-end: 16px; color: inherit; }
[${ENTRY_ATTR}].ytu-compact .ytu-icon svg { display: block; width: 100%; height: 100%; }
[${ENTRY_ATTR}].ytu-compact .ytu-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;
  (document.head || document.documentElement).append(style);
}

function mastheadItem() {
  const open = e => {
    e.preventDefault();
    e.stopPropagation();
    // סוגרים את התפריט של יוטיוב (לחיצה נוספת על הכפתור שפתח אותו)
    const opener = document.querySelector('ytd-masthead #avatar-btn, ytd-masthead ytd-topbar-menu-button-renderer #button button');
    const dropdown = e.currentTarget.closest('tp-yt-iron-dropdown');
    if (dropdown && typeof dropdown.close === 'function') dropdown.close();
    else if (opener) opener.click();
    openSettingsDialog();
  };
  return h('div', {
    class: 'ytu-compact', role: 'link', tabindex: '0', [ENTRY_ATTR]: '',
    onclick: open,
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') open(e); },
  },
  h('div', { class: 'ytu-icon' }, gearIcon('currentColor')),
  h('div', { class: 'ytu-label' }, SETTINGS_TITLE()));
}

const SETTINGS_WORD = /^\s*(הגדרות|Settings)\s*$/i;

function ensureMastheadEntry() {
  if (SITE === 'mobile') return ensureMobileEntry();
  // www: ytd-popup-container. YouTube Music משתמש באותו ytd-multi-page-menu-renderer בתוך ytmusic-popup-container
  for (const menu of document.querySelectorAll('ytd-popup-container ytd-multi-page-menu-renderer, ytmusic-popup-container ytd-multi-page-menu-renderer')) {
    if (menu.querySelector(`[${ENTRY_ATTR}]`) || !menu.getClientRects().length) continue;
    // השורה "הגדרות" (קישור ל-/account) – גם בתפריט האווטאר וגם בתפריט ⋮ כשלא מחוברים.
    // ב-Music לשורה אין href (פותחת דיאלוג) – מזהים לפי הטקסט
    const rows = [...menu.querySelectorAll('ytd-compact-link-renderer')];
    const row = rows.find(r => { const a = r.querySelector('a[href]'); return a && /^\/account(\?|$)/.test(a.getAttribute('href')); })
      || (SITE === 'music' ? rows.find(r => SETTINGS_WORD.test(r.textContent || '')) || rows[rows.length - 1] : null);
    if (!row || !row.parentElement) continue;
    ensureMastheadCss();
    row.after(mastheadItem());
  }
}

// 3. m.youtube: גיליון ⋮ בראש הדף (bottom-sheet-container, ‎#bottom-sheet בכתובת) – ytm-menu-item כמו "הגדרות"
function ensureMobileEntry() {
  for (const sheet of document.querySelectorAll('bottom-sheet-container')) {
    if (sheet.querySelector(`[${ENTRY_ATTR}]`)) continue;
    const items = [...sheet.querySelectorAll('ytm-menu-item')];
    const settings = items.find(it => {
      const a = it.querySelector('a[href]');
      return (a && /^\/(select_site|account)(\?|$)/.test(a.getAttribute('href'))) || SETTINGS_WORD.test(it.textContent || '');
    });
    if (!settings || !settings.parentElement) continue;
    const open = e => {
      e.preventDefault();
      e.stopPropagation();
      // הגיליון נסגר כמו ביוטיוב: חזרה בהיסטוריה מ-#bottom-sheet
      if (location.hash === '#bottom-sheet') history.back();
      setTimeout(openSettingsDialog, 250);
    };
    const btn = h('button', { class: 'menu-item-button', type: 'button', onclick: open }, SETTINGS_TITLE());
    const item = document.createElement('ytm-menu-item');
    item.setAttribute(ENTRY_ATTR, '');
    item.append(btn);
    settings.after(item);
    // יוטיוב מגביל את הגיליון לגובה השורות שלו (max-height בשורה) – מוסיפים שורה אחת (48px) אם יש מקום
    const wrap = item.closest('.ytSpecBottomSheetLayoutContentWrapper, #content-wrapper');
    const max = wrap && parseFloat(wrap.style.maxHeight);
    if (max && max + 48 <= innerHeight * 0.9) wrap.style.maxHeight = (max + 48) + 'px';
  }
}

function ensureSettingsEntry() {
  if (Platform.kind !== 'userscript') return;
  ensurePlayerEntry();
  ensureMastheadEntry();
}

// התפריטים נפתחים בלחיצה – מוסיפים את הפריט מיד, לא רק ב-tick הבא
if (Platform.kind === 'userscript') {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest && e.target.closest('.ytp-settings-button, ytd-topbar-menu-button-renderer, #avatar-btn, ytmusic-settings-button, ytm-mobile-topbar-renderer button');
    if (!t) return;
    for (const ms of [0, 60, 250, 600]) setTimeout(() => { try { ensureSettingsEntry(); } catch {} }, ms);
  }, true);
}
