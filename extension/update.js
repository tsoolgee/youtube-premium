// ---------- בדיקת עדכונים ----------
// התוסף מותקן מקובץ ZIP ולכן הוא לא מתעדכן לבד, וסקריפט טמפרמונקי מתעדכן רק כשהוא נזכר.
// כאן בודקים מול הגרסה שב-GitHub (הקובץ הגולמי, בלי מגבלת קצב של ה-API) ומראים שורה בהגדרות.
// הקובץ משותף לדף ולחלון התוסף, ולכן אין בו שום תלות ב-DOM או בהגדרות.

const UPDATE_MANIFEST = 'https://raw.githubusercontent.com/tsoolgee/youtube-premium/main/src/manifest.json';
const UPDATE_RELEASES = 'https://github.com/tsoolgee/youtube-premium/releases/latest';
const UPDATE_USERSCRIPT = 'https://raw.githubusercontent.com/tsoolgee/youtube-premium/main/userscript/youtube-premium.user.js';
const UPDATE_KEY = 'ytu-update';
const UPDATE_EVERY = 6 * 60 * 60 * 1000;  // בדיקה ברקע לכל היותר אחת לשש שעות
const UPDATE_MANUAL = 5 * 60 * 1000;      // פתיחת ההגדרות: בדיקה טרייה אם עברו חמש דקות

// "0.0.92" מול "0.0.9": משווים מספר מול מספר, לא מחרוזות
function updateNewer(latest, current) {
  const parts = v => String(v || '').split('.').map(n => parseInt(n, 10) || 0);
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function updateCached() {
  try { return JSON.parse(localStorage.getItem(UPDATE_KEY)) || null; } catch { return null; }
}

// force: בדיקה גם אם יש תשובה שמורה (כשפותחים את ההגדרות)
async function updateLatest(force) {
  const cached = updateCached();
  const age = cached ? Date.now() - (cached.at || 0) : Infinity;
  if (cached && age < (force ? UPDATE_MANUAL : UPDATE_EVERY)) return cached.version || null;
  try {
    const r = await fetch(UPDATE_MANIFEST, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw new Error(r.status);
    const version = String((await r.json()).version || '');
    if (!/^\d+(\.\d+)*$/.test(version)) throw new Error('bad version');
    try { localStorage.setItem(UPDATE_KEY, JSON.stringify({ version, at: Date.now() })); } catch {}
    return version;
  } catch {
    // אין רשת / הסינון חוסם – לא מציגים כלום, ולא נועלים את הבדיקה הבאה
    return cached ? cached.version || null : null;
  }
}

// kind: 'extension' – ההורדה מדף הרילייס; 'userscript' – הקובץ עצמו, שמנהל הסקריפטים מתקין
const updateLink = kind => (kind === 'userscript' ? UPDATE_USERSCRIPT : UPDATE_RELEASES);
