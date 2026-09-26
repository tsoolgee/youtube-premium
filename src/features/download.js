// ---------- 6. הורדה ----------

// לקוח ה-visionOS מחזיר קישורים ישירים בלי חתימה מוצפנת ובלי PO token.
// כשההורדה מפסיקה לעבוד – קודם כל לבדוק מה yt-dlp משתמש בו היום (INNERTUBE_CLIENTS).
const CLIENT = {
  clientName: 'VISIONOS',
  clientVersion: '1.02',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.5.23O471',
  headerId: '101',
};
// חלקים קטנים: על חיבור מסונן (נטפרי) בקשות וידאו ארוכות נחתכות באקראי באמצע,
// ואז יש פחות מה לחזור עליו. RETRIES = ניסיונות רצופים *בלי* התקדמות.
// חלוקה מסתגלת: מתחילים גדול (פחות בקשות = מהר יותר), ומקטינים כשהחיבור חותך באמצע
// (נטפרי חותך בקשות גדולות באקראי). כשכמה חלקים עוברים נקי – מגדילים בחזרה.
const CHUNK_START = 8 * 1024 * 1024;
const CHUNK_MIN = 1024 * 1024;
const CHUNK_MAX = 16 * 1024 * 1024;
const CLEAN_TO_GROW = 4;   // חלקים רצופים בלי חיתוך לפני הגדלה
const LANES = 6;
const RETRIES = 8;

// לסרטון עם כמה פסי קול (הדיבוב האוטומטי של יוטיוב) יוטיוב מחזיר קבוצת פורמטים לכל שפה,
// והדיבוב עלול להיות בקצב גבוה יותר – ואז הורדנו אותו במקום המקור. בוחרים לפי הסדר של yt-dlp:
// פס שכתוב עליו "מקור"/"original", אחרת ברירת המחדל של יוטיוב, ורק בסוף הקצב הגבוה.
function dlPickAudio(list) {
  const best = arr => arr.slice().sort((a, b) => b.bitrate - a.bitrate)[0];
  const tracked = list.filter(f => f.audioTrack);
  if (!tracked.length) return best(list);
  const original = tracked.filter(f => /original|מקור/i.test(f.audioTrack.displayName || ''));
  if (original.length) return best(original);
  const def = tracked.filter(f => f.audioTrack.audioIsDefault);
  return best(def.length ? def : tracked);
}

// המקור של הדף, ואם אין כזה (about:blank וכדומה) – יוטיוב עצמו
const ytOrigin = () => (/(^|\.)youtube\.com$/.test(location.hostname) ? location.origin : 'https://www.youtube.com');

async function fetchStreams(id, signal) {
  const headers = {
    'content-type': 'application/json',
    'X-YouTube-Client-Name': CLIENT.headerId,
    'X-YouTube-Client-Version': CLIENT.clientVersion,
  };
  try {
    const visitor = window.ytcfg?.get?.('VISITOR_DATA');
    if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
  } catch {}
  const { headerId, ...client } = CLIENT;
  // הודעות השגיאה של יוטיוב (playabilityStatus.reason) בשפת הממשק
  const hl = typeof uiHebrew === 'function' && !uiHebrew() ? ((document.documentElement.lang || 'en').split('-')[0] || 'en') : 'he';
  const r = await fetch(ytOrigin() + '/youtubei/v1/player?prettyPrint=false', {
    method: 'POST', credentials: 'omit', headers, signal,
    body: JSON.stringify({ context: { client: { ...client, hl } }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
  });
  if (!r.ok) {
    const err = new Error(r.status === 418
      ? dlT(DL_ERRORS.BLOCKED_418[0], DL_ERRORS.BLOCKED_418[1])
      : dlT('יוטיוב החזיר שגיאה ', 'YouTube returned an error ') + r.status);
    // חסימה של הסינון (נטפרי ודומיו מחזירים 418) – מציגים את הסיבה מתחת ל"ההורדה נכשלה"
    if (r.status === 418) err.ytReason = true;
    throw err;
  }
  const data = await r.json();
  const status = data.playabilityStatus || {};
  if (status.status !== 'OK') {
    // הסיבה של יוטיוב (פרטי, מוגבל לפי גיל...) – מוצגת כהסבר קצר מתחת ל"ההורדה נכשלה"
    const err = new Error(status.reason || dlT('אי אפשר להוריד את הסרטון הזה (', "This video can't be downloaded (") + (status.status || dlT('לא ידוע', 'unknown')) + ')');
    if (status.reason) err.ytReason = true;
    throw err;
  }

  const formats = (data.streamingData?.adaptiveFormats || [])
    .filter(f => f.url && !f.isDrc && !/[?&]xtags=[^&]*drc/.test(f.url));
  const audio = dlPickAudio(formats.filter(f => f.mimeType.startsWith('audio/mp4')));

  const byLabel = new Map();
  for (const f of formats.filter(f => f.mimeType.startsWith('video/mp4'))) {
    const label = f.qualityLabel || f.height + 'p';
    const cur = byLabel.get(label);
    const avc = /avc1/.test(f.mimeType);
    // לכל איכות: H.264 עדיף (נפתח בכל נגן), ואחריו הקצב הגבוה
    if (!cur || (avc && !cur.avc) || (avc === cur.avc && f.bitrate > cur.f.bitrate)) byLabel.set(label, { f, avc });
  }
  const videos = [...byLabel.values()]
    .map(x => x.f)
    .sort((a, b) => b.height - a.height || (b.fps || 0) - (a.fps || 0));

  if (!audio) throw new Error(dlT('יוטיוב לא החזיר קישורים שאפשר להוריד לסרטון הזה', "YouTube didn't return downloadable links for this video"));
  return {
    id,
    title: data.videoDetails?.title || document.title.replace(/ - YouTube.*$/, ''),
    author: data.videoDetails?.author || '',
    length: +data.videoDetails?.lengthSeconds || 0,
    thumbs: data.videoDetails?.thumbnail?.thumbnails || [],
    audio, videos,
  };
}

async function fetchFile(format, onBytes, signal) {
  const total = +format.contentLength;
  if (!total) {
    const r = await fetch(format.url, { signal, credentials: 'omit' });
    if (!r.ok) throw new Error(dlT('ההורדה נכשלה (', 'Download failed (') + r.status + ')');
    const buf = new Uint8Array(await r.arrayBuffer());
    onBytes(buf.length);
    return buf;
  }
  let out;
  try { out = new Uint8Array(total); } catch {
    const err = new Error(dlT('הקובץ גדול מדי להורדה מהדפדפן', 'The file is too large to download in the browser'));
    err.tooLarge = true;
    throw err;
  }

  // הטווחים נחתכים תוך כדי, לפי הגודל הנוכחי
  let chunk = Math.min(CHUNK_START, Math.max(CHUNK_MIN, total));
  let cursor = 0, clean = 0;
  const nextRange = () => {
    if (cursor >= total) return null;
    const a = cursor;
    const b = Math.min(cursor + chunk, total) - 1;
    cursor = b + 1;
    return [a, b];
  };
  const shrink = () => { chunk = Math.max(CHUNK_MIN, Math.floor(chunk / 2)); clean = 0; };
  const grew = () => { if (++clean >= CLEAN_TO_GROW) { chunk = Math.min(CHUNK_MAX, chunk * 2); clean = 0; } };
  // תקלה סופית באחד החלקים עוצרת גם את השאר – בלי עוד בקשות שייכשלו (403 על קישור שפג וכו')
  const stop = new AbortController();
  let fatal = null;
  const onAbort = () => stop.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const worker = async () => {
    for (let range; !stop.signal.aborted && (range = nextRange());) {
      let [pos, end] = range, tries = 0, cut = false;
      while (pos <= end) {
        const before = pos;
        try {
          const r = await fetch(`${format.url}&range=${pos}-${end}`, { signal: stop.signal, credentials: 'omit', cache: 'no-store' });
          if (!r.ok) {
            const err = new Error(dlT('ההורדה נכשלה (', 'Download failed (') + r.status + ')');
            // 4xx לא מסתדר בניסיון חוזר (403 = הקישור פג / נחסם); 429 כן
            err.fatal = r.status >= 400 && r.status < 500 && r.status !== 429;
            err.expired = r.status === 403;
            if (r.status === 418) { err.message = dlT(DL_ERRORS.BLOCKED_418[0], DL_ERRORS.BLOCKED_418[1]); err.ytReason = true; }
            throw err;
          }
          const reader = r.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const n = Math.min(value.length, end - pos + 1);
            out.set(value.subarray(0, n), pos);
            pos += n;
            onBytes(n);
          }
          if (pos <= end) throw new Error(dlT('החיבור נקטע', 'The connection was interrupted'));
        } catch (e) {
          if (stop.signal.aborted) throw e;
          // כל עוד הבקשה הביאה בייטים חדשים – החיתוך לא "תקלה", רק המשך מכאן
          tries = pos > before ? 0 : tries + 1;
          if (e.fatal || tries > RETRIES) { fatal = fatal || e; stop.abort(); throw e; }
          if (!cut) { cut = true; shrink(); } // החיבור חותך – חלקים קטנים יותר מכאן
          await sleep(300 * tries);
        }
      }
      if (!cut) grew();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(LANES, Math.ceil(total / chunk))) }, worker));
  } catch (e) {
    throw signal.aborted ? e : fatal || e;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return out;
}

function saveFile(parts, name, type) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.documentElement.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

function pageTitle(id) {
  if (id && id !== videoId()) return '';
  try { const t = player()?.getVideoData?.()?.title; if (t) return t; } catch {}
  return document.title.replace(/ - YouTube.*$/, '').replace(/^\(\d+\)\s*/, '');
}

// ---------- הורדה בסגנון YouTube Premium ----------
// כפתור "הורדה" הרשמי / "הורדה" בתפריט ⋮ → דיאלוג "איכות ההורדה" (ytd-download-quality-selector-renderer).
// בזמן ההורדה: טוסט ההורדה של יוטיוב (ytd-video-download-toast-renderer: "יורד...", "יש להשאיר את החלון פתוח",
// X ופס התקדמות), והכפתור הרשמי מחליף אייקון ל-OFFLINE_DOWNLOADING (טבעת) ואת הטקסט ל"יורד".
// בסיום: "הורדת" + OFFLINE_PIN, והמצב נשמר לסרטון ב-localStorage (עד שמוחקים). לחיצה נוספת: "הסרה מההורדות".
// כמה הורדות: תור (כמו manualSessionTotalDownloads של יוטיוב) – "ההורדה מתבצעת... 2/1".
// כישלון: הכפתור עובר ל"ניסיון חוזר" (TRANSFER_STATE_FAILED / ACTION_RETRY).
// www: דף "הורדות" (/feed/downloads, FEdownloads) – יוטיוב מצייר אותו בעצמו; אנחנו רק ממלאים את הרשימה.
// ההורדה כולה בדפדפן (VISIONOS → fetch בטווחים → Mux / MP3), בלי שום שרת חיצוני.

// סולם האיכויות של Premium בדסקטופ (השמות מגיעים מהשרת; "שמע בלבד" נשאר אחרון – יש אותו רק אצלנו)
const DL_CHOICES = [
  { value: '1080', he: 'Full HD (1080p)', en: 'Full HD (1080p)', height: 1080 },
  { value: '720', he: 'גבוהה (720p)', en: 'High (720p)', height: 720 },
  { value: '360', he: 'בינונית (360p)', en: 'Medium (360p)', height: 360 },
  { value: '144', he: 'נמוכה (144p)', en: 'Low (144p)', height: 144 },
  { value: 'audio', he: 'שמע בלבד', en: 'Audio only', height: 0 },
  { value: 'mp3', he: 'שמע בלבד (MP3)', en: 'Audio only (MP3)', height: 0, mp3: true },
];
// ערכים מגרסה 2.1.0 (גבוהה 1080 / בינונית 720 / נמוכה 360)
const DL_LEGACY_CHOICE = { high: '1080', medium: '720', low: '360' };
const dlIsAudio = c => c === 'audio' || c === 'mp3';
const dlNormChoice = v => {
  const x = DL_LEGACY_CHOICE[v] || String(v == null ? '' : v);
  if (DL_CHOICES.some(c => c.value === x)) return x;
  // גם איכות שלא בסולם של Premium (144…2160) – הדיאלוג מציג את כל מה שיוטיוב מציע
  return /^\d{2,4}$/.test(x) && +x >= 100 && +x <= 4320 ? x : null;
};

// כל האפשרויות שיש לסרטון הזה: גובה לכל איכות שיוטיוב מציע + שמע (M4A ו-MP3).
// השמות של הפריסטים נשארים כמו אצל Premium; השאר "1080p60" וכו'.
function dlChoices(info) {
  if (!info || !info.videos || !info.videos.length) return DL_CHOICES;
  const seen = new Map();
  for (const v of info.videos) {
    if (!v.height || seen.has(v.height)) continue;
    const preset = DL_CHOICES.find(c => c.height === v.height);
    const fps = v.fps > 30 ? String(Math.round(v.fps)) : '';
    // ב-1440p/4K יוטיוב נותן רק AV1 – נגן Windows בלי התוסף של AV1 מנגן רק שמע, אז מסמנים
    const av1 = !info.videos.some(x => x.height === v.height && /avc1/.test(x.mimeType || ''));
    if (av1 && S.h264Only !== false) continue; // "רק H.264" (ברירת מחדל): קובץ שנפתח בכל נגן
    const tag = av1 ? ' (AV1)' : '';
    const label = preset ? null : v.height + 'p' + fps + tag;
    seen.set(v.height, preset
      ? { ...preset, he: preset.he + tag, en: preset.en + tag }
      : { value: String(v.height), he: label, en: label, height: v.height });
  }
  const videos = [...seen.values()].sort((a, b) => b.height - a.height);
  return [...videos, ...DL_CHOICES.filter(c => !c.height)];
}
const DL_CHOICE_KEY = 'ytu-dl-choice';
const DL_DONE_KEY = 'ytu-dl-done';
const dlT = (he, en) => (typeof uiText === 'function' ? uiText(he, en) : he);

// הטקסטים של יוטיוב עצמו (yt.msgs_ / ytcfg MSGS) בשפת הממשק, עם גיבוי
function ytMsg(key, he, en) {
  try {
    const m = (window.yt && window.yt.msgs_) || (window.ytcfg && typeof window.ytcfg.get === 'function' && window.ytcfg.get('MSGS'));
    const v = m && m[key];
    if (typeof v === 'string' && v) return v;
  } catch {}
  return dlT(he, en);
}
const MSG = {
  downloading: () => ytMsg('DOWNLOADING', 'יורד', 'Downloading'),
  downloaded: () => ytMsg('DOWNLOADED', 'הורדת', 'Downloaded'),
  keepOpen: () => ytMsg('KEEP_OPEN', 'יש להשאיר את החלון פתוח כדי להמשיך', 'Keep this window open to continue'),
  view: () => ytMsg('VIEW_DOWNLOADS', 'לצפייה בסרטון', 'View'),
  quality: () => ytMsg('DOWNLOAD_QUALITY', 'איכות ההורדה', 'Download Quality'),
  remember: () => ytMsg('REMEMBER_MY_SETTINGS', 'שמירת ההגדרות שלי', 'Remember my settings'),
  cancel: () => ytMsg('CANCEL', ytMsg('SBOX_INAPPROPRIATE_CANCEL', 'ביטול', 'Cancel')),
  download: () => ytMsg('DOWNLOAD', 'הורדה', 'Download'),
  // טוסט הכישלון של יוטיוב (onOfflineOperationFailure): רק "ההורדה נכשלה" / "האחסון מלא"
  failed: () => ytMsg('TRANSFER_FAILED', 'ההורדה נכשלה', 'Download failed'),
  storageFull: () => ytMsg('STORAGE_FULL', 'האחסון מלא', 'Storage full'),
  preparing: () => ytMsg('PREPARING_TO_DOWNLOAD', 'הכנות אחרונות להורדה...', 'Preparing to download...'),
  waiting: () => ytMsg('WAITING_TO_DOWNLOAD', 'בהמתנה להורדה...', 'Waiting to download...'),
  percent: n => ytMsg('DOWNLOADING_PERCENT', 'רגע, תכף נסיים להוריד... $percent%', 'Downloading... $percent%').replace('$percent', String(n)),
  deleted: () => ytMsg('DELETED_VIDEO', 'הסרטון נמחק מההורדות.', 'Video deleted from downloads.'),
  undo: () => ytMsg('UNDO_ACTION', 'ביטול', 'Undo'),
  // "ההורדה מתבצעת... $total/$downloaded" – כך במחרוזת של יוטיוב בעברית
  ratio: (done, total) => ytMsg('VIDEOS_DOWNLOADING_RATIO', 'ההורדה מתבצעת... $total/$downloaded', 'Downloading... $downloaded/$total')
    .replace('$downloaded', String(done)).replace('$total', String(total)),
  retry: () => ytMsg('RETRY', 'ניסיון חוזר', 'Retry'),
  downloads: () => ytMsg('DOWNLOADS', 'הורדות', 'Downloads'),
  yourDownloads: () => ytMsg('YOUR_DOWNLOADS', 'ההורדות שלך', 'Your downloads'),
  removeTitle: () => ytMsg('DELETE_FROM_DOWNLOADS', 'הסרה מההורדות', 'Remove from downloads'),
  delete: () => ytMsg('DELETE', 'מחיקה', 'Delete'),
};

let dlBusy = null;      // הורדה שרצה עכשיו: { id, choice, abort, percent, preparing, converting? }
const dlQueue = [];     // הורדות שמחכות: [{ id, choice }]
const dlSession = { total: 0, done: 0 }; // כמו manualSessionTotalDownloads / manualSessionDownloaded
let dlToast = null, dlToastClosed = false, dlToastHold = 0;
const dlFailed = new Map();     // id → הבחירה האחרונה (הכפתור מציג "ניסיון חוזר")
let dlDialog = null;    // { id, close, back }
const dlInfo = new Map();       // id → Promise<info> (רשימת הפורמטים, לגדלים בדיאלוג ולהורדה)

const isDownloadBusy = () => !!dlBusy || dlQueue.length > 0;
const dlIsQueued = id => dlQueue.some(q => q.id === id);
const isDownloadViewOpen = id => !!(dlDialog && dlDialog.back.isConnected && (!id || dlDialog.id === id));

function closeDownloadDialog() {
  if (dlDialog) dlDialog.close(false);
  dlDialog = null;
}

function dlLastChoice() {
  try { return dlNormChoice(localStorage.getItem(DL_CHOICE_KEY)); } catch { return null; }
}

// סרטונים שהורדו (הכפתור נשאר "הורדת" כמו ב-Premium עד שמוחקים; משמש גם לדף "הורדות").
// localStorage: [{ id, title, author, length, at }] – משותף לכל הלשוניות, והאירוע storage מעדכן את האחרות.
const DL_DONE_MAX = 200;
function dlDoneList() {
  try {
    const a = JSON.parse(localStorage.getItem(DL_DONE_KEY) || '[]');
    if (!Array.isArray(a)) return [];
    return a.map(x => (typeof x === 'string' ? { id: x } : x)).filter(x => x && /^[\w-]{11}$/.test(x.id || ''));
  } catch { return []; }
}
const dlIsDone = id => !!id && dlDoneList().some(x => x.id === id);
function dlSetDone(id, done, meta) {
  const list = dlDoneList().filter(x => x.id !== id);
  if (done) {
    const m = meta || {};
    list.push({ id, title: String(m.title || '').slice(0, 300), author: String(m.author || '').slice(0, 120), length: +m.length || 0, at: Date.now() });
  }
  try { localStorage.setItem(DL_DONE_KEY, JSON.stringify(list.slice(-DL_DONE_MAX))); } catch {}
  refreshDownloadButtons();
}
window.addEventListener('storage', e => {
  if (e.key !== DL_DONE_KEY) return;
  try { refreshDownloadButtons(); } catch {}
});

// פרטי הסרטון לרשימת ההורדות: מהתשובה של יוטיוב, ואם אין – מהנגן
function dlMeta(id, info) {
  const m = { title: (info && info.title) || pageTitle(id), author: (info && info.author) || '', length: (info && info.length) || 0 };
  if (id === videoId()) {
    try {
      const p = player();
      const d = p && p.getVideoData && p.getVideoData();
      if (!m.author && d && d.author) m.author = d.author;
      if (!m.length && p && p.getDuration) m.length = Math.round(+p.getDuration() || 0);
    } catch {}
  }
  return m;
}

// הפרטים שכבר נטענו לסרטון (בלי await) – מה שההורדה עצמה קראה
const dlInfoReady = new Map();
const dlInfoNow = id => dlInfoReady.get(id) || null;

function dlGetInfo(id) {
  let p = dlInfo.get(id);
  if (!p) {
    p = fetchStreams(id);
    dlInfo.set(id, p);
    p.then(info => { if (dlInfo.get(id) === p) dlInfoReady.set(id, info); }, () => {});
    // תקלה לא נשמרת, וקישורי ההורדה פגים אחרי כמה שעות
    p.catch(() => { if (dlInfo.get(id) === p) dlInfo.delete(id); });
    setTimeout(() => { if (dlInfo.get(id) === p) { dlInfo.delete(id); dlInfoReady.delete(id); } }, 60 * 60 * 1000);
  }
  return p;
}

// הפורמט לבחירה: הכי גבוה עד הגובה המבוקש; אם אין – הכי נמוך שיש
function dlPickVideo(info, choice) {
  const norm = dlNormChoice(choice);
  const c = DL_CHOICES.find(x => x.value === norm)
    || (/^\d+$/.test(String(norm)) ? { height: +norm } : null);
  if (!c || !c.height || !info.videos.length) return null;
  const avc = f => (/avc1/.test(f.mimeType) ? 1 : 0);
  let list = [...info.videos].sort((a, b) => b.height - a.height || avc(b) - avc(a));
  if (S.h264Only !== false && list.some(avc)) list = list.filter(avc);
  return list.find(v => v.height <= c.height) || list[list.length - 1];
}

// הגודל המשוער בצד ימין של השורה (approximateSize)
function dlSizeText(info, choice) {
  const size = f => +(f && f.contentLength) || 0;
  if (dlIsAudio(choice)) return size(info.audio) ? mb(size(info.audio)) : '';
  const v = dlPickVideo(info, choice);
  if (!v) return '';
  const n = size(v) + size(info.audio);
  return n ? mb(n) : '';
}

// ---------- טוסטים ----------

// הודעה קצרה (toast של יוטיוב). נשאר לשימוש כללי
function dlSnack(text, action, ms) {
  return ytToast({ text, action, ms });
}

// "לצפייה בסרטון" (VIEW_DOWNLOADS) → דף "הורדות", כמו GE4 של יוטיוב. יש דף כזה רק ב-www
function dlViewAction() {
  return SITE === 'www' ? { label: MSG.view(), run: openDownloadsPage } : null;
}

// טוסט ההורדה (ytd-video-download-toast-renderer): נשאר פתוח עד הסוף, עם "לצפייה בסרטון", X ופס התקדמות.
// המשתמש יכול לסגור ב-X – ההורדות ממשיכות, והטוסט לא חוזר עד סוף הסשן
function dlShowProgress(busy) {
  if (!busy || dlBusy !== busy || dlToastClosed) return;
  const total = dlSession.total;
  const opts = {
    // כמו ytd-video-download-toast-renderer: רק "יורד..." או היחס, ו-KEEP_OPEN (ההכנה נראית רק בטבעת שבכפתור)
    text: total > 1 ? MSG.ratio(Math.min(total, dlSession.done + 1), total) : MSG.downloading() + '...',
    sub: MSG.keepOpen(),
    action: dlViewAction(),
    close: true,
    onClose: () => { dlToastClosed = true; },
    progress: busy.percent || 0,
    ms: 0,
  };
  if (dlToast && dlToast.update(opts)) return;
  // הודעת שגיאה של הורדה קודמת בתור – נותנים לקרוא אותה לפני שטוסט ההתקדמות חוזר
  if (Date.now() < dlToastHold) return;
  dlToast = ytToast(opts);
}

// ---------- יציאה מהדף באמצע הורדה / כשיש תור (כמו boundBeforeUnload של יוטיוב) ----------

const dlWantsUnloadGuard = () => !!(dlBusy || dlQueue.length);
function dlBeforeUnload(e) {
  if (!dlWantsUnloadGuard()) return;
  e.preventDefault();
  e.returnValue = true;
}
function dlUpdateUnload() {
  if (dlWantsUnloadGuard()) window.addEventListener('beforeunload', dlBeforeUnload);
  else window.removeEventListener('beforeunload', dlBeforeUnload);
}

// ---------- הכפתור הרשמי: אייקון OFFLINE_DOWNLOADING / OFFLINE_PIN וטקסט "יורד" / "הורדת" ----------

const DL_BTN_ATTR = 'data-ytu-dl';
const DL_BTN_CSS_ID = 'ytu-dl-button-css';
const DL_MWEB_ATTR = 'data-ytu-mweb-dl';
const DL_BUTTON_SEL = `ytd-watch-metadata ytd-download-button-renderer button, ytm-download-button-renderer button, ytm-offline-button-renderer button, ytmusic-download-button-renderer button, button[${DL_MWEB_ATTR}]`;
const DL_ICON_SLOT = '.ytSpecButtonShapeNextIcon, .yt-spec-button-shape-next__icon, yt-icon';
const DL_TEXT_SLOT = '.ytSpecButtonShapeNextButtonTextContent, .yt-spec-button-shape-next__button-text-content';
// OFFLINE_PIN: עם אייקוני Delhi (enable_web_delhi_icons, ברירת המחדל היום) יוטיוב מצייר arrow_down_circle (youtube_fill, evenodd)
const OFFLINE_PIN_PATH = 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm5 16H7v-2h10v2zm-6.7-4L7 10.7l1.4-1.4 1.9 1.9 5.3-5.3L17 7.3 10.3 14z';
const ARROW_DOWN_CIRCLE_PATH = 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM11 6v9.086l-3.793-3.793-1.414 1.414L12 18.914l6.207-6.207-1.414-1.414L13 15.086V6h-2Z';
// OFFLINE_DOWNLOADING_*: חץ בקו 2 עם קצוות עגולים (youtube_fill/offline_downloading_zero/v2)
const DL_ARROW_PATH = 'M12 17l4.5-4.5M12 17l-4.5-4.5M12 17V7';
// אייקוני התפריט (yt-icons של יוטיוב, נקראו מהדף 16/09/2026)
const DELETE_PATH = 'M19 3h-4V2a1 1 0 00-1-1h-4a1 1 0 00-1 1v1H5a2 2 0 00-2 2h18a2 2 0 00-2-2ZM6 19V7H4v12a4 4 0 004 4h8a4 4 0 004-4V7h-2v12a2 2 0 01-2 2H8a2 2 0 01-2-2Zm4-11a1 1 0 00-1 1v8a1 1 0 102 0V9a1 1 0 00-1-1Zm4 0a1 1 0 00-1 1v8a1 1 0 002 0V9a1 1 0 00-1-1Z';
const dlDelhi = () => {
  try { return !!(window.ytcfg && window.ytcfg.get('EXPERIMENT_FLAGS') || {}).enable_web_delhi_icons; } catch { return false; }
};

function dlEnsureButtonCss() {
  if (document.getElementById(DL_BTN_CSS_ID)) return;
  const style = document.createElement('style');
  style.id = DL_BTN_CSS_ID;
  // צבעי הטבעת מה-CSS של יוטיוב: path.offline-downloading-background (החץ והקשת) ו-progress (המסלול), בהיר/כהה
  // ערכה כהה: html[dark] ב-www, ytmusic-app, ו-data-ytu-dark על הכפתור (m.youtube לא מסמן html[dark])
  // העטיפה inline-flex + vertical-align: middle כמו span.ytIconWrapperHost – אחרת קו הבסיס של הכפתור זז והשורה קופצת
  style.textContent = `
button[${DL_BTN_ATTR}="progress"] :is(${DL_ICON_SLOT}) > :not(.ytu-dl-icon),
button[${DL_BTN_ATTR}="done"] :is(${DL_ICON_SLOT}) > :not(.ytu-dl-icon) { display: none !important; }
.ytu-dl-icon { display: inline-flex; vertical-align: middle; width: 24px; height: 24px; flex: none; }
.ytu-dl-icon svg { display: block; width: 100%; height: 100%; }
.ytu-dl-icon :is(circle, .ytu-dl-arrow) { fill: none; stroke-width: 2; stroke-linecap: round; }
.ytu-dl-icon :is(.ytu-dl-fg, .ytu-dl-arrow) { stroke: #065fd4; }
.ytu-dl-icon .ytu-dl-bg { stroke: #3ea6ff; }
.ytu-dl-icon[data-level="0"] .ytu-dl-bg { stroke: #065fd4; opacity: .3; }
.ytu-dl-icon .ytu-dl-fg { transform: rotate(-90deg); transform-origin: 12px 12px; }
html[dark] .ytu-dl-icon :is(.ytu-dl-fg, .ytu-dl-arrow), ytmusic-app .ytu-dl-icon :is(.ytu-dl-fg, .ytu-dl-arrow), [data-ytu-dark] .ytu-dl-icon :is(.ytu-dl-fg, .ytu-dl-arrow) { stroke: #3ea6ff; }
html[dark] .ytu-dl-icon .ytu-dl-bg, ytmusic-app .ytu-dl-icon .ytu-dl-bg, [data-ytu-dark] .ytu-dl-icon .ytu-dl-bg { stroke: #065fd4; }
html[dark] .ytu-dl-icon[data-level="0"] .ytu-dl-bg, ytmusic-app .ytu-dl-icon[data-level="0"] .ytu-dl-bg, [data-ytu-dark] .ytu-dl-icon[data-level="0"] .ytu-dl-bg { stroke: #3ea6ff; }
.ytu-dl-icon .ytu-dl-pin { fill: currentColor; }
`;
  (document.head || document.documentElement).append(style);
}

function dlSvg(kids) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of kids) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    s.append(el);
  }
  return s;
}

// המדרגות של updateProgress ב-ytd-download-button-renderer: עד 10% ZERO, עד 30% TWENTY, 50 FORTY, 70 SIXTY, אחרת EIGHTY
function dlProgressLevel(percent) {
  const p = (+percent || 0) / 100;
  return p <= 0.1 ? 0 : p <= 0.3 ? 20 : p <= 0.5 ? 40 : p <= 0.7 ? 60 : 80;
}

function dlIcon(state, level) {
  let svg;
  if (state === 'done') {
    svg = dlDelhi()
      ? dlSvg([['path', { class: 'ytu-dl-pin', d: ARROW_DOWN_CIRCLE_PATH, 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' }]])
      : dlSvg([['path', { class: 'ytu-dl-pin', d: OFFLINE_PIN_PATH }]]);
  } else {
    // ZERO: טבעת אחת בשקיפות .3; שאר המדרגות: מסלול מלא וקשת מלמעלה עם כיוון השעון
    const kids = [['circle', { class: 'ytu-dl-bg', cx: '12', cy: '12', r: '10' }]];
    if (level) kids.push(['circle', { class: 'ytu-dl-fg', cx: '12', cy: '12', r: '10', pathLength: '100', 'stroke-dasharray': level + ' 100' }]);
    kids.push(['path', { class: 'ytu-dl-arrow', d: DL_ARROW_PATH }]);
    svg = dlSvg(kids);
  }
  const wrap = document.createElement('span');
  wrap.className = 'ytu-dl-icon';
  wrap.setAttribute('data-state', state);
  if (state !== 'done') wrap.setAttribute('data-level', String(level || 0));
  wrap.append(svg);
  return wrap;
}

function dlButtonState(id) {
  if (!id) return null;
  if (dlBusy && dlBusy.id === id) return { state: 'progress', percent: dlBusy.percent };
  if (dlIsQueued(id)) return { state: 'progress', percent: 0 }; // TRANSFER_STATE_TRANSFER_IN_QUEUE
  if (dlIsDone(id)) return { state: 'done' };
  if (dlFailed.has(id)) return { state: 'failed' };            // TRANSFER_STATE_FAILED → "ניסיון חוזר"
  return null;
}

// ה-tooltip של הכפתור (tp-yt-paper-tooltip #tooltip בתוך ytd-download-button-renderer)
const dlTooltip = b => {
  const r = b.closest('ytd-download-button-renderer');
  return r && r.querySelector('tp-yt-paper-tooltip #tooltip');
};

function dlResetButton(b) {
  b.removeAttribute(DL_BTN_ATTR);
  b.removeAttribute('data-ytu-dark');
  for (const icon of b.querySelectorAll('.ytu-dl-icon')) icon.remove();
  if (b.hasAttribute('data-ytu-tip')) {
    const tip = dlTooltip(b);
    if (tip) tip.textContent = b.getAttribute('data-ytu-tip');
    b.removeAttribute('data-ytu-tip');
  }
  if (b.hasAttribute('data-ytu-text')) {
    const txt = b.querySelector(DL_TEXT_SLOT);
    if (txt) txt.textContent = b.getAttribute('data-ytu-text');
    b.removeAttribute('data-ytu-text');
  }
  if (b.hasAttribute('data-ytu-label')) {
    b.setAttribute('aria-label', b.getAttribute('data-ytu-label'));
    b.removeAttribute('data-ytu-label');
  }
  const r = b.closest('ytd-download-button-renderer');
  if (r) r.removeAttribute('is-download-complete');
}

function dlPaintButton(b, st) {
  const value = st.state === 'done' ? 'done' : st.state === 'failed' ? 'failed' : 'progress';
  let icon = b.querySelector('.ytu-dl-icon');
  const level = value === 'progress' ? String(dlProgressLevel(st.percent)) : null;
  if (value === 'failed') {
    // אייקון ההורדה המקורי (OFFLINE_DOWNLOAD), רק הטקסט משתנה
    if (icon) icon.remove();
  } else if (!icon || icon.getAttribute('data-state') !== value || icon.getAttribute('data-level') !== level) {
    if (icon) icon.remove();
    icon = dlIcon(value, +level);
    const slot = b.querySelector(DL_ICON_SLOT);
    if (slot) slot.append(icon); else b.prepend(icon);
  }
  if (b.getAttribute(DL_BTN_ATTR) !== value) b.setAttribute(DL_BTN_ATTR, value);
  const dark = typeof ytDark === 'function' && ytDark();
  if (b.hasAttribute('data-ytu-dark') !== dark) b.toggleAttribute('data-ytu-dark', dark);
  const label = value === 'done' ? MSG.downloaded() : value === 'failed' ? MSG.retry() : MSG.downloading();
  // כפתור עם טקסט ("הורדה") – הטקסט מתחלף; תמיד גם aria-label וה-tooltip (כמו data.tooltip של יוטיוב)
  const txt = b.querySelector(DL_TEXT_SLOT);
  if (txt && (txt.textContent.trim() || b.hasAttribute('data-ytu-text'))) {
    if (!b.hasAttribute('data-ytu-text')) b.setAttribute('data-ytu-text', txt.textContent);
    if (txt.textContent !== label) txt.textContent = label;
  }
  if (!b.hasAttribute('data-ytu-label')) b.setAttribute('data-ytu-label', b.getAttribute('aria-label') || '');
  if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
  const tip = dlTooltip(b);
  if (tip) {
    if (!b.hasAttribute('data-ytu-tip')) b.setAttribute('data-ytu-tip', tip.textContent);
    if (tip.textContent !== label) tip.textContent = label;
  }
  const r = b.closest('ytd-download-button-renderer');
  if (r) r.toggleAttribute('is-download-complete', value === 'done');
}

// ---------- "הורדה" בתפריטים (⋮ בדף הצפייה/בכרטיסים, גיליון "עוד" במובייל) ----------
// כמו onTransferStateChange של ytd-menu-service-item-download-renderer / yt-download-list-item-view-model:
// הורד / בתור / יורד → "הסרה מההורדות" עם אייקון DELETE (ACTION_REMOVE); נכשל → "ניסיון חוזר"
const DL_MENU_ITEM_ATTR = 'data-ytu-mweb-dl-item';
const DL_MENU_SEL = `ytd-menu-service-item-download-renderer, ytm-menu-service-item-download-renderer, ytmusic-menu-service-item-download-renderer, yt-download-list-item-view-model, [${DL_MENU_ITEM_ATTR}]`;
const dlMenuIds = new WeakMap(); // רכיב → { data, id } (החיפוש בנתונים יקר, והרכיב ממוחזר בין תפריטים)

function dlMenuItemId(el) {
  // הפריט שהוספנו בעצמנו: הסרטון שלו נשמר ביצירה (בתפריט של סרטון ברשימה – לא הסרטון שמתנגן)
  if (el.hasAttribute(DL_MENU_ITEM_ATTR)) return el.getAttribute('data-ytu-video') || videoId();
  const host = el.querySelector('yt-list-item-view-model') || el;
  let data = null;
  try { data = el.data || host.data || (el.__data && el.__data.data) || null; } catch {}
  const hit = dlMenuIds.get(el);
  if (hit && hit.data === data) return hit.id;
  const id = typeof dataVideoId === 'function' ? dataVideoId(el) || (host !== el ? dataVideoId(host) : null) : null;
  dlMenuIds.set(el, { data, id });
  return id;
}

function dlPaintMenuItem(el, st) {
  const title = el.querySelector('.ytListItemViewModelTitle, yt-formatted-string.title, .menu-item-text, yt-formatted-string');
  const path = el.querySelector('svg path');
  const want = !st ? null
    : st.state === 'failed' ? { text: MSG.retry(), d: null }
      : { text: MSG.removeTitle(), d: DELETE_PATH };
  if (!want) {
    if (el.hasAttribute('data-ytu-text')) {
      if (title) title.textContent = el.getAttribute('data-ytu-text');
      el.removeAttribute('data-ytu-text');
    }
    if (el.hasAttribute('data-ytu-icon')) {
      if (path) path.setAttribute('d', el.getAttribute('data-ytu-icon'));
      el.removeAttribute('data-ytu-icon');
    }
    return;
  }
  if (title) {
    if (!el.hasAttribute('data-ytu-text')) el.setAttribute('data-ytu-text', title.textContent);
    if (title.textContent !== want.text) title.textContent = want.text;
  }
  if (path) {
    const orig = el.getAttribute('data-ytu-icon') || path.getAttribute('d') || '';
    const d = want.d || orig;
    if (!el.hasAttribute('data-ytu-icon')) el.setAttribute('data-ytu-icon', orig);
    if (path.getAttribute('d') !== d) path.setAttribute('d', d);
  }
}

// נקרא גם מה-tick: יוטיוב מצייר את הכפתור מחדש במעבר בין סרטונים
function refreshDownloadButtons() {
  try { syncDownloadsPage(); } catch {}
  const st = dlButtonState(videoId());
  for (const b of document.querySelectorAll(`button[${DL_BTN_ATTR}]`)) {
    if (!st || !b.matches(DL_BUTTON_SEL)) dlResetButton(b);
  }
  for (const el of document.querySelectorAll(DL_MENU_SEL)) {
    try { dlPaintMenuItem(el, dlButtonState(dlMenuItemId(el))); } catch {}
  }
  if (!st) return;
  dlEnsureButtonCss();
  for (const b of document.querySelectorAll(DL_BUTTON_SEL)) dlPaintButton(b, st);
}

// ---------- דף "הורדות" (www) ----------
// יוטיוב מצייר את /feed/downloads בעצמו מתשובה מקומית (iXA ב-kevlar_base, בלי בקשה לשרת):
// כותרת "הורדות", "הגדרות", ו-ytd-rich-grid-renderer עם RICH_GRID_ENTITY_SELECTOR_TYPE_DOWNLOADS
// (ריק: backgroundPromoRenderer "הסרטונים שהורדת יופיעו כאן"). כמו Bn4/X3M, ממלאים את הגריד במדף
// "ההורדות שלך" עם videoRenderer לכל סרטון – והרכיבים של יוטיוב מציירים אותו (נבדק 16/09/2026).

const DL_PAGE_PATH = '/feed/downloads';
const DL_PAGE_ENDPOINT = () => ({
  commandMetadata: { webCommandMetadata: { url: DL_PAGE_PATH, webPageType: 'WEB_PAGE_TYPE_BROWSE', rootVe: 42352, apiUrl: '/youtubei/v1/browse' } },
  browseEndpoint: { browseId: 'FEdownloads' },
});
const dlPageOn = () => SITE === 'www' && !!S.download && S.hookOfficialButton !== false;

function openDownloadsPage() {
  const app = document.querySelector('ytd-app');
  try {
    if (app && typeof app.resolveCommand === 'function') { app.resolveCommand(DL_PAGE_ENDPOINT()); return; }
  } catch {}
  location.assign(DL_PAGE_PATH);
}

const dlDuration = s => {
  s = Math.max(0, Math.round(+s || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
// VIDEO_COUNT של יוטיוב ({case1, other: "# סרטונים"}), עם גיבוי
function dlCountText(n) {
  try {
    const m = (window.yt && window.yt.msgs_) || (window.ytcfg && window.ytcfg.get('MSGS'));
    const v = m && m.VIDEO_COUNT;
    if (v && typeof v === 'object') {
      const t = n === 1 && v.case1 ? v.case1 : v.other;
      if (typeof t === 'string' && t) return t.replace('#', String(n));
    }
  } catch {}
  return n === 1 ? dlT('סרטון אחד', '1 video') : dlT(n + ' סרטונים', n + ' videos');
}

// x.state: undefined (הורד) / 'progress' (x.percent, x.preparing) / 'queued' – כמו EPA ב-kevlar_base
function dlPageItem(x) {
  const title = x.title || x.id;
  const item = {
    videoId: x.id,
    title: { runs: [{ text: title }], accessibility: { accessibilityData: { label: title } } },
    thumbnail: { thumbnails: [
      { url: `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`, width: 320, height: 180 },
      { url: `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`, width: 480, height: 360 },
    ] },
    // "הסרה מההורדות" עם ACTION_REMOVE – מחיקה מיד וטוסט "ביטול" (official-button.js מיירט)
    menu: { menuRenderer: {
      items: [{ menuServiceItemRenderer: {
        text: { runs: [{ text: MSG.removeTitle() }] }, icon: { iconType: 'DELETE' },
        serviceEndpoint: { offlineVideoEndpoint: { videoId: x.id, action: 'ACTION_REMOVE' } },
      } }],
      accessibility: { accessibilityData: { label: ytMsg('VIDEO_ACTION_MENU', 'תפריט פעולות', 'Action menu') } },
    } },
  };
  if (x.author) item.shortBylineText = { runs: [{ text: x.author }] };
  if (x.state) {
    // בהורדה / בתור: שורת מצב במקום הצפיות, שכבת "יורד" על התמונה, ובלי מעבר לצפייה
    const text = x.state === 'queued' ? MSG.waiting() : x.preparing ? MSG.preparing() : MSG.percent(Math.floor(+x.percent || 0));
    item.shortViewCountText = { runs: [{ text }] };
    item.thumbnailOverlays = [{ thumbnailOverlayDownloadingRenderer: { state: 'THUMBNAIL_OVERLAY_DOWNLOADING_RENDERER_STATE_DOWNLOADING' } }];
    return { richItemRenderer: { content: { videoRenderer: item }, entitySelectorType: 'RICH_ITEM_ENTITY_SELECTOR_TYPE_VIDEO' } };
  }
  item.navigationEndpoint = {
    commandMetadata: { webCommandMetadata: { url: '/watch?v=' + x.id, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
    watchEndpoint: { videoId: x.id },
  };
  if (x.length) item.thumbnailOverlays = [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: dlDuration(x.length) }, style: 'DEFAULT' } }];
  return { richItemRenderer: { content: { videoRenderer: item }, entitySelectorType: 'RICH_ITEM_ENTITY_SELECTOR_TYPE_VIDEO' } };
}

function syncDownloadsPage() {
  if (SITE !== 'www' || location.pathname !== DL_PAGE_PATH) return;
  const browse = document.querySelector('ytd-browse:not([hidden])');
  const grid = browse && browse.querySelector('ytd-rich-grid-renderer');
  const data = grid && grid.data;
  if (!data || typeof data !== 'object' || data.entitySelectorType !== 'RICH_GRID_ENTITY_SELECTOR_TYPE_DOWNLOADS') return;
  const mine = !!grid.__ytuDlData && data === grid.__ytuDlData;
  // השמה ראשונה בזמן שהגריד עוד מצייר את עצמו לפעמים לא מתעדכנת (נבדק) – אז משימים עותק שוב
  if (mine && grid.__ytuDlSig) {
    const sec = grid.querySelector('ytd-rich-section-renderer');
    const shown = sec && sec.data && sec.data.content;
    if (shown && !shown.richShelfRenderer) { grid.__ytuDlData = { ...data }; grid.data = grid.__ytuDlData; return; }
  }
  // מנוי Premium אמיתי: יש כבר הורדות של יוטיוב – לא נוגעים
  if (!mine && (data.contents || []).some(c => !(c && c.richSectionRenderer && c.richSectionRenderer.content && c.richSectionRenderer.content.backgroundPromoRenderer))) return;
  // קודם מה שבהורדה ובתור (כמו רשימת ה-manual entities של יוטיוב), אחר כך מה שהורד – החדש למעלה
  const list = [];
  if (dlPageOn()) {
    if (dlBusy) list.push({ id: dlBusy.id, ...(dlBusy.meta || {}), state: 'progress', percent: dlBusy.percent, preparing: dlBusy.preparing });
    for (const q of dlQueue) list.push({ id: q.id, ...(q.meta || {}), state: 'queued' });
    const busyIds = new Set(list.map(x => x.id));
    list.push(...dlDoneList().slice().reverse().filter(x => !busyIds.has(x.id)));
  }
  const sig = list.map(x => x.id + ':' + (x.title || '') + ':' + (x.state || '') + (x.state === 'progress' ? (x.preparing ? 'p' : Math.floor(+x.percent || 0)) : '')).join('|') + '|' + document.documentElement.lang;
  if (mine && grid.__ytuDlSig === sig) return;
  const orig = mine ? grid.__ytuDlOrig : data;
  if (!list.length) {
    if (mine) { grid.__ytuDlData = null; grid.data = orig; }
    return;
  }
  const next = { ...orig, contents: [{ richSectionRenderer: { content: { richShelfRenderer: {
    isExpanded: true,
    contents: list.map(dlPageItem),
    entitySelectorType: 'RICH_SHELF_ENTITY_SELECTOR_TYPE_DOWNLOADS_PAGE_MANUAL_DOWNLOADS',
    responsiveContainerConfiguration: { responsiveSize: 'RESPONSIVE_SIZE_EXTRA_COMPACT' },
    title: { runs: [{ text: MSG.yourDownloads() }] },
    subtitle: { runs: [{ text: dlCountText(list.length) }] },
  } } } }] };
  grid.__ytuDlOrig = orig;
  grid.__ytuDlData = next;
  grid.__ytuDlSig = sig;
  grid.data = next;
}

// הכניסה "הורדות" בתפריט הצד (guideEntryRenderer → FEdownloads, אייקון OFFLINE_DOWNLOAD), אחרי השורות של "היסטוריה".
// נקרא מ-prune() (ads.js) על תשובת /youtubei/v1/guide
function dlPatchGuide(o) {
  if (!dlPageOn() || !o || !o.responseContext || !Array.isArray(o.items)) return;
  let has = false, spot = null;
  const scan = (arr, depth) => {
    if (!Array.isArray(arr) || depth > 4) return;
    arr.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const e = it.guideEntryRenderer;
      const bid = e && e.navigationEndpoint && e.navigationEndpoint.browseEndpoint && e.navigationEndpoint.browseEndpoint.browseId;
      if (bid === 'FEdownloads') has = true;
      if (bid === 'FEhistory' && !spot) spot = { arr, i };
      const sec = it.guideSectionRenderer || it.guideCollapsibleSectionEntryRenderer;
      if (sec) { scan(sec.items, depth + 1); scan(sec.sectionItems, depth + 1); }
      if (it.guideCollapsibleEntryRenderer) scan(it.guideCollapsibleEntryRenderer.expandableItems, depth + 1);
    });
  };
  scan(o.items, 0);
  if (has || !spot) return;
  let at = spot.i + 1;
  while (at < spot.arr.length && spot.arr[at] && spot.arr[at].guideEntryRenderer) at++;
  const title = MSG.downloads();
  spot.arr.splice(at, 0, { guideEntryRenderer: {
    navigationEndpoint: DL_PAGE_ENDPOINT(),
    icon: { iconType: 'OFFLINE_DOWNLOAD' },
    formattedTitle: { simpleText: title },
    accessibility: { accessibilityData: { label: title } },
    entryData: { guideEntryData: { guideEntryId: 'FEdownloads' } },
  } });
}

// ---------- הדיאלוגים ----------

function openDownloadDialog(anchor, id) {
  id = id || videoId();
  if (!S.download) return;
  if (!id) return dlSnack(dlT('פתחו סרטון כדי להוריד אותו', 'Open a video to download it'));

  // בזמן הורדה / בתור / אחרי הורדה: ACTION_REMOVE_WITH_PROMPT. הורדה אחרת רצה – נכנסים לתור, כמו ב-Premium
  if ((dlBusy && dlBusy.id === id) || dlIsQueued(id) || dlIsDone(id)) return openRemoveDialog(id);
  // "ניסיון חוזר" (ACTION_RETRY): אותה בחירה בלי לשאול שוב
  if (dlFailed.has(id)) return startDownload(id, dlFailed.get(id));

  // YouTube Music: אין דיאלוג רזולוציה לשירים – האיכות היא הגדרה של Music, והטראק יורד כשמע
  if (SITE === 'music') return startDownload(id, 'audio');
  // איכות קבועה בהגדרות – כמו ב-Premium, בלי לשאול
  const fixed = S.downloadQuality && S.downloadQuality !== 'ask' ? dlNormChoice(S.downloadQuality) : null;
  if (fixed) return startDownload(id, fixed);
  openQualityDialog(id);
}

// ACTION_REMOVE מתפריט (⋮ / גיליון "עוד" / דף ההורדות): מוחקים מיד וטוסט "הסרטון נמחק מההורדות." עם "ביטול" ו-X
// (VSz ב-kevlar_base). רק הכפתור הרשמי שואל קודם (ACTION_REMOVE_WITH_PROMPT)
function dlRemoveNow(id) {
  const busy = dlBusy && dlBusy.id === id ? dlBusy : null;
  const queued = dlQueue.find(q => q.id === id);
  const entry = dlDoneList().find(x => x.id === id);
  let undo;
  if (busy) {
    const choice = busy.choice;
    dlCancel(busy);
    undo = () => startDownload(id, choice);
  } else if (queued) {
    dlUnqueue(id);
    undo = () => startDownload(id, queued.choice);
  } else if (entry) {
    dlSetDone(id, false);
    undo = () => dlRestoreDone(entry);
  } else return false;
  ytToast({ text: MSG.deleted(), action: { label: MSG.undo(), run: undo }, close: true });
  return true;
}

function dlRestoreDone(entry) {
  const list = dlDoneList().filter(x => x.id !== entry.id);
  list.push(entry);
  list.sort((a, b) => (a.at || 0) - (b.at || 0));
  try { localStorage.setItem(DL_DONE_KEY, JSON.stringify(list.slice(-DL_DONE_MAX))); } catch {}
  refreshDownloadButtons();
}

function dlButton(label, cls, onclick) {
  return h('button', { class: 'btn ' + cls, onclick }, label);
}

// ACTION_REMOVE_WITH_PROMPT (VSz ב-kevlar_base → confirmDialogRenderer):
// www / m.youtube: "הסרה מההורדות", בלי הסבר, "ביטול" (STYLE_TEXT) ו"מחיקה" (STYLE_BLUE_TEXT).
// YouTube Music (WEB_REMIX): "להסיר את ההורדה?", הסבר, "ביטול" ו"הסרה".
// בזמן הורדה – מבטל אותה; בתור – מוציא מהתור; אחרי הורדה – מוחק מרשימת ההורדות
function openRemoveDialog(id) {
  if (isDownloadViewOpen(id)) return;
  closeDownloadDialog();
  let dlg;
  const music = SITE === 'music';
  const title = music ? ytMsg('REMOVE_DOWNLOAD_QUESTION', 'להסיר את ההורדה?', 'Remove download?') : MSG.removeTitle();
  const body = music
    ? [h('p', { class: 'dq-msg' }, ytMsg('REMOVE_DOWNLOAD_CONFIRMATION_TRACK_OFFLINE', 'הטראק לא יהיה זמין להאזנה במצב אופליין.', "This track won't be available to listen offline."))]
    : [];
  const okLabel = music ? ytMsg('REMOVE_DOWNLOAD_BUTTON', 'הסרה', 'Remove') : MSG.delete();
  const actions = [
    dlButton(MSG.cancel(), 'dq-cancel', () => dlg.close(false)),
    dlButton(okLabel, 'dq-ok', () => {
      dlg.close(true);
      const busy = dlBusy && dlBusy.id === id ? dlBusy : null;
      if (busy) dlCancel(busy);
      else if (dlIsQueued(id)) dlUnqueue(id);
      else dlSetDone(id, false);
    }),
  ];
  dlg = ytDialog({
    title, body, actions, className: 'dq-dialog dq-confirm',
    onClose: () => { if (dlDialog && dlDialog.back === dlg.back) dlDialog = null; },
  });
  dlDialog = { id, close: dlg.close, back: dlg.back };
  actions[0].focus();
}

function openQualityDialog(id, again) {
  if (isDownloadViewOpen(id) && !again) return;
  closeDownloadDialog();
  let chosen = null;
  const asides = new Map();
  let dlg;
  const okBtn = h('button', {
    class: 'btn dq-ok', disabled: true,
    onclick: () => {
      if (!chosen) return;
      try { localStorage.setItem(DL_CHOICE_KEY, chosen); } catch {}
      if (remember.checked) update({ downloadQuality: chosen });
      dlg.close(true);
      startDownload(id, chosen);
    },
  }, MSG.download());
  // כמו ytd-settings-radio-option-renderer: #start (רדיו + שם) ו-#end (גודל)
  const last = dlLastChoice();
  const makeRows = choices => choices.map(c => {
    const radio = h('input', { type: 'radio', class: 'dq-radio', name: 'ytu-dl-quality', value: c.value,
      onchange: () => { chosen = c.value; okBtn.disabled = false; } });
    if (c.value === last) radio.setAttribute('data-last', '');
    const aside = h('div', { class: 'dq-aside' }, '');
    asides.set(c.value, aside);
    if (chosen === c.value) radio.checked = true;
    return h('label', { class: 'dq-row', 'data-choice': c.value },
      h('div', { class: 'dq-start' }, radio, h('div', { class: 'dq-label' }, dlT(c.he, c.en))),
      h('div', { class: 'dq-end' }, aside));
  });
  const list = h('div', { class: 'dq-list', role: 'radiogroup' }, makeRows(DL_CHOICES));
  const remember = h('input', { type: 'checkbox', class: 'dq-check' });
  const body = h('div', { class: 'dq' }, list,
    h('label', { class: 'dq-remember' }, remember, h('span', null, MSG.remember())));

  const cancelBtn = dlButton(MSG.cancel(), 'dq-cancel', () => dlg.close(false));
  dlg = ytDialog({
    title: MSG.quality(), body, actions: [cancelBtn, okBtn], className: 'dq-dialog',
    onClose: () => { if (dlDialog && dlDialog.back === dlg.back) dlDialog = null; },
  });
  dlDialog = { id, close: dlg.close, back: dlg.back };
  cancelBtn.focus();

  // גדלים לפי מה שיוטיוב מחזיר
  dlGetInfo(id).then(info => {
    if (!dlg.back.isConnected) return;
    // עכשיו יודעים מה יוטיוב מציע לסרטון הזה – מציגים את כל האיכויות
    asides.clear();
    fill(list, ...makeRows(dlChoices(info)));
    for (const [value, aside] of asides) aside.textContent = dlSizeText(info, value);
  }).catch(() => {});
}

function dlCancel(busy) {
  if (!busy || dlBusy !== busy) return;
  if (busy.abort) busy.abort.abort();
  dlFinish(busy, null, true);
}

function dlUnqueue(id) {
  const i = dlQueue.findIndex(q => q.id === id);
  if (i < 0) return;
  dlQueue.splice(i, 1);
  dlSession.total = Math.max(0, dlSession.total - 1);
  refreshDownloadButtons();
  dlUpdateUnload();
  if (dlBusy) dlShowProgress(dlBusy);
}

// הבאה בתור
function dlPump() {
  if (dlBusy || !dlQueue.length) return;
  const next = dlQueue.shift();
  runDownload(next.id, next.choice);
}

// סוף הורדה אחת (הצלחה / כישלון / ביטול): משחררים, מעדכנים את הכפתור ואת הטוסט וממשיכים בתור.
// endToast: הטוסט שמוצג בסוף (אם התור ריק; שגיאה מוצגת גם באמצע תור). cancelled: לא נספר כהורדה
function dlFinish(busy, endToast, cancelled) {
  if (busy && dlBusy === busy) dlBusy = null;
  if (cancelled) dlSession.total = Math.max(0, dlSession.total - 1);
  else dlSession.done++;
  const more = dlQueue.length > 0;
  if (!more || (endToast && endToast.error)) {
    if (dlToast) dlToast.hide();
    dlToast = null;
  }
  refreshDownloadButtons();
  dlUpdateUnload();
  if (endToast && (!more || endToast.error)) {
    if (more) dlToastHold = Date.now() + 4000;
    ytToast(endToast);
  }
  if (more) setTimeout(dlPump, 0);
  else { dlSession.total = 0; dlSession.done = 0; dlToastClosed = false; }
}

// כישלון: הכפתור עובר ל"ניסיון חוזר" עם הבחירה האחרונה
function dlFail(busy, id, choice, endToast) {
  if (id) dlFailed.set(id, choice);
  dlFinish(busy, { ...endToast, error: true });
}

// ---------- הודעות שגיאה בשפת הממשק ----------

const DL_ERRORS = {
  BLOCKED_418: ['הבקשה נחסמה (ייתכן שהסינון חוסם את הסרטון)', 'The request was blocked (a content filter may be blocking this video)'],
};

// ---------- ההורדה ----------

// התחלת הורדה. אם הורדה אחרת רצה – נכנסת לתור (הכפתור מציג "יורד" עם טבעת ב-0)
async function startDownload(id, choice) {
  choice = dlNormChoice(choice) || '720';
  if ((dlBusy && dlBusy.id === id) || dlIsQueued(id)) return;
  dlFailed.delete(id);
  // "הורדה בחלון נפרד": החלון שלנו מוריד במקומנו (download-window.js), ואפשר לסגור את הלשונית
  if (typeof dlwHandOff === 'function' && dlwHandOff(id, choice)) return;
  if (!dlBusy && !dlQueue.length) { dlSession.total = 0; dlSession.done = 0; dlToastClosed = false; }
  dlSession.total++;
  if (dlBusy) {
    dlQueue.push({ id, choice, meta: dlMeta(id) });
    refreshDownloadButtons();
    dlUpdateUnload();
    dlShowProgress(dlBusy);
    return;
  }
  return runDownload(id, choice);
}

// האיכות הבאה מתחת לזו שנבחרה (לפי מה שיש לסרטון), או null אם זו הנמוכה
function dlLowerChoice(id, choice) {
  const info = dlInfoNow(id);
  if (!info || dlIsAudio(choice)) return null;
  const cur = dlPickVideo(info, choice);
  if (!cur) return null;
  const lower = [...info.videos].filter(v => v.height && v.height < cur.height).sort((a, b) => b.height - a.height)[0];
  return lower ? String(lower.height) : null;
}

const dlOutOfMemory = e => !!e && (e.name === 'RangeError' || e.tooLarge);

// retried: כבר ניסינו עם קישורים חדשים – לא מנסים בלולאה
async function runDownload(id, choice, retried) {
  let busy = null;
  try {
    await browserDownload(id, choice, b => { busy = b; });
  } catch (e) {
    if (e && e.name === 'AbortError') return; // בוטל – dlCancel כבר סיים
    // הסרטון כבד לדפדפן: מנסים את האיכות שמתחת, כמו שיוטיוב מנמיך איכות בהורדה
    if (dlOutOfMemory(e)) {
      const lower = dlLowerChoice(id, choice);
      if (lower) {
        if (busy && dlBusy === busy) dlBusy = null;
        dlSnack(dlT('הסרטון כבד לדפדפן. מוריד ב-' + lower + 'p', 'Too large for the browser. Downloading at ' + lower + 'p'), null, 4000);
        return runDownload(id, lower);
      }
    }
    // קישור שפג (403): יוטיוב מחזיר קישורים לכמה שעות, אבל לפעמים הם נפסלים אחרי כמה דקות.
    // מבקשים קישורים חדשים ומנסים שוב פעם אחת – במקום להראות "ההורדה נכשלה" על כלום.
    if (e && e.expired) {
      dlInfo.delete(id);
      dlInfoReady.delete(id);
      if (!retried) {
        if (busy && dlBusy === busy) dlBusy = null;
        return runDownload(id, choice, true);
      }
    }
    // "ההורדה נכשלה" כמו ביוטיוב; הסבר קצר רק כשיוטיוב נתן סיבה (סרטון פרטי וכו'), "האחסון מלא" כשאין זיכרון
    const full = e && (e.name === 'RangeError' || e.tooLarge);
    dlFail(busy, id, choice, { text: full ? MSG.storageFull() : MSG.failed(), sub: (e && e.ytReason && e.message) || null });
  }
}

async function browserDownload(id, choice, onBusy) {
  const abort = new AbortController();
  const busy = dlBusy = { id, choice, abort, percent: null, preparing: true, meta: dlMeta(id) };
  if (onBusy) onBusy(busy);
  const aborted = () => new DOMException('aborted', 'AbortError');
  dlUpdateUnload();
  refreshDownloadButtons();
  dlShowProgress(busy);
  try {
    const info = await Promise.race([
      dlGetInfo(id),
      new Promise((_, rej) => abort.signal.addEventListener('abort', () => rej(aborted()), { once: true })),
    ]);
    busy.meta = dlMeta(id, info);
    const v = dlIsAudio(choice) ? null : dlPickVideo(info, choice);
    const files = v ? [v, info.audio] : [info.audio];
    const total = files.reduce((n, f) => n + (+f.contentLength || 0), 0);
    let done = 0, shownAt = 0;
    busy.preparing = false;
    busy.percent = 0;
    dlShowProgress(busy);
    const tick = n => {
      done += n;
      if (!total || dlBusy !== busy) return;
      busy.percent = Math.min(99, done / total * 100);
      if (Date.now() - shownAt > 150) { shownAt = Date.now(); refreshDownloadButtons(); dlShowProgress(busy); }
    };
    const buffers = [];
    for (const f of files) buffers.push(await fetchFile(f, tick, abort.signal));
    if (abort.signal.aborted) throw aborted();
    await sleep(30);
    let parts = Mux.build(buffers, info.length);
    let ext = v ? '.mp4' : '.m4a', mime = v ? 'video/mp4' : 'audio/mp4';
    if (choice === 'mp3') {
      // יוטיוב לא מגיש MP3 בכלל, אז מפענחים את ה-AAC ומקודדים מחדש (לוקח זמן, ויש אובדן איכות)
      busy.converting = true;
      busy.percent = 0;
      dlShowProgress(busy);
      let shownMp3 = 0;
      parts = await toMp3(parts, info, frac => {
        if (abort.signal.aborted) throw aborted();
        busy.percent = Math.min(99, frac * 100);
        if (Date.now() - shownMp3 > 150) { shownMp3 = Date.now(); refreshDownloadButtons(); dlShowProgress(busy); }
      });
      busy.converting = false;
      ext = '.mp3';
      mime = 'audio/mpeg';
    }
    const name = safeName(info.title) + ext;
    saveFile(parts, name, mime);
    dlSetDone(id, true, dlMeta(id, info));
    // "הורדת" + "לצפייה בסרטון" (A2N ב-kevlar_base)
    dlFinish(busy, { text: MSG.downloaded(), action: dlViewAction() });
  } catch (e) {
    if (abort.signal.aborted) throw aborted();
    throw e;
  }
}

// דיאלוג "איכות ההורדה" כמו ytd-download-quality-selector-renderer[dialog] (נמדד ב-CSS של יוטיוב, 16/09/2026):
// רוחב 342 (עד 80vw), רקע ‎#fff/‎#212121, padding 24 0 12, כותרת Roboto 18/26, שורות margin 8 0 12,
// שם וגודל 14/20 ‎#606060/‎#aaa, רדיו 16px, "שמירת ההגדרות שלי" padding 12 0 24, כפתורים טקסט בסוף השורה
const DOWNLOAD_CSS = `
.dlg.dq-dialog { width: 342px; max-width: 80vw; padding: 24px 0 12px; background: var(--yt-bg); color: var(--yt-text); border-radius: 12px; }
.dq-dialog .dlg-head { padding: 0 24px; }
.dq-dialog h2 { margin: 0 0 24px; font: 400 18px/26px Roboto, Arial, sans-serif; color: var(--yt-text); }
.dq-dialog .dlg-body { padding: 0 24px; }
.dq-dialog.dq-confirm h2 { margin-bottom: 12px; }
.dq-dialog .dq-msg { margin: 0 0 12px; color: var(--yt-text2); font: 400 14px/20px Roboto, Arial, sans-serif; }
.dq-dialog .dlg-acts { padding: 0 16px 0 8px; gap: 8px; }
.dq-dialog .btn { color: var(--yt-text); }
.dq-dialog .btn:hover { background: var(--yt-hover); }
.dq-dialog .btn.dq-ok { color: var(--yt-blue); }
.dq-dialog .btn.dq-ok:hover { background: var(--yt-blue-hover); }
.dq-dialog .btn:disabled, .dq-dialog .btn:disabled:hover { color: var(--yt-text2); opacity: .6; background: none; }
.dq-list { display: flex; flex-direction: column; }
.dq-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin: 8px 0 12px; cursor: pointer; }
.dq-start, .dq-end { display: flex; flex-direction: row; align-items: center; min-width: 0; }
.dq-label, .dq-aside, .dq-remember { color: var(--yt-text2); font: 400 14px/20px Roboto, Arial, sans-serif; }
.dq-label { padding-inline-start: 8px; }
.dq-aside { white-space: nowrap; direction: ltr; }
.dq-radio { appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 16px; height: 16px; margin: 0; border: 2px solid var(--yt-text2);
  border-radius: 50%; cursor: pointer; }
.dq-radio:checked { border-color: var(--yt-blue); }
.dq-radio:checked::after { content: ''; position: absolute; inset: 2px; border-radius: 50%; background: var(--yt-blue); }
.dq-radio:focus-visible, .dq-check:focus-visible { outline: 2px solid var(--yt-blue); outline-offset: 2px; }
.dq-remember { display: flex; align-items: center; gap: 8px; padding: 12px 0 24px; cursor: pointer; }
.dq-check { appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 18px; height: 18px; margin: 0; border: 2px solid var(--yt-text2);
  border-radius: 2px; cursor: pointer; }
.dq-check:checked { background: var(--yt-blue); border-color: var(--yt-blue); }
.dq-check:checked::after { content: ''; position: absolute; left: 4px; top: 0; width: 5px; height: 10px; border: solid var(--yt-bg); border-width: 0 2px 2px 0; transform: rotate(45deg); }
`;
