// חלון התוסף: פקודה ללשונית (הורדת הסרטון) והגדרות (אותו מודל כמו דיאלוג ההגדרות של הטמפרמונקי, עם מצייר משלו).
// ההורדה עצמה רצה כולה בדפדפן, בלשונית של יוטיוב – בלי שרת חיצוני.
const $ = id => document.getElementById(id);
const hint = $('hint');
$('version').textContent = 'v' + chrome.runtime.getManifest().version;

// שפה: עברית אם הדפדפן בעברית, אחרת אנגלית (עם labelEn/descEn מ-settings.js)
const HE = /^(he|iw)/i.test((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'he');
const t = (he, en) => (HE || !en ? he : en);
document.documentElement.lang = HE ? 'he' : 'en';
document.documentElement.dir = HE ? 'rtl' : 'ltr';
if (!HE) {
  document.title = 'YouTube Premium';
  $('hero-text').textContent = 'Everything works inside YouTube, in the usual places: the Download button, the player ⚙ menu and the playback speed menu.';
  $('download-text').textContent = 'Download this video';
  $('credit-text').textContent = 'Made by Tsool Gaeh · ';
}

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

// ---------- פקודות ללשונית ----------

// בלי הרשאת tabs: tab.url מגיע רק ללשוניות יוטיוב (host_permissions), ובשאר הלשוניות הוא ריק
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

// ---------- הגדרות ----------

let current = { ...DEFAULTS };
const save = () => chrome.storage.local.set({ settings: current });

function settingRow(s) {
  const desc = t(s.desc || '', s.descEn);
  const text = el('div', null, t(s.label, s.labelEn), desc ? el('small', null, desc) : null);
  if (s.type === 'select') {
    return el('label', { class: 'opt' }, text,
      el('select', { onchange: e => { current[s.key] = e.target.value; save(); } },
        (s.options || []).map(o => el('option', { value: o.value, selected: String(current[s.key]) === String(o.value) }, t(o.label, o.labelEn)))));
  }
  const box = el('input', { type: 'checkbox', checked: !!current[s.key] });
  box.addEventListener('change', () => {
    current[s.key] = box.checked;
    save();
  });
  return el('label', { class: 'opt' }, text, box);
}

function renderSettings() {
  const kids = [];
  for (const g of SETTING_GROUPS) {
    const items = SETTINGS.filter(s => s.group === g.id);
    if (!items.length) continue;
    kids.push(el('h3', null, t(g.label, g.labelEn)));
    for (const s of items) kids.push(settingRow(s));
  }
  $('settings').replaceChildren(...kids);
}

// רק מפתחות מוכרים – ערכים ישנים מגרסאות קודמות נופלים בשמירה הבאה
const withDefaults = saved => {
  const out = { ...DEFAULTS };
  const m = migrateSettings(saved);
  for (const k of Object.keys(DEFAULTS)) if (k in m) out[k] = m[k];
  return out;
};

chrome.storage.local.get('settings', r => {
  current = withDefaults(r.settings);
  renderSettings();
});

// שינוי מדיאלוג ההגדרות שבדף בזמן שהחלון פתוח
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const next = withDefaults(changes.settings.newValue);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  // לא מציירים מחדש כשרשימה נפתחה
  const busy = document.activeElement && document.activeElement.matches('select') && $('settings').contains(document.activeElement);
  if (!busy) renderSettings();
});
