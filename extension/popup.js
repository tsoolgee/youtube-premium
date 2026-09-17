// חלון התוסף: פקודות ללשונית, רשימת הורדות השרת והגדרות (אותו מודל כמו דיאלוג ההגדרות של הטמפרמונקי, עם מצייר משלו).
const $ = id => document.getElementById(id);
const hint = $('hint');
$('version').textContent = 'v' + chrome.runtime.getManifest().version;

// שפה: עברית אם הדפדפן בעברית, אחרת אנגלית (עם labelEn/descEn מ-settings.js)
const HE = /^(he|iw)\b/i.test((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'he');
const t = (he, en) => (HE || !en ? he : en);
document.documentElement.lang = HE ? 'he' : 'en';
document.documentElement.dir = HE ? 'rtl' : 'ltr';
if (!HE) {
  document.title = 'YouTube Premium';
  $('hero-text').textContent = 'Everything works inside YouTube, in the usual places: the Download button, the player ⚙ menu and the playback speed menu.';
  $('download-text').textContent = 'Download this video';
  $('jobs-title').textContent = 'Recent server downloads';
  $('jobs-sub').textContent = 'Downloads are saved to Google Drive; you can close this window meanwhile';
  $('credit-text').textContent = 'Made by Tsool Gaeh · ';
}

const STATE_TEXT = HE && typeof DRIVE_STATE_TEXT !== 'undefined' ? DRIVE_STATE_TEXT : {
  queued: 'Queued', checking: 'Checking the video', downloading: 'Downloading', converting: 'Converting', copying: 'Saving to Drive',
  uploading: 'Uploading to Drive', shortening: 'Shortening link', done: 'Ready', error: 'Failed',
};
const STAGE_TEXT = HE && typeof DRIVE_STAGE_TEXT !== 'undefined' ? DRIVE_STAGE_TEXT : {
  netfree: 'filter check', info: 'reading video details', video: 'video', audio: 'audio', merge: 'merging video and audio', convert: 'converting',
};
const ERROR_HINT = typeof DRIVE_ERROR_HINT !== 'undefined' ? DRIVE_ERROR_HINT : {};
const ERROR_EN = {
  NETFREE_BLOCKED: 'The video is blocked by the content filter.', NETFREE_PENDING: "The content filter hasn't checked this video yet.",
  NETFREE_STREAM_BLOCKED: 'The file is blocked by the content filter. Try audio only.', VIDEO_FILE_BLOCKED: 'The video file is blocked. Try audio only.',
  YT_BOT_CHECK: 'YouTube temporarily blocked the server. Try again later or turn on cookie sharing.', YT_PRIVATE: 'This video is private.',
  YT_UNAVAILABLE: 'This video is unavailable.', YT_AGE_RESTRICTED: 'This video is age-restricted.', LIVE_NOT_SUPPORTED: "Live streams can't be downloaded.",
  TOO_LONG: 'The video is too long for the server.', DRIVE_FULL: 'Google Drive storage is full.', QUEUE_FULL: 'The server is busy. Try again in a few minutes.',
  RATE_LIMIT: 'Too many downloads. Try again in an hour.', UNAUTHORIZED: 'The API key is wrong.', JOB_NOT_FOUND: 'The server restarted. Start the download again.',
  NETWORK: "Couldn't reach the server. Try again.", SERVER_OFFLINE: 'The server is offline. Try again later.',
  CLIENT_BLOCKED: 'The server address is blocked by the content filter.', BAD_RESPONSE: 'Unexpected response from the server. Try again.',
  TIMEOUT: "The extension didn't respond in time.", EXTENSION_ERROR: "The extension's background service isn't available.",
  COOKIES_DISABLED: "The server doesn't accept cookies right now.", COOKIES_INVALID: "The cookies didn't work. Sign in to YouTube again.",
  NO_COOKIE_ACCESS: 'Allow the extension to access cookies and try again.', NOT_LOGGED_IN: 'Sign in to YouTube in this browser and try again.',
};
const ACTIVE = typeof DRIVE_ACTIVE_STATES !== 'undefined' ? DRIVE_ACTIVE_STATES
  : ['queued', 'checking', 'downloading', 'converting', 'copying', 'uploading', 'shortening'];
const SHOW_JOBS = 8;

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

// בקשה ל-service worker. אם הוא לא עונה – תשובת שגיאה ולא חריגה
function bg(cmd, payload, timeout = 60000) {
  return new Promise(resolve => {
    const noBg = () => resolve({ ok: false, error: { code: 'EXTENSION_ERROR', message: 'רכיב הרקע של התוסף לא זמין' } });
    const timer = setTimeout(() => resolve({ ok: false, error: { code: 'TIMEOUT', message: 'התוסף לא ענה בזמן' } }), timeout);
    try {
      chrome.runtime.sendMessage({ ytuDrive: cmd, payload }, r => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || r === undefined) noBg();
        else resolve(r);
      });
    } catch {
      clearTimeout(timer);
      noBg();
    }
  });
}

// בעברית: ההודעה מהשרת + רמז; באנגלית: לפי קוד השגיאה
function errText(err) {
  if (!HE) return (err && ERROR_EN[err.code]) || 'Failed';
  const hint = (err && ERROR_HINT[err.code]) || '';
  const msg = (err && err.message) || '';
  // הודעה בלי עברית (מהשרת/מיוטיוב) – מספיק ההסבר בעברית
  if (hint && !/[א-ת]/.test(msg)) return hint;
  return (msg || 'נכשל') + (hint && msg !== hint ? ' ' + hint : '');
}

// ---------- פקודות ללשונית ----------

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const buttons = [$('download')].filter(Boolean);
  if (!tab) return buttons.forEach(b => (b.disabled = true));
  const send = cmd => chrome.tabs.sendMessage(tab.id, { ytu: cmd }, () => {
    if (chrome.runtime.lastError) hint.textContent = t('רעננו את דף יוטיוב ונסו שוב.', 'Reload the YouTube page and try again.');
    else window.close();
  });
  if (buttons[0]) buttons[0].onclick = () => send('download');

  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  if (!/(^|\.)youtube\.com$/.test(host)) {
    buttons.forEach(b => (b.disabled = true));
    hint.textContent = t('ההורדה זמינה בלשונית של יוטיוב.', 'Downloading is available in a YouTube tab.');
  }
});

// ---------- הורדות דרך השרת ----------

function jobKind(j) {
  if (j.type === 'audio') return t('שמע ', 'Audio ') + String(j.quality || '').toUpperCase();
  return t('וידאו ', 'Video ') + (j.quality === 'best' ? t('הכי טובה', 'best') : j.quality + 'p');
}

function jobStateText(j) {
  const active = ACTIVE.includes(j.state);
  let text = STATE_TEXT[j.state] || j.state || '';
  if (j.state === 'queued' && j.position) text += t(` (מקום ${j.position})`, ` (#${j.position})`);
  if (active && j.stage && STAGE_TEXT[j.stage]) text += ' · ' + STAGE_TEXT[j.stage];
  if (j.state === 'downloading' && typeof j.percent === 'number') text += ` ${Math.round(j.percent)}%`;
  if (active && j.offlineSince) text += t(' · אין חיבור לשרת', ' · no connection to the server');
  return text;
}

const mbText = n => {
  if (!n) return '';
  const mb = n / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(mb < 10 ? 1 : 0) + ' MB';
};

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // גיבוי כשה-clipboard API לא זמין
    const area = el('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  btn.textContent = t('הועתק', 'Copied');
  setTimeout(() => { btn.textContent = t('העתקה', 'Copy'); }, 1500);
}

function renderJob(j) {
  const active = ACTIVE.includes(j.state);
  // שורה: תמונה ממוזערת + גוף בעמודה (כותרת, פרטים, פס התקדמות / קישור / שגיאה)
  const vid = /^[\w-]{11}$/.test(j.videoId || '') ? j.videoId : (String(j.url || '').match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/shorts\/([\w-]{11})/) || []).slice(1).find(Boolean) || null;
  const thumb = el('div', { class: 'job-thumb' });
  if (vid) thumb.style.backgroundImage = `url("https://i.ytimg.com/vi/${vid}/mqdefault.jpg")`;
  const body = el('div', { class: 'job-body' },
    el('div', { class: 'job-title', title: j.title || j.url || '' }, j.title || j.url || ''),
    el('div', { class: 'job-meta' },
      el('span', null, jobKind(j)),
      el('span', { class: 'job-state ' + (j.state || '') }, jobStateText(j)),
      j.size ? el('span', { dir: 'ltr' }, mbText(j.size)) : null, // "3.2 MB" ולא "MB 3.2" בעברית
      j.cached ? el('span', null, t('(כבר היה בדרייב)', '(already in Drive)')) : null));
  const li = el('li', null, thumb, body);

  if (active) {
    const pct = j.state === 'downloading' && typeof j.percent === 'number' ? j.percent : null;
    const fillEl = el('i');
    if (pct != null) fillEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
    body.append(el('div', { class: 'bar' + (pct == null ? ' indet' : '') }, fillEl));
  }

  if (j.state === 'done' && j.short_url) {
    const input = el('input', { value: j.short_url, readOnly: true, onfocus: () => input.select() });
    const copy = el('button', { class: 'sm', onclick: () => copyText(j.short_url, copy) }, t('העתקה', 'Copy'));
    const open = el('button', { class: 'sm', onclick: () => chrome.tabs.create({ url: j.drive_url || j.view_url || j.short_url }) }, t('פתיחה', 'Open'));
    body.append(el('div', { class: 'job-link' }, input, copy, open));
  }

  if (j.state === 'error' && j.error) {
    const box = el('div', { class: 'job-err' }, errText(j.error));
    if (j.error.detail) box.title = j.error.detail;
    body.append(box);
  }
  return li;
}

let jobsBusy = false;
async function refreshJobs() {
  if (jobsBusy) return;
  jobsBusy = true;
  try {
    let list = await bg('jobs', null, 10000);
    if (!Array.isArray(list)) {
      // background לא ענה – קוראים ישירות מהאחסון
      const r = await chrome.storage.local.get('driveJobs').catch(() => ({}));
      list = Array.isArray(r.driveJobs) ? r.driveJobs : [];
    }
    const box = $('jobs');
    // לא לדרוס שדה קישור מסומן באמצע העתקה ידנית
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    if (!list.length) {
      return box.replaceChildren(el('div', { class: 'empty' },
        t('אין הורדות דרך השרת. אפשר לבחור "רק דרך השרת" בשיטת ההורדה למטה.', 'No server downloads. You can choose "Server only" under Download method below.')));
    }
    box.replaceChildren(el('ul', { class: 'jobs' }, list.slice(0, SHOW_JOBS).map(renderJob)));
  } finally {
    jobsBusy = false;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.driveJobs) refreshJobs();
});
refreshJobs();
setInterval(refreshJobs, 3000);

// ---------- הגדרות ----------

let current = { ...DEFAULTS };
const save = () => chrome.storage.local.set({ settings: storableSettings(current) });

// דיאלוג אישור. status: אלמנט אופציונלי שמתעדכן אחרי פתיחה (מצב השרת)
function confirmDialog({ title, text, ok = t('אישור', 'OK'), cancel = t('ביטול', 'Cancel') }, status) {
  return new Promise(resolve => {
    const done = v => { document.removeEventListener('keydown', onKey); back.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    const cancelBtn = el('button', { onclick: () => done(false) }, cancel);
    const back = el('div', { class: 'dlg-back' },
      el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true' },
        el('h2', null, title),
        [].concat(text || []).map(p => el('p', null, p)),
        status || null,
        el('div', { class: 'acts' }, cancelBtn, el('button', { class: 'primary', onclick: () => done(true) }, ok))));
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    cancelBtn.focus();
  });
}

async function enableCookies(box) {
  const status = el('p', { class: 'status' }, t('בודק אם השרת מקבל עוגיות…', 'Checking whether the server accepts cookies…'));
  bg('health', null, 45000).then(r => {
    if (!r || !r.ok) { status.className = 'status err'; status.textContent = t('אין כרגע חיבור לשרת: ', 'No connection to the server right now: ') + errText(r && r.error); }
    else if (r.accept_cookies) { status.className = 'status ok'; status.textContent = t('השרת מוגדר לקבל עוגיות.', 'The server is set up to accept cookies.'); }
    else { status.className = 'status err'; status.textContent = t('השרת לא מקבל עוגיות כרגע – שום דבר לא יישלח עד שיאפשר.', "The server doesn't accept cookies right now – nothing will be sent until it does."); }
  });
  const warning = HE || typeof COOKIE_WARNING_EN === 'undefined' ? COOKIE_WARNING : COOKIE_WARNING_EN;
  const yes = await confirmDialog(warning, status);
  box.checked = yes;
  if (!yes) return;
  current.shareCookies = true;
  // ההסכמה קשורה לכתובת השרת שהייתה מוגדרת כשאושרה (background בודק התאמה)
  current.shareCookiesServer = current.serverUrl || DEFAULTS.serverUrl;
  save();
  renderSettings();
}

function shareNowLine() {
  const msg = el('span', { class: 'msg' }, t('שולח את החיבור שלכם ליוטיוב לשרת, רק אם הוא מקבל עוגיות.', 'Sends your YouTube sign-in to the server, only if it accepts cookies.'));
  const btn = el('button', { class: 'sm' }, t('שתפו עוגיות עכשיו', 'Share cookies now'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = t('בודק ושולח…', 'Checking and sending…');
    const r = await bg('shareCookies', null, 90000);
    btn.disabled = false;
    if (r && r.ok) { msg.className = 'msg ok'; msg.textContent = (HE && r.message) || t('החיבור שותף בהצלחה', 'Sign-in shared'); }
    else { msg.className = 'msg err'; msg.textContent = errText(r && r.error); }
  });
  return el('div', { class: 'line' }, msg, btn);
}

function serverTestLine() {
  const msg = el('span', { class: 'msg' }, t('בדיקה שהשרת זמין', 'Check that the server is reachable'));
  const btn = el('button', { class: 'sm' }, t('בדיקת חיבור', 'Test connection'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = t('בודק…', 'Checking…');
    const r = await bg('health', null, 45000);
    btn.disabled = false;
    if (r && r.ok) {
      msg.className = 'msg ok';
      msg.textContent = t('מחובר · ', 'Connected · ') + (r.accept_cookies ? t('מקבל עוגיות', 'accepts cookies') : t('לא מקבל עוגיות', "doesn't accept cookies"));
    } else { msg.className = 'msg err'; msg.textContent = errText(r && r.error); }
  });
  return el('div', { class: 'line' }, msg, btn);
}

function settingRow(s) {
  const desc = t(s.desc || '', s.descEn);
  const text = el('div', null, t(s.label, s.labelEn), desc ? el('small', null, desc) : null);
  if (s.type === 'select') {
    return el('label', { class: 'opt' }, text,
      el('select', { onchange: e => { current[s.key] = e.target.value; save(); } },
        (s.options || []).map(o => el('option', { value: o.value, selected: String(current[s.key]) === String(o.value) }, t(o.label, o.labelEn)))));
  }
  if (s.type === 'text') {
    const input = el('input', {
      class: 'text', type: s.secret ? 'password' : 'text', value: current[s.key] == null ? '' : String(current[s.key]),
      spellcheck: false, autocomplete: 'off',
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => {
      const value = input.value.trim() || s.def;
      if (s.key === 'serverUrl' && value !== current.serverUrl && current.shareCookies) {
        // ההסכמה ניתנה לשרת הקודם
        current.shareCookies = false;
        delete current.shareCookiesServer;
        hint.textContent = t('כתובת השרת השתנתה, ולכן שיתוף העוגיות כובה.', 'The server address changed, so cookie sharing was turned off.');
      }
      current[s.key] = value;
      save();
      renderSettings();
    });
    return el('label', { class: 'opt col' }, text, input);
  }
  const box = el('input', { type: 'checkbox', checked: !!current[s.key] });
  box.addEventListener('change', () => {
    if (box.checked && s.confirm === 'cookies') {
      box.checked = false;
      return enableCookies(box);
    }
    current[s.key] = box.checked;
    save();
    if (s.confirm) renderSettings();
  });
  return el('label', { class: 'opt' }, text, box);
}

function renderSettings() {
  const kids = [];
  for (const g of SETTING_GROUPS) {
    const items = SETTINGS.filter(s => s.group === g.id);
    if (!items.length) continue;
    kids.push(el('h3', null, t(g.label, g.labelEn)));
    for (const s of items) {
      kids.push(settingRow(s));
      if (s.key === 'shareCookies' && current.shareCookies) kids.push(shareNowLine());
    }
    if (g.id === 'drive') kids.push(serverTestLine());
  }
  $('settings').replaceChildren(...kids);
}

chrome.storage.local.get('settings', r => {
  current = migrateSettings({ ...DEFAULTS, ...(r.settings || {}) });
  renderSettings();
});

// שינוי מדיאלוג ההגדרות שבדף בזמן שהחלון פתוח
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const next = migrateSettings({ ...DEFAULTS, ...(changes.settings.newValue || {}) });
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  // לא מציירים מחדש באמצע הקלדה או כשדיאלוג פתוח
  const busy = document.querySelector('.dlg-back') || (document.activeElement && document.activeElement.matches('input.text, select') && $('settings').contains(document.activeElement));
  if (!busy) renderSettings();
});
