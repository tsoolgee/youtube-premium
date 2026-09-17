// לקוח שרת ההורדה לדרייב (API 1.3). רץ גם ב-service worker (importScripts) וגם בתוך החבילה שבדף,
// ולכן בלי chrome.* ובלי DOM, וכל השמות ברמה העליונה מתחילים ב-DRIVE_ / DriveClient.

// ממסר Apps Script – נטפרי חוסם את כתובת השרת הביתי ישירות
const DRIVE_DEFAULT_SERVER = 'https://script.google.com/macros/s/AKfycbxewFuo8cSzfhhsGYsfwPD68MvB20UELCLXzazk6GbiWqCB5Y07IS5sYDAXjvhMVFMl/exec';

const DRIVE_ACTIVE_STATES = ['queued', 'checking', 'downloading', 'converting', 'copying', 'uploading', 'shortening'];

const DRIVE_STATE_TEXT = {
  queued: 'ממתין בתור',
  checking: 'בודק את הסרטון',
  downloading: 'מוריד',
  converting: 'ממיר',
  copying: 'שומר בדרייב',
  uploading: 'מעלה לדרייב',
  shortening: 'מקצר קישור',
  done: 'מוכן',
  error: 'נכשל',
};

const DRIVE_STAGE_TEXT = {
  netfree: 'בדיקת נטפרי',
  info: 'קריאת פרטי הסרטון',
  video: 'וידאו',
  audio: 'שמע',
  merge: 'מיזוג וידאו ושמע',
  convert: 'המרה',
};

// מה המשתמש יכול לעשות עם כל שגיאה
const DRIVE_ERROR_HINT = {
  NETFREE_BLOCKED: 'אפשר לבקש פתיחה מנטפרי ולנסות שוב אחרי האישור.',
  NETFREE_PENDING: 'נטפרי עוד לא בדק את הסרטון. נסו שוב בעוד כמה דקות.',
  NETFREE_STREAM_BLOCKED: 'הדף פתוח אבל הקובץ נחסם. אפשר לנסות איכות אחרת או שמע בלבד.',
  VIDEO_FILE_BLOCKED: 'אפשר להוריד שמע בלבד.',
  YT_BOT_CHECK: 'יוטיוב חסם זמנית את השרת. נסו שוב בעוד כחצי שעה, או הפעילו בהגדרות את שיתוף העוגיות.',
  YT_PRIVATE: 'הסרטון פרטי.',
  YT_UNAVAILABLE: 'הסרטון לא זמין.',
  YT_AGE_RESTRICTED: 'הסרטון מוגבל לפי גיל.',
  LIVE_NOT_SUPPORTED: 'אי אפשר להוריד שידור חי.',
  TOO_LONG: 'הסרטון ארוך מדי לשרת.',
  DRIVE_FULL: 'האחסון בדרייב מלא.',
  QUEUE_FULL: 'נסו שוב בעוד כמה דקות.',
  RATE_LIMIT: 'נסו שוב בעוד שעה.',
  UNAUTHORIZED: 'מפתח ה-API בהגדרות שגוי – מחקו אותו או תקנו.',
  JOB_NOT_FOUND: 'השרת הופעל מחדש. התחילו את ההורדה שוב.',
  NETWORK: 'נסו שוב.',
  SERVER_OFFLINE: 'השרת כבוי או שהמחשב לא מחובר. נסו שוב מאוחר יותר.',
  CLIENT_BLOCKED: 'כתובת השרת חסומה בסינון. בהגדרות צריך להיות כתובת ה-Apps Script.',
  BAD_RESPONSE: 'נסו שוב בעוד רגע.',
  DRIVE_UPLOAD_TIMEOUT: 'הקובץ נשמר; ייתכן שיופיע בתיקייה בהמשך.',
  NOT_LOGGED_IN: 'התחברו ליוטיוב בדפדפן ונסו שוב.',
  NO_COOKIE_ACCESS: 'אשרו לתוסף גישה לעוגיות ונסו שוב.',
  COOKIES_INVALID: 'העוגיות לא עבדו. התחברו מחדש ליוטיוב ונסו שוב.',
  COOKIES_DISABLED: 'השרת לא מקבל עוגיות כרגע.',
};

const DRIVE_QUALITIES = {
  audio: [{ value: 'mp3', label: 'MP3' }, { value: 'm4a', label: 'M4A' }],
  video: [
    { value: 'best', label: 'הכי טובה' },
    { value: '1080', label: '1080p' },
    { value: '720', label: '720p' },
    { value: '480', label: '480p' },
    { value: '360', label: '360p' },
  ],
};

const DriveClient = (() => {
  // שגיאות שלא אומרות כלום על העבודה עצמה – השרת/הממסר פשוט לא ענו כרגע
  const TRANSIENT = ['SERVER_OFFLINE', 'CLIENT_BLOCKED', 'BAD_RESPONSE'];
  const AUTH_COOKIES = ['SAPISID', '__Secure-3PSID', '__Secure-1PSID', '__Secure-3PAPISID', 'SID'];
  const ORPHAN_MS = 90000;
  const TAB = String.fromCharCode(9);
  const NL = String.fromCharCode(10);

  const client = {
    retryDelay: 1500,   // ניתן לשינוי בבדיקות
    timeout: 60000,
  };

  const err = (code, message, detail) => ({ ok: false, error: detail ? { code, message, detail } : { code, message } });

  function serverOf(settings) {
    return String((settings && settings.serverUrl) || DRIVE_DEFAULT_SERVER).trim().replace(/\/+$/, '');
  }

  function isRelay(server) {
    return /^https:\/\/script\.google\.com\/macros\/s\//.test(server);
  }

  async function apiOnce(settings, path, body) {
    const server = serverOf(settings);
    const key = (settings && settings.apiKey) || '';
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), client.timeout) : null;
    let res, text;
    try {
      if (isRelay(server)) {
        // ממסר: הכול ב-POST אחד בלי preflight, והמפתח בגוף ולא בכתובת. redirect חובה (googleusercontent)
        res = await fetch(server, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ path, key, body: body === undefined ? undefined : body }),
          redirect: 'follow',
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined,
        });
      } else {
        const headers = { 'Content-Type': 'application/json' };
        if (key) headers['X-API-Key'] = key;
        res = await fetch(server + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined,
        });
      }
      text = await res.text();
    } catch (e) {
      return err('SERVER_OFFLINE', 'אין חיבור לשרת ההורדה');
    } finally {
      if (timer) clearTimeout(timer);
    }
    // נטפרי אצל המשתמש חוסם את הכתובת: 418, לפעמים עם גוף משלו
    if (res.status === 418 || /blockByNetFree|netfree\.link\/block/i.test(text)) {
      return err('CLIENT_BLOCKED', 'כתובת שרת ההורדה חסומה בסינון במחשב הזה');
    }
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    if (data && typeof data === 'object' && typeof data.ok === 'boolean') {
      if (!data.ok && !data.error) data.error = { code: 'BAD_RESPONSE', message: 'תשובה לא צפויה מהשרת' };
      return data;
    }
    // דף שגיאה של Cloudflare כשהמחשב או השרת כבויים
    if (res.status === 502 || res.status === 503 || res.status >= 520) {
      return err('SERVER_OFFLINE', 'שרת ההורדה לא זמין כרגע');
    }
    return err('BAD_RESPONSE', 'תשובה לא צפויה מהשרת (' + res.status + ')');
  }

  // גוגל מחזיר לא מעט פעמים דף שגיאה ("לא ניתן לפתוח את הקובץ כרגע") במקום תשובת הסקריפט,
  // גם כשהבקשה כבר הגיעה לשרת. /download בטוח לשליחה חוזרת (השרת מחזיר את אותו קובץ מהמטמון),
  // אז מנסים שוב כמה פעמים עם המתנה הולכת וגדלה לפני שמוותרים.
  client.attempts = 6;
  client.api = async function api(settings, path, body) {
    for (let attempt = 1; ; attempt++) {
      const r = await apiOnce(settings, path, body);
      if (!r.error || r.error.code !== 'BAD_RESPONSE' || attempt >= client.attempts) return r;
      await new Promise(done => setTimeout(done, client.retryDelay * attempt));
    }
  };

  client.videoIdFromUrl = function videoIdFromUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^(www|m|music)\./, '');
      if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
      if (host === 'youtube.com') {
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
        if (m) return m[2];
      }
    } catch (e) {}
    return null;
  };

  client.isActive = job => !!job && DRIVE_ACTIVE_STATES.includes(job.state);

  client.newJob = function newJob({ url, videoId, type, quality, title } = {}) {
    const id = videoId || (url ? client.videoIdFromUrl(url) : null);
    type = type === 'video' ? 'video' : 'audio';
    const allowed = DRIVE_QUALITIES[type].map(q => q.value);
    return {
      localId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      url: url || (id ? 'https://www.youtube.com/watch?v=' + id : ''),
      videoId: id || '',
      type,
      quality: allowed.includes(String(quality)) ? String(quality) : allowed[0],
      title: title || '',
      state: 'queued',
      created: Date.now(),
    };
  };

  // שולח את העבודה לשרת ומחזיר עותק מעודכן (לא משנה את המקור)
  client.start = async function start(settings, job) {
    const j = Object.assign({}, job);
    delete j.jobId; delete j.error; delete j.offlineSince;
    if (!j.url) return Object.assign(j, { state: 'error', error: { code: 'BAD_URL', message: 'אין קישור לסרטון' } });
    const r = await client.api(settings, '/download', { url: j.url, type: j.type, quality: j.quality });
    if (!r.ok || !r.job_id) {
      return Object.assign(j, { state: 'error', error: r.error || { code: 'BAD_RESPONSE', message: 'תשובה לא צפויה מהשרת' } });
    }
    return Object.assign(j, { jobId: r.job_id, state: r.state || 'queued', startedAt: Date.now() });
  };

  // בודק מצב עבודה אחת. תקלה זמנית לא הורסת את העבודה – רק מסמנת offlineSince
  client.poll = async function poll(settings, job) {
    if (!client.isActive(job)) return job;
    if (!job.jobId) {
      // העבודה לא קיבלה מספר מהשרת (ה-worker/הדף נעצרו באמצע השליחה)
      if (Date.now() - (job.created || 0) > ORPHAN_MS) {
        return Object.assign({}, job, { state: 'error', error: { code: 'SERVER_OFFLINE', message: 'הבקשה לא הגיעה לשרת' } });
      }
      return job;
    }
    const r = await client.api(settings, '/status/' + encodeURIComponent(job.jobId));
    const j = Object.assign({}, job);
    if (!r.ok) {
      if (r.error && TRANSIENT.includes(r.error.code)) {
        j.offlineSince = j.offlineSince || Date.now();
        return j;
      }
      delete j.offlineSince;
      return Object.assign(j, { state: 'error', error: r.error });
    }
    delete j.offlineSince;
    Object.assign(j, {
      state: r.state || j.state,
      stage: r.stage || '',
      percent: typeof r.percent === 'number' ? r.percent : null,
      position: r.position,
      title: r.title || j.title,
      short_url: r.short_url, drive_url: r.drive_url, view_url: r.view_url,
      size: r.size, cached: r.cached,
    });
    if (j.state === 'error') j.error = r.error || { code: 'DOWNLOAD_FAILED', message: 'ההורדה נכשלה' };
    else delete j.error;
    return j;
  };

  // קלט: מערך עוגיות בפורמט chrome.cookies. פלט: קובץ Netscape ש-yt-dlp מבין
  client.toNetscape = function toNetscape(cookies) {
    const seen = new Set();
    const lines = ['# Netscape HTTP Cookie File'];
    let hasAuth = false;
    for (const c of cookies || []) {
      if (!c || !c.name || !c.domain) continue;
      const name = String(c.name), value = String(c.value == null ? '' : c.value);
      // תו טאב/ירידת שורה ישבור את הקובץ
      if ((name + value).indexOf(TAB) >= 0 || (name + value).indexOf(NL) >= 0) continue;
      const domain = c.domain.charAt(0) === '.' ? c.domain : '.' + c.domain;
      const path = c.path || '/';
      const k = domain + ' ' + path + ' ' + name;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push([domain, 'TRUE', path, c.secure ? 'TRUE' : 'FALSE', Math.round(c.expirationDate || 0), name, value].join(TAB));
      if (AUTH_COOKIES.includes(name) && value) hasAuth = true;
    }
    if (!hasAuth) return err('NOT_LOGGED_IN', 'לא נמצא חיבור פעיל ליוטיוב. התחברו ליוטיוב בדפדפן ונסו שוב');
    return { ok: true, text: lines.join(NL) + NL };
  };

  // גיבוי מהדפדפן לשרת: גובה הווידאו שנבחר (או null לשמע) → איכות מקבילה בשרת
  client.mapBrowserQuality = function mapBrowserQuality(height) {
    const hgt = Number(height);
    if (!height || !hgt) return { type: 'audio', quality: 'm4a' };
    if (hgt > 1080) return { type: 'video', quality: 'best' };
    if (hgt >= 1080) return { type: 'video', quality: '1080' };
    if (hgt >= 720) return { type: 'video', quality: '720' };
    if (hgt >= 480) return { type: 'video', quality: '480' };
    return { type: 'video', quality: '360' };
  };

  client.hint = code => DRIVE_ERROR_HINT[code] || '';
  client.isRelay = server => isRelay(serverOf({ serverUrl: server }));

  return client;
})();
