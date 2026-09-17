// ==UserScript==
// @name         יוטיוב פרימיום
// @author       צול גאה – TSOOLGEE.UK
// @homepageURL  https://github.com/tsoolgee/youtube-premium
// @downloadURL  https://raw.githubusercontent.com/tsoolgee/youtube-premium/main/userscript/youtube-premium.user.js
// @updateURL    https://raw.githubusercontent.com/tsoolgee/youtube-premium/main/userscript/youtube-premium.user.js
// @namespace    https://github.com/tsoolgee/youtube-premium
// @version      2.1.4
// @description  בלי פרסומות, ניגון ברקע, הורדת סרטונים (גם דרך שרת Drive), חלון צף, איכות מרבית ומהירויות עד פי 4
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://music.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

// נוצר אוטומטית ע"י build.py מתוך src/ – לא לערוך ישירות.
(() => {
  'use strict';
  if (window.__ytuLoaded) return;
  window.__ytuLoaded = true;

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

  // רשימת ההגדרות – משותפת לדיאלוג ההגדרות של הטמפרמונקי, לחלון התוסף, ל-service worker ולסקריפט הטמפרמונקי.
  // type: bool / select / text. secret לא מגיע לדף בתוסף. extensionOnly מוסתר בטמפרמונקי.
  // popupOnly: בתוסף נערך רק בחלון התוסף – הדף (וכל סקריפט אחר שרץ בו) לא יכול לשנות אותו.
  // drive-client.js נטען לפני הקובץ הזה בכל ההקשרים; בגשר (bridge) הוא לא נטען, ולכן יש ברירת מחדל.
  const SETTING_GROUPS = [
    { id: 'ads', label: 'פרסומות', labelEn: 'Ads' },
    { id: 'watch', label: 'צפייה', labelEn: 'Playback' },
    { id: 'download', label: 'הורדות', labelEn: 'Downloads' },
    { id: 'drive', label: 'שרת Drive', labelEn: 'Drive server' },
  ];

  // labelEn / descEn: כשממשק יוטיוב לא בעברית
  const SETTINGS = [
    { key: 'adblock', type: 'bool', group: 'ads', def: true, label: 'בלי פרסומות', desc: 'מדלג על פרסומות בסרטונים ומסתיר פרסומות בדף הבית, בחיפוש ובצד',
      labelEn: 'Ad-free', descEn: 'Skips video ads and hides ads on Home, Search and the sidebar' },
    { key: 'adPrune', type: 'bool', group: 'ads', def: true, label: 'חסימה מוקדמת', desc: 'מוחק את הפרסומות לפני שהנגן טוען אותן. אם סרטונים נתקעים בטעינה – לכבות',
      labelEn: 'Early blocking', descEn: 'Removes ads before the player loads them. Turn off if videos get stuck loading' },
    { key: 'hidePromos', type: 'bool', group: 'ads', def: true, label: 'בלי חלונות Premium', desc: 'מסתיר הצעות "נסו את YouTube Premium" ואת האזהרה על חוסם פרסומות',
      labelEn: 'No Premium offers', descEn: 'Hides "Try YouTube Premium" offers and the ad-blocker warning' },

    { key: 'background', type: 'bool', group: 'watch', def: true, label: 'ניגון ברקע', desc: 'הסרטון ממשיך כשעוברים לשונית או ממזערים, ובלי "עדיין צופים?"',
      labelEn: 'Background play', descEn: 'Keeps playing in another tab or when minimized, without "Still watching?"' },
    { key: 'pip', type: 'bool', group: 'watch', def: true, label: 'תמונה בתוך תמונה', desc: 'אפשר לצפות בחלון צף מעל כל החלונות',
      labelEn: 'Picture-in-picture', descEn: 'Watch in a floating window above other windows' },
    { key: 'autoPip', type: 'bool', group: 'watch', def: true, label: 'חלון צף אוטומטי', desc: 'במובייל (m.youtube): עובר לחלון צף כשיוצאים מהלשונית באמצע ניגון',
      labelEn: 'Automatic picture-in-picture', descEn: 'On mobile (m.youtube): switches to a floating window when you leave the tab while playing' },
    { key: 'maxQuality', type: 'bool', group: 'watch', def: false, label: 'איכות מרבית', desc: 'נועל כל סרטון על האיכות הגבוהה ביותר במקום "אוטומטי" של יוטיוב',
      labelEn: 'Highest quality', descEn: 'Locks every video to the highest quality instead of YouTube’s Auto' },
    { key: 'speed', type: 'bool', group: 'watch', def: true, label: 'מהירויות Premium', desc: 'מהירויות Premium עד פי 4 בתפריט המהירות',
      labelEn: 'Premium playback speeds', descEn: 'Premium speeds up to 4x in the playback speed menu' },

    { key: 'download', type: 'bool', group: 'download', def: true, label: 'הורדות', desc: 'כפתור "הורדה" של יוטיוב מוריד את הסרטון (וידאו או שמע)',
      labelEn: 'Downloads', descEn: 'YouTube’s Download button saves the video (video or audio)' },
    { key: 'downloadQuality', type: 'select', group: 'download', def: 'ask', label: 'איכות ההורדה', desc: 'כמו בהגדרות ההורדה של YouTube Premium',
      labelEn: 'Download quality', descEn: 'Like YouTube Premium’s download settings',
      options: [
        { value: 'ask', label: 'לשאול בכל פעם', labelEn: 'Ask each time' },
        { value: '1080', label: 'Full HD (1080p)', labelEn: 'Full HD (1080p)' },
        { value: '720', label: 'גבוהה (720p)', labelEn: 'High (720p)' },
        { value: '360', label: 'בינונית (360p)', labelEn: 'Medium (360p)' },
        { value: '144', label: 'נמוכה (144p)', labelEn: 'Low (144p)' },
        { value: 'audio', label: 'שמע בלבד', labelEn: 'Audio only' },
      ] },
    { key: 'downloadMethod', type: 'select', group: 'download', def: 'auto', label: 'שיטת הורדה', desc: 'באוטומטי: קודם בדפדפן, ואם נכשל – דרך השרת',
      labelEn: 'Download method', descEn: 'Automatic: in the browser first, then through the server if that fails',
      options: [
        { value: 'auto', label: 'אוטומטי', labelEn: 'Automatic' },
        { value: 'browser', label: 'רק בדפדפן', labelEn: 'Browser only' },
        { value: 'server', label: 'רק דרך השרת', labelEn: 'Server only' },
      ] },
    { key: 'hookOfficialButton', type: 'bool', group: 'download', def: true, label: 'כפתור ההורדה של יוטיוב', desc: 'כפתור "הורדה" ו"הורדה" בתפריט ⋮ מורידים במקום הצעת Premium',
      labelEn: 'YouTube’s Download button', descEn: 'The Download button and the ⋮ menu item download instead of showing the Premium offer' },

    { key: 'serverUrl', type: 'text', group: 'drive', popupOnly: true, label: 'כתובת השרת', desc: 'כתובת ה-Apps Script של הממסר (ריק = ברירת המחדל)',
      labelEn: 'Server address', descEn: 'Relay Apps Script URL (empty = default)',
      def: typeof DRIVE_DEFAULT_SERVER !== 'undefined' ? DRIVE_DEFAULT_SERVER
        : 'https://script.google.com/macros/s/AKfycbxewFuo8cSzfhhsGYsfwPD68MvB20UELCLXzazk6GbiWqCB5Y07IS5sYDAXjvhMVFMl/exec' },
    { key: 'apiKey', type: 'text', group: 'drive', def: '', secret: true, label: 'מפתח API', desc: 'רק אם השרת דורש מפתח',
      labelEn: 'API key', descEn: 'Only if the server requires one' },
    { key: 'shareCookies', type: 'bool', group: 'drive', def: false, confirm: 'cookies', extensionOnly: true, popupOnly: true, label: 'שיתוף עוגיות יוטיוב',
      desc: 'כשיוטיוב חוסם את השרת ("אמתו שאתם לא בוט") – שולח לשרת את החיבור שלכם ליוטיוב. כבוי כברירת מחדל',
      labelEn: 'Share YouTube cookies', descEn: 'When YouTube blocks the server ("confirm you’re not a bot"), sends your YouTube sign-in to the server. Off by default' },
  ];

  const DEFAULTS = Object.fromEntries(SETTINGS.map(s => [s.key, s.def]));

  // ערכים ישנים (2.1.0): איכות ההורדה high/medium/low היו 1080/720/360
  const LEGACY_VALUES = { downloadQuality: { high: '1080', medium: '720', low: '360' } };
  function migrateSettings(settings) {
    const out = { ...(settings || {}) };
    for (const [key, map] of Object.entries(LEGACY_VALUES)) {
      if (Object.prototype.hasOwnProperty.call(map, out[key])) out[key] = map[out[key]];
    }
    return out;
  }

  // נוסח האזהרה לפני הפעלת שיתוף העוגיות (בחלון התוסף)
  const COOKIE_WARNING = {
    title: 'שיתוף עוגיות יוטיוב עם השרת',
    text: [
      'כשיוטיוב חוסם את שרת ההורדה, התוסף ישלח לשרת את עוגיות ההתחברות שלכם ליוטיוב ולגוגל, כדי שההורדה תיעשה בשם החשבון שלכם.',
      'העוגיות נותנות גישה לחשבון הגוגל שמחובר בדפדפן הזה (מייל, דרייב, יוטיוב). מומלץ מאוד להשתמש בחשבון משני ולא בחשבון הראשי.',
      'העוגיות נשמרות רק בשרת ההורדה הביתי ומשמשות רק להורדות. הן לא נשמרות בתוסף ולא נשלחות לשום מקום אחר.',
      'הן יישלחו רק אם השרת מוגדר לקבל עוגיות, ורק כשהורדה נחסמה או כשלוחצים "שתפו עוגיות עכשיו". שינוי כתובת השרת מכבה את השיתוף.',
    ],
    ok: 'מבין, להפעיל',
    cancel: 'ביטול',
  };
  const COOKIE_WARNING_EN = {
    title: 'Share YouTube cookies with the server',
    text: [
      'When YouTube blocks the download server, the extension will send your YouTube and Google sign-in cookies to the server so the download runs as your account.',
      'The cookies give access to the Google account signed in to this browser (Gmail, Drive, YouTube). Using a secondary account, not your main one, is strongly recommended.',
      'The cookies are kept only on the home download server and used only for downloads. They are not stored in the extension or sent anywhere else.',
      'They are sent only if the server accepts cookies, and only when a download was blocked or when you press "Share cookies now". Changing the server address turns sharing off.',
    ],
    ok: 'I understand, turn on',
    cancel: 'Cancel',
  };

  // מפתחות שלא עוברים לדף בתוסף
  const SECRET_KEYS = SETTINGS.filter(s => s.secret).map(s => s.key);
  // מפתחות שהדף לא יכול לשנות בתוסף: סודות, כתובת השרת (אליה נשלחים המפתח והעוגיות) וההסכמה לעוגיות
  const PAGE_LOCKED_KEYS = SETTINGS.filter(s => s.secret || s.popupOnly).map(s => s.key);

  // מה נשמר באחסון: כתובת השרת שווה לברירת המחדל לא נשמרת, כדי שעדכון הממסר בגרסה חדשה יגיע לכולם
  function storableSettings(settings) {
    const out = { ...(settings || {}) };
    if (!out.serverUrl || String(out.serverUrl).trim() === DEFAULTS.serverUrl) delete out.serverUrl;
    return out;
  }

  // גרסת הטמפרמונקי (@grant none): ההגדרות ב-localStorage של יוטיוב.
  // שרת ה-Drive: הממסר נגיש ב-fetch ישירות מהדף, אז DriveClient רץ כאן והעבודות נשמרות ב-localStorage.
  const Platform = (() => {
    const JOBS_KEY = 'ytu-drive-jobs';
    const LEASE_KEY = 'ytu-drive-poller';
    const MAX_JOBS = 30;
    const POLL_MS = 5000;
    const tabId = Math.random().toString(36).slice(2);

    const load = () => {
      try { return JSON.parse(localStorage.getItem('ytu-settings')) || {}; } catch { return {}; }
    };
    const driveSettings = () => {
      const s = { ...DEFAULTS, ...load() };
      return { serverUrl: s.serverUrl, apiKey: s.apiKey || '' };
    };
    const hasClient = () => typeof DriveClient !== 'undefined';
    const noClient = () => ({ ok: false, error: { code: 'INTERNAL', message: 'רכיב השרת לא נטען' } });
    const isActive = j => !!j && (hasClient() ? DriveClient.isActive(j) : ['queued', 'checking', 'downloading', 'converting', 'copying', 'uploading', 'shortening'].includes(j.state));

    const readJobs = () => {
      try {
        const list = JSON.parse(localStorage.getItem(JOBS_KEY));
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    };
    const writeJobs = list => {
      try { localStorage.setItem(JOBS_KEY, JSON.stringify(list.slice(0, MAX_JOBS))); } catch {}
    };

    const listeners = [];
    const emit = job => {
      for (const cb of listeners) {
        try { cb(job); } catch {}
      }
    };

    // מחליף עבודה לפי localId על גבי הרשימה העדכנית (לשונית אחרת אולי הוסיפה בינתיים)
    const putJob = job => {
      const list = readJobs();
      const i = list.findIndex(x => x.localId === job.localId);
      if (i >= 0) list[i] = job;
      else list.unshift(job);
      writeJobs(list);
      emit(job);
    };

    // כמה לשוניות יוטיוב פתוחות – רק אחת בודקת מול השרת (כל בדיקה עולה מהמכסה של הממסר).
    // בזמן בדיקה החכירה ארוכה מקריאה אחת לממסר (עד 3 ניסיונות של timeout), כדי שלשונית אחרת לא תיכנס באמצע.
    const callBudget = () => (hasClient() ? (DriveClient.timeout || 60000) + (DriveClient.retryDelay || 1500) : 60000) * 3 + 5000;
    const takeLease = ms => {
      try {
        const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
        if (lease && lease.tab !== tabId && Date.now() < lease.until) return false;
        localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: tabId, until: Date.now() + ms }));
        return true;
      } catch { return true; }
    };
    // לשונית שנסגרת משחררת את החכירה מיד
    window.addEventListener('pagehide', () => {
      try {
        const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
        if (lease && lease.tab === tabId) localStorage.removeItem(LEASE_KEY);
      } catch {}
    });

    let timer = null, polling = false;
    async function pollOnce() {
      if (polling || !hasClient()) return;
      const active = readJobs().filter(isActive);
      if (!active.length) {
        clearInterval(timer);
        timer = null;
        return;
      }
      if (!takeLease(POLL_MS * 3)) return;
      polling = true;
      try {
        const settings = driveSettings();
        for (const job of active) {
          // חידוש לפני כל קריאה; אם לשונית אחרת לקחה בינתיים – עוצרים
          if (!takeLease(callBudget())) break;
          let next;
          try { next = await DriveClient.poll(settings, job); } catch { continue; }
          if (!next || JSON.stringify(next) === JSON.stringify(job)) continue;
          // כותבים רק אם העבודה השמורה לא השתנתה מאז שנקראה – תשובה ישנה לא דורסת מצב חדש
          const stored = readJobs().find(x => x.localId === job.localId);
          if (!stored || JSON.stringify(stored) !== JSON.stringify(job)) continue;
          putJob(next);
        }
      } finally {
        polling = false;
        takeLease(POLL_MS * 3);
      }
    }

    function ensurePolling() {
      if (timer || !readJobs().some(isActive)) return;
      timer = setInterval(pollOnce, POLL_MS);
    }

    // עדכונים שלשונית אחרת כתבה
    window.addEventListener('storage', e => {
      if (e.key !== JOBS_KEY) return;
      let prev = [], next = [];
      try { prev = JSON.parse(e.oldValue) || []; } catch {}
      try { next = JSON.parse(e.newValue) || []; } catch {}
      const before = new Map(prev.map(j => [j.localId, JSON.stringify(j)]));
      for (const j of next) if (before.get(j.localId) !== JSON.stringify(j)) emit(j);
      ensurePolling();
    });

    // אחרי רענון – ממשיכים לעקוב אחרי עבודות שעוד רצות
    setTimeout(ensurePolling, 2000);

    return {
      kind: 'userscript',
      load,
      save(s) {
        try { localStorage.setItem('ytu-settings', JSON.stringify(s)); } catch {}
      },
      onChange(cb) {
        window.addEventListener('storage', e => {
          if (e.key !== 'ytu-settings') return;
          try { cb(JSON.parse(e.newValue) || {}); } catch {}
        });
      },
      onCommand() {},
      drive: {
        canShareCookies: false,
        async health() {
          if (!hasClient()) return noClient();
          try { return await DriveClient.api(driveSettings(), '/health'); } catch { return noClient(); }
        },
        async start(opts) {
          if (!hasClient()) return noClient();
          const settings = driveSettings();
          let job = DriveClient.newJob(opts || {});
          putJob(job);
          try {
            job = await DriveClient.start(settings, job);
          } catch {
            job = { ...job, state: 'error', error: { code: 'INTERNAL', message: 'שליחת ההורדה נכשלה' } };
          }
          putJob(job);
          ensurePolling();
          return job.state === 'error' ? { ok: false, job, error: job.error } : { ok: true, job };
        },
        async jobs() {
          ensurePolling();
          return readJobs();
        },
        onJob(cb) {
          if (typeof cb === 'function') listeners.push(cb);
        },
        async shareCookies() {
          return { ok: false, error: { code: 'UNSUPPORTED', message: 'שיתוף עוגיות זמין רק בגרסת התוסף לכרום' } };
        },
      },
    };
  })();

  // מיזוג קובצי DASH של יוטיוב (MP4 מפוצל) לקובץ MP4 אחד – בלי ffmpeg.
  // כל קלט הוא קובץ שלם עם moov אחד ורצף של moof+mdat. הפלט: moov משותף
  // שבו כל track מקבל מזהה משלו, והמקטעים משתלבים לפי זמן.
  const Mux = (() => {
    const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const w32 = (b, o, v) => {
      b[o] = v >>> 24; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255;
    };
    const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
    const fail = () => { throw new Error('מבנה הקובץ שיוטיוב שלח לא נתמך'); };

    function list(b, start, end) {
      const out = [];
      for (let o = start; o + 8 <= end;) {
        let size = u32(b, o), hdr = 8;
        if (size === 1) { size = u32(b, o + 8) * 4294967296 + u32(b, o + 12); hdr = 16; }
        else if (size === 0) size = end - o;
        if (size < hdr || o + size > end) fail();
        out.push({ type: String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), start: o, body: o + hdr, end: o + size });
        o += size;
      }
      return out;
    }
    const find = (b, parent, type) => (parent && list(b, parent.body, parent.end).find(x => x.type === type)) || fail();

    function box(type, parts) {
      const len = 8 + parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(len);
      w32(out, 0, len);
      out.set(ascii(type), 4);
      let o = 8;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    }

    function parse(b) {
      const top = list(b, 0, b.length);
      const moov = top.find(x => x.type === 'moov') || fail();
      const trak = find(b, moov, 'trak');
      const mdhd = find(b, find(b, trak, 'mdia'), 'mdhd');
      const timescale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
      const frags = [];
      for (let i = 0; i + 1 < top.length; i++) {
        if (top[i].type !== 'moof' || top[i + 1].type !== 'mdat') continue;
        const moof = top[i], traf = find(b, moof, 'traf'), tfhd = find(b, traf, 'tfhd');
        if (u32(b, tfhd.body) & 1) fail(); // base_data_offset מוחלט – ישתבש אחרי הזזה
        const tfdt = list(b, traf.body, traf.end).find(x => x.type === 'tfdt');
        const t = !tfdt ? 0 : b[tfdt.body] === 1
          ? u32(b, tfdt.body + 4) * 4294967296 + u32(b, tfdt.body + 8)
          : u32(b, tfdt.body + 4);
        frags.push({
          time: t / timescale,
          start: moof.start,
          end: top[i + 1].end,
          tfhd: tfhd.body + 4,
          mfhd: find(b, moof, 'mfhd').body + 4,
        });
      }
      if (!frags.length) fail();
      return { b, moov, trak, frags };
    }

    // inputs: מערך Uint8Array (וידאו ואז אודיו, או רק אודיו). מחזיר חלקים ל-Blob.
    function build(inputs, durationSec) {
      const tracks = inputs.map(parse);
      const first = tracks[0];
      const mvhd = first.b.slice(...(({ start, end }) => [start, end])(find(first.b, first.moov, 'mvhd')));
      const v1 = mvhd[8] === 1;
      const scale = u32(mvhd, v1 ? 28 : 20);
      const dur = durationSec > 0 ? Math.round(durationSec * scale) : 0;
      if (dur) {
        if (v1) { w32(mvhd, 32, Math.floor(dur / 4294967296)); w32(mvhd, 36, dur >>> 0); }
        else w32(mvhd, 24, dur);
      }
      w32(mvhd, v1 ? 116 : 104, tracks.length + 1); // next_track_ID

      const mvex = [];
      if (dur) {
        const mehd = new Uint8Array(8);
        w32(mehd, 4, Math.min(dur, 0xffffffff));
        mvex.push(box('mehd', [mehd]));
      }
      const traks = tracks.map((t, i) => {
        const trex = find(t.b, find(t.b, t.moov, 'mvex'), 'trex');
        const trexCopy = t.b.slice(trex.start, trex.end);
        w32(trexCopy, 12, i + 1);
        mvex.push(trexCopy);

        const trak = t.b.slice(t.trak.start, t.trak.end);
        const tkhd = list(trak, 8, trak.length).find(x => x.type === 'tkhd') || fail();
        const tv1 = trak[tkhd.body] === 1;
        w32(trak, tkhd.body + (tv1 ? 20 : 12), i + 1);
        if (dur) {
          if (tv1) { w32(trak, tkhd.body + 28, Math.floor(dur / 4294967296)); w32(trak, tkhd.body + 32, dur >>> 0); }
          else w32(trak, tkhd.body + 20, dur);
        }
        return trak;
      });

      const parts = [
        box('ftyp', [ascii('isom'), new Uint8Array([0, 0, 2, 0]), ascii('isomiso2iso6avc1mp41')]),
        box('moov', [mvhd, box('mvex', mvex), ...traks]),
      ];
      const frags = tracks
        .flatMap((t, i) => t.frags.map(f => ({ ...f, b: t.b, id: i + 1 })))
        .sort((a, b) => a.time - b.time || a.id - b.id);
      let seq = 1;
      for (const f of frags) {
        w32(f.b, f.tfhd, f.id);
        w32(f.b, f.mfhd, seq++);
        parts.push(f.b.subarray(f.start, f.end));
      }
      return parts;
    }

    return { build };
  })();

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

  // ---------- 2. ניגון ברקע ----------

  const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  const realVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

  Object.defineProperty(Document.prototype, 'hidden', {
    configurable: true, enumerable: true,
    get() { return S.background ? false : realHidden.get.call(this); },
  });
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true, enumerable: true,
    get() { return S.background ? 'visible' : realVisibility.get.call(this); },
  });
  for (const name of ['webkitHidden', 'webkitVisibilityState']) {
    const real = Object.getOwnPropertyDescriptor(Document.prototype, name);
    if (!real) continue;
    Object.defineProperty(Document.prototype, name, {
      configurable: true, enumerable: true,
      get() { return S.background ? (name === 'webkitHidden' ? false : 'visible') : real.get.call(this); },
    });
  }

  // מתי הדף באמת הוסתר – לפי הערך האמיתי, לפני שחוסמים את האירוע.
  let hiddenAt = 0;
  for (const target of [window, document]) {
    for (const ev of ['visibilitychange', 'webkitvisibilitychange']) {
      target.addEventListener(ev, e => {
        if (target === window && realHidden.get.call(document)) hiddenAt = Date.now();
        if (S.background) e.stopImmediatePropagation();
      }, true);
    }
  }

  // במובייל ובמיוזיק הנגן עוצר גם על blur של החלון (מעבר אפליקציה / מסך נעול).
  // חוסמים רק blur של window עצמו – blur של שדות ותפריטים ממשיך כרגיל. ב-www לא צריך
  // (blur שם קורה גם כשסתם עוברים לחלון אחר, ולא עוצר את הנגן).
  window.addEventListener('blur', e => {
    if (!S.background || e.target !== window || SITE === 'www') return;
    hiddenAt = Date.now();
    e.stopImmediatePropagation();
  }, true);

  // עצירה שהמשתמש ביקש דרך כפתורי המדיה (התראה, מקלדת, אוזניות) – לא מחדשים אחריה.
  let mediaPauseAt = 0;
  try {
    const ms = navigator.mediaSession;
    const set = ms && ms.setActionHandler;
    if (set) {
      ms.setActionHandler = function (action, handler) {
        if ((action === 'pause' || action === 'stop') && typeof handler === 'function') {
          const orig = handler;
          handler = function () { mediaPauseAt = Date.now(); return orig.apply(this, arguments); };
        }
        return set.call(this, action, handler);
      };
    }
  } catch {}

  // הנגן עצר את הסרטון מיד אחרי שהדף הוסתר (ולא בגלל המשתמש) – ממשיכים לנגן.
  document.addEventListener('pause', e => {
    const v = e.target;
    if (!S.background || !(v instanceof HTMLMediaElement) || v.ended) return;
    const now = Date.now();
    if (now - hiddenAt > 1000 || now - mediaPauseAt < 2000) return;
    if (v.closest(PREVIEW_SEL)) return;
    if (document.querySelector('.html5-video-player.ad-showing')) return;
    setTimeout(() => { if (v.paused && !v.ended) v.play().catch(() => {}); }, 50);
  }, true);

  // "הסרטון הושהה. להמשיך לצפות?" ב-www מגיע כ-yt-confirm-dialog-renderer רגיל, אז בודקים
  // שזה באמת הדיאלוג הזה (youThereRenderer בנתונים או הטקסט המוכר) – לא לוחצים על שום דיאלוג אחר.
  const IDLE_TEXT = /continue watching|still watching|להמשיך (?:לצפות|בצפייה)|עדיין צופים/i;

  function isIdlePrompt(dialog) {
    try {
      const data = dialog.data || dialog.polymerController?.data || dialog.__data?.data;
      if (data && /youThere/i.test(JSON.stringify(data).slice(0, 4000))) return true;
    } catch {}
    const text = (dialog.querySelector('#main, yt-formatted-string#title, #scrollable') || dialog).textContent || '';
    return text.length < 200 && IDLE_TEXT.test(text);
  }

  function dismissIdlePrompt() {
    if (!S.background) return;
    // מיוזיק ומובייל: רכיב ייעודי, בטוח ללחוץ.
    document.querySelector('ytmusic-you-there-renderer button, ytmusic-you-there-renderer tp-yt-paper-button, ytm-you-there-renderer button')?.click();
    for (const dialog of document.querySelectorAll('ytd-popup-container yt-confirm-dialog-renderer')) {
      if (!dialog.getClientRects().length || !isIdlePrompt(dialog)) continue;
      const ok = dialog.querySelector('#confirm-button button, #confirm-button tp-yt-paper-button, #confirm-button');
      if (!ok) continue;
      ok.click();
      const v = mainVideo();
      if (v && v.paused && !v.ended) v.play().catch(() => {});
    }
  }

  function keepAwake() {
    if (!S.background) return;
    // יוטיוב מחשב חוסר פעילות לפי _lact ושואל "עדיין צופים?"
    window._lact = Date.now();
    dismissIdlePrompt();
  }

  // keepAwake רץ פעם בדקה מ-main; הדיאלוג עוצר את הסרטון מיד, אז בודקים אותו לעתים קרובות יותר.
  setInterval(() => { try { dismissIdlePrompt(); } catch {} }, 2000);

  // ---------- 3. תמונה בתוך תמונה ----------

  // הסרטון לחלון הצף: הריל הפעיל בשורטס, הנגן של מיוזיק, ולא תצוגה מקדימה מדף הבית.
  function pipVideo() {
    return mainVideo() || video();
  }

  async function openPip(v) {
    v.disablePictureInPicture = false;
    v.removeAttribute('disablepictureinpicture');
    await v.requestPictureInPicture();
  }

  // שורטס: כל ריל הוא אלמנט video אחר. כשגוללים בזמן שהחלון הצף פתוח – מעבירים אותו לריל החדש
  // (כשכבר יש חלון צף, הדפדפן לא דורש לחיצה של המשתמש).
  document.addEventListener('playing', e => {
    const cur = document.pictureInPictureElement, v = e.target;
    if (!S.pip || !cur || cur === v || !(v instanceof HTMLVideoElement) || !onShorts()) return;
    if (!cur.paused || v.closest(PREVIEW_SEL) || !v.videoWidth) return;
    openPip(v).catch(() => {});
  }, true);

  let autoPipOn = null;
  let pageSetPipHandler = null;
  const autoPipHandler = () => {
    const v = pipVideo();
    if (v && !v.paused && v.videoWidth && !document.pictureInPictureElement) openPip(v).catch(() => {});
  };

  // אם יוטיוב ירשום בעתיד handler משלו ל-enterpictureinpicture – לא נדרוס אותו ולא הוא אותנו.
  try {
    const ms = navigator.mediaSession;
    const set = ms && ms.setActionHandler;
    if (set) {
      ms.setActionHandler = function (action, handler) {
        if (action === 'enterpictureinpicture') {
          pageSetPipHandler = handler;
          if (autoPipOn) return;
        }
        return set.apply(this, arguments);
      };
    }
  } catch {}

  function applyAutoPip() {
    // רק ב-m.youtube (כמו Premium בטלפון). www ו-Music בדסקטופ לא נכנסים לחלון צף לבד – לא נוגעים בהתנהגות של יוטיוב
    const want = !!(S.pip && S.autoPip && SITE === 'mobile');
    if (want === autoPipOn || !navigator.mediaSession) return;
    const first = autoPipOn === null;
    autoPipOn = want;
    if (first && !want) return; // לא רשמנו כלום – אין מה להחזיר
    try {
      // קוראים ישירות ל-prototype כדי לעקוף את העטיפות שלמעלה.
      MediaSession.prototype.setActionHandler.call(navigator.mediaSession, 'enterpictureinpicture', want ? autoPipHandler : pageSetPipHandler);
    } catch {}
  }

  // ---------- 4. איכות מרבית ----------

  let qualityDoneFor = '';

  // המשתמש בחר איכות בעצמו בתפריט – לא נוגעים יותר בסרטון הזה.
  function markManualQuality(e) {
    if (!e.isTrusted) return;
    const t = e.target;
    const inMenu = t.closest?.('.ytp-quality-menu .ytp-menuitem');
    const mobileSelect = t.tagName === 'SELECT' && [...t.options].some(o => /\d{3,4}p/.test(o.textContent));
    if (inMenu || mobileSelect) qualityDoneFor = videoId() || qualityDoneFor;
  }
  document.addEventListener('click', markManualQuality, true);
  document.addEventListener('change', markManualQuality, true);

  // איכויות שרק מנויי Premium יכולים לבחור ("1080p Premium") – הבחירה בהן נכשלת או פותחת הצעה.
  const isPaygated = q => !!(q.paygatedQualityDetails || /premium/i.test(q.qualityLabel || ''));

  function applyQuality() {
    const id = videoId();
    if (!S.maxQuality || !id || qualityDoneFor === id) return;
    const p = activePlayer();
    if (!p || typeof p.getAvailableQualityLevels !== 'function') return;
    if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) return;
    // במעבר SPA הנגן עוד מחזיק את הסרטון הקודם – מחכים שיתעדכן, אחרת נסמן את החדש כגמור.
    try {
      const current = p.getVideoData?.()?.video_id;
      if (current && current !== id) return;
    } catch {}
    // מיוזיק במצב שיר (שמע בלבד): אין איכות וידאו לבחור, ומתג השמע/וידאו הוא של המשתמש.
    if (SITE === 'music' && document.querySelector('ytmusic-player[playback-mode="ATV_PREFERRED"]')) {
      qualityDoneFor = id;
      return;
    }
    const levels = p.getAvailableQualityLevels() || [];
    if (!levels.length || levels[0] === 'auto') return;
    let best = levels.find(q => q !== 'auto');
    try {
      const data = p.getAvailableQualityData?.() || [];
      const playable = data.filter(q => q.isPlayable !== false && q.quality !== 'auto' && !isPaygated(q));
      if (playable.length) best = playable[0].quality;
      else if (data.length) return;
    } catch {}
    if (!best) return;
    p.setPlaybackQualityRange?.(best, best);
    p.setPlaybackQuality?.(best);
    qualityDoneFor = id;
  }

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
  const SPEED_KEY = 'ytu-speed';

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

  const speedStore = {
    get() { try { const r = +localStorage.getItem(SPEED_KEY); return r > SPEED_YT_MAX && r <= SPEED_MAX ? r : null; } catch { return null; } },
    set(r) { try { if (r > SPEED_YT_MAX) localStorage.setItem(SPEED_KEY, String(r)); else localStorage.removeItem(SPEED_KEY); } catch {} },
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
    // מסנכרנים את הנגן של יוטיוב (מה שנשמר לסרטון הבא) עד המקסימום שלו.
    ytSetRate(p, Math.min(rate, SPEED_YT_MAX));
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
    // הנגן כבר תומך ב-Premium בעצמו (ושומר את המהירות ב-yt-player-playback-rate) – הגיבוי לא מתחרה בו
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
  const CHUNK = 10 * 1024 * 1024;

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
    const r = await fetch(location.origin + '/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', credentials: 'omit', headers, signal,
      body: JSON.stringify({ context: { client: { ...client, hl } }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    });
    if (!r.ok) throw new Error(r.status === 418
      ? dlT(DL_ERRORS.BLOCKED_418[0], DL_ERRORS.BLOCKED_418[1])
      : dlT('יוטיוב החזיר שגיאה ', 'YouTube returned an error ') + r.status);
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
    const audio = formats
      .filter(f => f.mimeType.startsWith('audio/mp4'))
      .sort((a, b) => b.bitrate - a.bitrate)[0];

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
      title: data.videoDetails?.title || document.title.replace(/ - YouTube.*$/, ''),
      author: data.videoDetails?.author || '',
      length: +data.videoDetails?.lengthSeconds || 0,
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

    const ranges = [];
    for (let a = 0; a < total; a += CHUNK) ranges.push([a, Math.min(a + CHUNK, total) - 1]);
    // תקלה סופית באחד החלקים עוצרת גם את השאר – בלי עוד בקשות שייכשלו (403 על קישור שפג וכו')
    const stop = new AbortController();
    let fatal = null;
    const onAbort = () => stop.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const worker = async () => {
      for (let range; !stop.signal.aborted && (range = ranges.shift());) {
        let [pos, end] = range, tries = 0;
        while (pos <= end) {
          try {
            const r = await fetch(`${format.url}&range=${pos}-${end}`, { signal: stop.signal, credentials: 'omit', cache: 'no-store' });
            if (!r.ok) {
              const err = new Error(dlT('ההורדה נכשלה (', 'Download failed (') + r.status + ')');
              // 4xx לא מסתדר בניסיון חוזר (403 = הקישור פג / נחסם); 429 כן
              err.fatal = r.status >= 400 && r.status < 500 && r.status !== 429;
              err.expired = r.status === 403;
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
            if (e.fatal || ++tries > 4) { fatal = fatal || e; stop.abort(); throw e; }
            await sleep(1000 * tries);
          }
        }
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
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

  // ---------- שרת ה-Drive: קבועים מ-drive-client.js, עם גיבוי אם הקובץ חסר ----------

  const DL_FALLBACK_ACTIVE = ['queued', 'checking', 'downloading', 'converting', 'copying', 'uploading', 'shortening'];

  const dActive = () => (typeof DRIVE_ACTIVE_STATES !== 'undefined' && DRIVE_ACTIVE_STATES) || DL_FALLBACK_ACTIVE;
  const dHint = code => ((typeof DRIVE_ERROR_HINT !== 'undefined' && DRIVE_ERROR_HINT) || {})[code] || '';
  const hasDrive = () => typeof Platform !== 'undefined' && !!Platform.drive && typeof Platform.drive.start === 'function';
  const isActiveJob = j => dActive().includes(j.state);
  const dlMethod = () => (['auto', 'browser', 'server'].includes(S.downloadMethod) ? S.downloadMethod : 'auto');

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
  // השרת (Drive) עובד מאחורי הקלעים לפי downloadMethod: ב-auto – דפדפן, ובכישלון שרת בלי לשאול.

  // סולם האיכויות של Premium בדסקטופ (השמות מגיעים מהשרת; "שמע בלבד" נשאר אחרון – יש אותו רק אצלנו)
  const DL_CHOICES = [
    { value: '1080', he: 'Full HD (1080p)', en: 'Full HD (1080p)', height: 1080 },
    { value: '720', he: 'גבוהה (720p)', en: 'High (720p)', height: 720 },
    { value: '360', he: 'בינונית (360p)', en: 'Medium (360p)', height: 360 },
    { value: '144', he: 'נמוכה (144p)', en: 'Low (144p)', height: 144 },
    { value: 'audio', he: 'שמע בלבד', en: 'Audio only', height: 0 },
  ];
  // ערכים מגרסה 2.1.0 (גבוהה 1080 / בינונית 720 / נמוכה 360)
  const DL_LEGACY_CHOICE = { high: '1080', medium: '720', low: '360' };
  const dlNormChoice = v => {
    const x = DL_LEGACY_CHOICE[v] || String(v == null ? '' : v);
    return DL_CHOICES.some(c => c.value === x) ? x : null;
  };
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

  let dlBusy = null;      // הורדה שרצה עכשיו: { id, abort?, kind: 'browser'|'server', localId?, percent, preparing }
  const dlQueue = [];     // הורדות שמחכות: [{ id, choice }]
  const dlSession = { total: 0, done: 0 }; // כמו manualSessionTotalDownloads / manualSessionDownloaded
  let dlToast = null, dlToastClosed = false, dlToastHold = 0;
  const dlFailed = new Map();     // id → הבחירה האחרונה (הכפתור מציג "ניסיון חוזר")
  let dlDialog = null;    // { id, close, back }
  let dlListening = false;
  const dlInfo = new Map();       // id → Promise<info> (רשימת הפורמטים, לגדלים בדיאלוג ולהורדה)
  const dlServerJobs = new Map(); // localId → { id, choice, meta }

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

  function dlGetInfo(id) {
    let p = dlInfo.get(id);
    if (!p) {
      p = fetchStreams(id);
      dlInfo.set(id, p);
      // תקלה לא נשמרת, וקישורי ההורדה פגים אחרי כמה שעות
      p.catch(() => { if (dlInfo.get(id) === p) dlInfo.delete(id); });
      setTimeout(() => { if (dlInfo.get(id) === p) dlInfo.delete(id); }, 60 * 60 * 1000);
    }
    return p;
  }

  // הפורמט לבחירה: הכי גבוה עד הגובה המבוקש; אם אין – הכי נמוך שיש
  function dlPickVideo(info, choice) {
    const c = DL_CHOICES.find(x => x.value === dlNormChoice(choice));
    if (!c || !c.height || !info.videos.length) return null;
    const avc = f => (/avc1/.test(f.mimeType) ? 1 : 0);
    const list = [...info.videos].sort((a, b) => b.height - a.height || avc(b) - avc(a));
    return list.find(v => v.height <= c.height) || list[list.length - 1];
  }

  // הגודל המשוער בצד ימין של השורה (approximateSize)
  function dlSizeText(info, choice) {
    const size = f => +(f && f.contentLength) || 0;
    if (choice === 'audio') return size(info.audio) ? mb(size(info.audio)) : '';
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
      sub: busy.kind === 'browser' ? MSG.keepOpen() : null,
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

  // ---------- יציאה מהדף באמצע הורדה בדפדפן / כשיש תור (כמו boundBeforeUnload של יוטיוב) ----------

  const dlWantsUnloadGuard = () => !!((dlBusy && dlBusy.kind === 'browser') || dlQueue.length);
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
    if (el.hasAttribute(DL_MENU_ITEM_ATTR)) return videoId();
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
      if (busy.kind === 'browser') dlCancel(busy); else dlForgetServer(busy);
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
        if (busy && busy.kind === 'browser') dlCancel(busy);
        else if (busy) dlForgetServer(busy);
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
    const method = hasDrive() ? dlMethod() : 'browser';
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
    const rows = DL_CHOICES.map(c => {
      const radio = h('input', { type: 'radio', class: 'dq-radio', name: 'ytu-dl-quality', value: c.value,
        onchange: () => { chosen = c.value; okBtn.disabled = false; } });
      if (c.value === last) radio.setAttribute('data-last', '');
      const aside = h('div', { class: 'dq-aside' }, '');
      asides.set(c.value, aside);
      return h('label', { class: 'dq-row', 'data-choice': c.value },
        h('div', { class: 'dq-start' }, radio, h('div', { class: 'dq-label' }, dlT(c.he, c.en))),
        h('div', { class: 'dq-end' }, aside));
    });
    const remember = h('input', { type: 'checkbox', class: 'dq-check' });
    const body = h('div', { class: 'dq' },
      h('div', { class: 'dq-list', role: 'radiogroup' }, rows),
      h('label', { class: 'dq-remember' }, remember, h('span', null, MSG.remember())));

    const cancelBtn = dlButton(MSG.cancel(), 'dq-cancel', () => dlg.close(false));
    dlg = ytDialog({
      title: MSG.quality(), body, actions: [cancelBtn, okBtn], className: 'dq-dialog',
      onClose: () => { if (dlDialog && dlDialog.back === dlg.back) dlDialog = null; },
    });
    dlDialog = { id, close: dlg.close, back: dlg.back };
    cancelBtn.focus();

    // גדלים לפי מה שיוטיוב מחזיר (לא בשיטת "רק שרת")
    if (method !== 'server') {
      dlGetInfo(id).then(info => {
        if (!dlg.back.isConnected) return;
        for (const [value, aside] of asides) aside.textContent = dlSizeText(info, value);
      }).catch(() => {});
    }
  }

  function dlCancel(busy) {
    if (!busy || dlBusy !== busy) return;
    if (busy.abort) busy.abort.abort();
    dlFinish(busy, null, true);
  }

  function dlForgetServer(busy) {
    if (!busy || dlBusy !== busy) return;
    if (busy.localId) dlServerJobs.delete(busy.localId);
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
    if (busy) {
      if (dlBusy === busy) dlBusy = null;
      clearTimeout(busy.resync);
    }
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
    NETFREE_BLOCKED: ['הסרטון חסום בסינון. אפשר לבקש פתיחה ולנסות שוב אחרי האישור.', 'The video is blocked by the content filter. You can request access and try again.'],
    NETFREE_PENDING: ['הסינון עוד לא בדק את הסרטון. נסו שוב בעוד כמה דקות.', "The content filter hasn't checked this video yet. Try again in a few minutes."],
    NETFREE_STREAM_BLOCKED: ['קובץ הווידאו נחסם בסינון. אפשר להוריד שמע בלבד.', 'The video file is blocked by the content filter. You can download audio only.'],
    VIDEO_FILE_BLOCKED: ['קובץ הווידאו נחסם בסינון. אפשר להוריד שמע בלבד.', 'The video file is blocked by the content filter. You can download audio only.'],
    YT_PRIVATE: ['הסרטון פרטי.', 'This video is private.'],
    YT_UNAVAILABLE: ['הסרטון לא זמין.', 'This video is unavailable.'],
    YT_AGE_RESTRICTED: ['הסרטון מוגבל לפי גיל.', 'This video is age-restricted.'],
    LIVE_NOT_SUPPORTED: ['אי אפשר להוריד שידור חי.', "Live streams can't be downloaded."],
    TOO_LONG: ['הסרטון ארוך מדי לשרת ההורדה.', 'This video is too long for the download server.'],
    DRIVE_FULL: ['האחסון בדרייב מלא.', 'Google Drive storage is full.'],
    QUEUE_FULL: ['שרת ההורדה עמוס. נסו שוב בעוד כמה דקות.', 'The download server is busy. Try again in a few minutes.'],
    RATE_LIMIT: ['יותר מדי הורדות. נסו שוב בעוד שעה.', 'Too many downloads. Try again in an hour.'],
    UNAUTHORIZED: ['מפתח ה-API של שרת ההורדה שגוי.', 'The download server API key is wrong.'],
    SERVER_OFFLINE: ['שרת ההורדה לא זמין כרגע. נסו שוב מאוחר יותר.', 'The download server is offline. Try again later.'],
    CLIENT_BLOCKED: ['כתובת שרת ההורדה חסומה בסינון.', 'The download server address is blocked by the content filter.'],
    NETWORK: ['אין חיבור לשרת ההורדה. נסו שוב.', "Couldn't reach the download server. Try again."],
    TIMEOUT: ['התוסף לא ענה בזמן. נסו שוב.', "The extension didn't respond in time. Try again."],
    JOB_NOT_FOUND: ['שרת ההורדה הופעל מחדש. התחילו את ההורדה שוב.', 'The download server restarted. Start the download again.'],
    BAD_RESPONSE: ['תשובה לא צפויה משרת ההורדה. נסו שוב בעוד רגע.', 'Unexpected response from the download server. Try again in a moment.'],
    DOWNLOAD_FAILED: ['ההורדה בשרת נכשלה.', 'The download failed on the server.'],
    EXTENSION_ERROR: ['אין חיבור לתוסף. רעננו את הדף ונסו שוב.', "Can't reach the extension. Reload the page and try again."],
    UNSUPPORTED: ['לא זמין בגרסה הזו.', 'Not available in this version.'],
  };

  // טוסט כישלון של השרת: "ההורדה נכשלה" ("האחסון מלא" כשהדרייב מלא), והסבר קצר לפי קוד כשיש
  function dlServerFailToast(err) {
    const code = err && err.code;
    if (code === 'DRIVE_FULL') return { text: MSG.storageFull() };
    let sub = DL_ERRORS[code] ? dlErrorDetail(err) : '';
    if (code === 'YT_BOT_CHECK') {
      sub = Platform.drive.canShareCookies && !S.shareCookies
        ? dlT('יוטיוב חסם זמנית את שרת ההורדה. אפשר להפעיל "שיתוף עוגיות" בחלון התוסף.', 'YouTube temporarily blocked the download server. You can turn on "Share cookies" in the extension popup.')
        : dlT('יוטיוב חסם זמנית את שרת ההורדה. נסו שוב בעוד כחצי שעה.', 'YouTube temporarily blocked the download server. Try again in about half an hour.');
    }
    return { text: MSG.failed(), sub: sub || null };
  }

  // הסבר לפי קוד; בעברית אפשר גם את ההודעה מהשרת
  function dlErrorDetail(err) {
    err = err || {};
    const known = DL_ERRORS[err.code];
    if (known) return dlT(known[0], known[1]);
    if (typeof uiHebrew === 'function' && !uiHebrew()) return '';
    return [err.message, dHint(err.code)].filter(Boolean).join(' ');
  }

  // ---------- ההורדה ----------

  // התחלת הורדה. אם הורדה אחרת רצה – נכנסת לתור (הכפתור מציג "יורד" עם טבעת ב-0)
  async function startDownload(id, choice) {
    choice = dlNormChoice(choice) || '720';
    if ((dlBusy && dlBusy.id === id) || dlIsQueued(id)) return;
    dlFailed.delete(id);
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

  async function runDownload(id, choice) {
    const method = hasDrive() ? dlMethod() : 'browser';
    if (method === 'server') return serverDownload(id, choice);
    let busy = null;
    try {
      await browserDownload(id, choice, b => { busy = b; });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // בוטל – dlCancel כבר סיים
      // קישור שפג (403) – בניסיון הבא מבקשים קישורים חדשים
      if (e && e.expired && dlInfo.has(id)) dlInfo.delete(id);
      // ב-auto: ממשיכים דרך השרת באותו מקום בסשן (לא נספר כהורדה נוספת)
      if (method === 'auto' && hasDrive()) {
        if (busy && dlBusy === busy) dlBusy = null;
        return serverDownload(id, choice, true);
      }
      // "ההורדה נכשלה" כמו ביוטיוב; הסבר קצר רק כשיוטיוב נתן סיבה (סרטון פרטי וכו'), "האחסון מלא" כשאין זיכרון
      const full = e && (e.name === 'RangeError' || e.tooLarge);
      dlFail(busy, id, choice, { text: full ? MSG.storageFull() : MSG.failed(), sub: (e && e.ytReason && e.message) || null });
    }
  }

  async function browserDownload(id, choice, onBusy) {
    const abort = new AbortController();
    const busy = dlBusy = { id, choice, abort, kind: 'browser', percent: null, preparing: true, meta: dlMeta(id) };
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
      const v = choice === 'audio' ? null : dlPickVideo(info, choice);
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
      const parts = Mux.build(buffers, info.length);
      const name = safeName(info.title) + (v ? '.mp4' : '.m4a');
      saveFile(parts, name, v ? 'video/mp4' : 'audio/mp4');
      dlSetDone(id, true, dlMeta(id, info));
      // "הורדת" + "לצפייה בסרטון" (A2N ב-kevlar_base)
      dlFinish(busy, { text: MSG.downloaded(), action: dlViewAction() });
    } catch (e) {
      if (abort.signal.aborted) throw aborted();
      throw e;
    }
  }

  // האיכות בשרת: הגובה הקרוב שהשרת מכיר (DRIVE_QUALITIES: 1080/720/480/360)
  function dlServerQuality(choice) {
    if (choice === 'audio') return { type: 'audio', quality: 'm4a' };
    const c = DL_CHOICES.find(x => x.value === choice);
    const height = c ? c.height : 720;
    const q = [1080, 720, 480, 360].find(x => x <= height) || 360;
    return { type: 'video', quality: String(q) };
  }

  function listenJobs() {
    if (dlListening || !hasDrive() || typeof Platform.drive.onJob !== 'function') return;
    dlListening = true;
    Platform.drive.onJob(j => { try { onServerJob(j); } catch {} });
  }

  async function serverDownload(id, choice, fallback) {
    if (dlBusy) return;
    if (!hasDrive()) return dlFail(null, id, choice, { text: MSG.failed() });
    listenJobs();
    const { type, quality } = dlServerQuality(choice);
    const busy = dlBusy = { id, choice, kind: 'server', percent: null, preparing: true, meta: dlMeta(id) };
    dlUpdateUnload();
    refreshDownloadButtons();
    dlShowProgress(busy);
    let r, meta = null;
    try {
      let info = null;
      try { if (dlInfo.has(id)) info = await dlInfo.get(id); } catch {}
      meta = dlMeta(id, info);
      busy.meta = meta;
      r = await Platform.drive.start({ url: 'https://www.youtube.com/watch?v=' + id, videoId: id, type, quality, title: meta.title });
    } catch (e) {
      r = { ok: false, error: { code: 'INTERNAL', message: e.message } };
    }
    if (dlBusy !== busy) return; // בוטל בינתיים
    if (r && r.job) {
      busy.localId = r.job.localId;
      dlServerJobs.set(r.job.localId, { id, choice, meta });
      onServerJob(r.job);
    } else {
      dlFail(busy, id, choice, dlServerFailToast(r && r.error));
    }
  }

  function onServerJob(j) {
    if (!j || !j.localId) return;
    const mine = dlServerJobs.get(j.localId);
    if (!mine) return;
    const busy = dlBusy && dlBusy.localId === j.localId ? dlBusy : null;
    if (isActiveJob(j)) {
      if (busy) {
        busy.preparing = j.state === 'queued' || j.state === 'checking';
        busy.percent = j.state === 'downloading' && typeof j.percent === 'number' ? j.percent
          : ['converting', 'copying', 'uploading', 'shortening'].includes(j.state) ? 99 : busy.percent;
        refreshDownloadButtons();
        dlShowProgress(busy);
      }
      return;
    }
    const code = j.error && j.error.code;
    // שיתוף עוגיות פעיל בתוסף: ה-service worker מנסה שוב באותה עבודה
    // ה-service worker מסמן cookieRetryDeclined כשהניסיון לא יוצא לדרך; בנוסף בודקים שוב מעצמנו,
    // כדי שהכפתור לא יישאר מסתובב אם השידור הלך לאיבוד
    if (j.state === 'error' && code === 'YT_BOT_CHECK' && S.shareCookies && Platform.drive.canShareCookies
      && !j.cookieRetry && !j.cookieRetryDeclined && !mine.gaveUp) {
      if (busy) dlResyncLater(busy, j);
      return;
    }
    dlServerJobs.delete(j.localId);
    if (j.state === 'done') {
      dlSetDone(mine.id, true, { ...(mine.meta || {}), title: (mine.meta && mine.meta.title) || j.title || '' });
      // www: "לצפייה בסרטון" פותח את דף ההורדות כמו ב-Premium; באתרים בלי דף הורדות – הקובץ בדרייב
      const url = j.drive_url || j.short_url || j.view_url;
      const action = dlViewAction() || (url ? { label: MSG.view(), run: () => window.open(url, '_blank', 'noopener') } : null);
      const endToast = { text: MSG.downloaded(), action };
      if (busy) dlFinish(busy, endToast);
      else ytToast(endToast);
      return;
    }
    const endToast = dlServerFailToast(j.error);
    if (busy) dlFail(busy, mine.id, mine.choice, endToast);
    else { dlFailed.set(mine.id, mine.choice); refreshDownloadButtons(); ytToast(endToast); }
  }

  // ממתינים לניסיון החוזר עם עוגיות: כל 30 שניות בודקים את רשימת העבודות, ואחרי 5 דקות בלי שינוי מסיימים
  const DL_RESYNC_MS = 30 * 1000;
  const DL_RESYNC_MAX = 5 * 60 * 1000;
  function dlResyncLater(busy, j) {
    if (busy.resync) return;
    const started = Date.now();
    const check = async () => {
      busy.resync = 0;
      if (dlBusy !== busy) return;
      let cur = null;
      try { cur = (await Platform.drive.jobs()).find(x => x && x.localId === j.localId) || null; } catch {}
      if (dlBusy !== busy) return;
      const waiting = !cur || (cur.state === 'error' && !cur.cookieRetry && !cur.cookieRetryDeclined);
      if (!waiting) return onServerJob(cur);
      if (Date.now() - started >= DL_RESYNC_MAX) {
        const mine = dlServerJobs.get(j.localId);
        if (mine) mine.gaveUp = true;
        return onServerJob(cur || j);
      }
      busy.resync = setTimeout(check, DL_RESYNC_MS);
    };
    busy.resync = setTimeout(check, DL_RESYNC_MS);
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

  // ---------- ממשק בתוך יוטיוב: רק במקומות של יוטיוב, בעיצוב של יוטיוב ----------
  // אין כפתור בנגן, אין כפתור צף ואין חלונית משלנו. מה שנשאר כאן:
  // - host עם shadow סגור לטוסט (yt-notification-action-renderer) ולדיאלוגים, בצבעים של יוטיוב (בהיר/כהה לפי ytDark()).
  // - confirmDialog – דיאלוג אישור בעיצוב של יוטיוב.
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
  .opt.col { flex-direction: column; align-items: stretch; gap: 8px; cursor: default; }
  .opt .txt { flex: 1; min-width: 0; }
  .opt small { display: block; color: var(--yt-text2); font-size: 12px; line-height: 18px; margin-top: 2px; }
  .sw { appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 36px; height: 14px; margin: 3px 3px; border-radius: 7px;
    background: var(--yt-track); cursor: pointer; transition: background .15s; }
  .sw::after { content: ''; position: absolute; top: -3px; inset-inline-start: -3px; width: 20px; height: 20px; border-radius: 50%; background: var(--yt-knob);
    box-shadow: 0 1px 5px rgba(0,0,0,.6); transition: inset-inline-start .15s, background .15s; }
  .sw:checked { background: var(--yt-track-on); }
  .sw:checked::after { inset-inline-start: 19px; background: var(--yt-blue); }
  select, input.text { font: 400 14px/20px Roboto, Arial, sans-serif; color: var(--yt-text); background: var(--yt-chip); border: 0; border-bottom: 1px solid var(--yt-line); border-radius: 8px 8px 0 0; padding: 8px 10px; }
  select { flex: none; max-width: 180px; cursor: pointer; }
  select option { background: var(--yt-raised); color: var(--yt-text); }
  input.text { width: 100%; direction: ltr; text-align: left; }
  input.text:focus { outline: none; border-bottom: 2px solid var(--yt-blue); }
  .test { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--yt-line); }
  .test span { flex: 1; color: var(--yt-text2); font-size: 12px; line-height: 18px; }
  .test span.ok { color: var(--yt-ok); }
  .test span.err { color: var(--yt-err); }
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

  // דיאלוג אישור. text: מחרוזת או מערך פסקאות
  function confirmDialog({ title, text, ok, cancel } = {}) {
    return new Promise(resolve => {
      const cancelBtn = h('button', { class: 'btn', onclick: () => dlg.close(false) }, cancel || uiText('ביטול', 'Cancel'));
      const okBtn = h('button', { class: 'btn filled', onclick: () => dlg.close(true) }, ok || uiText('אישור', 'OK'));
      const dlg = ytDialog({
        title,
        body: [].concat(text || []).map(t => h('p', null, t)),
        actions: [cancelBtn, okBtn],
        onClose: v => resolve(!!v),
      });
      cancelBtn.focus();
    });
  }

  // ---------- הגדרות (טמפרמונקי בלבד) ----------

  const settingLabel = s => uiText(s.label, s.labelEn);
  const settingDesc = s => uiText(s.desc || '', s.descEn);

  function settingHidden(s) {
    if (s.extensionOnly && Platform.kind !== 'extension') return true;
    // בתוסף המפתח, כתובת השרת והעוגיות נערכים רק בחלון התוסף – הדף לא יכול לשנות אותם
    if ((s.secret || s.popupOnly) && Platform.kind === 'extension') return true;
    return false;
  }

  function settingRow(s) {
    const desc = settingDesc(s);
    const text = h('div', { class: 'txt' }, settingLabel(s), desc ? h('small', null, desc) : null);
    if (s.type === 'select') {
      const opts = (s.options || []).map(o => h('option', { value: o.value, selected: String(S[s.key]) === String(o.value) }, uiText(o.label, o.labelEn)));
      return h('label', { class: 'opt' }, text, h('select', { onchange: e => update({ [s.key]: e.target.value }) }, opts));
    }
    if (s.type === 'text') {
      const input = h('input', {
        class: 'text', type: s.secret ? 'password' : 'text', value: S[s.key] == null ? '' : String(S[s.key]),
        spellcheck: false, autocomplete: 'off',
        onchange: e => update({ [s.key]: e.target.value.trim() || s.def }),
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
      return h('label', { class: 'opt col' }, text, input);
    }
    const box = h('input', { class: 'sw', type: 'checkbox', role: 'switch', checked: !!S[s.key] });
    box.addEventListener('change', async () => {
      const want = box.checked;
      if (want && s.confirm === 'cookies') {
        // בטמפרמונקי ההגדרה מוסתרת (extensionOnly); זה רק ליתר ביטחון
        box.checked = false;
        if (!await confirmDialog(COOKIE_WARNING)) return;
        box.checked = true;
      }
      update({ [s.key]: want });
    });
    return h('label', { class: 'opt' }, text, box);
  }

  function serverTestRow() {
    const out = h('span', null, uiText('בדיקה שהשרת זמין', 'Check that the server is reachable'));
    const btn = h('button', { class: 'btn tonal' }, uiText('בדיקת חיבור', 'Test connection'));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.className = '';
      out.textContent = uiText('בודק…', 'Checking…');
      const r = await Platform.drive.health().catch(e => ({ ok: false, error: { message: String(e && e.message || e) } }));
      btn.disabled = false;
      if (!out.isConnected) return;
      if (r && r.ok) {
        out.className = 'ok';
        out.textContent = uiText('מחובר', 'Connected');
      } else {
        const err = (r && r.error) || {};
        const hint = typeof DRIVE_ERROR_HINT !== 'undefined' && DRIVE_ERROR_HINT[err.code];
        out.className = 'err';
        out.textContent = (err.message || uiText('אין חיבור לשרת', 'No connection to the server')) + (hint ? ' ' + hint : '');
      }
    });
    return h('div', { class: 'test' }, out, btn);
  }

  function renderSettings(container) {
    const kids = [];
    for (const g of SETTING_GROUPS) {
      const items = SETTINGS.filter(s => s.group === g.id && !settingHidden(s));
      if (!items.length) continue;
      kids.push(h('div', { class: 'group' }, uiText(g.label, g.labelEn)), ...items.map(settingRow));
      if (g.id === 'drive' && Platform.drive && typeof Platform.drive.health === 'function') kids.push(serverTestRow());
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
    if (!box || (active && box.contains(active) && active.matches('input.text, select'))) return;
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

  // ---------- הגדרות וחיבור הכל ----------
  // אין ממשק משלנו בדף: הפיצ'רים שקופים או יושבים בתוך הרכיבים של יוטיוב.

  function applySettings() {
    styles.ads.disabled = !S.adblock;
    styles.promos.disabled = !S.hidePromos;
    applyAutoPip();
    try { applySpeedSetting(); } catch {}
    refreshSettingsDialog();
  }

  function update(patch) {
    Object.assign(S, patch);
    const saved = {};
    for (const s of SETTINGS) {
      // בתוסף הסוד, כתובת השרת וההסכמה לעוגיות נקבעים בחלון התוסף; הגשר שומר את הערכים הקיימים
      if ((s.secret || s.popupOnly) && Platform.kind === 'extension') continue;
      saved[s.key] = S[s.key];
    }
    Platform.save(storableSettings(saved));
    applySettings();
  }

  Platform.onChange(next => {
    Object.assign(S, DEFAULTS, migrateSettings(next));
    applySettings();
  });

  // פקודות מחלון התוסף. 'download' פותח את דיאלוג ההורדה של יוטיוב (download.js)
  Platform.onCommand(cmd => onReady(() => {
    if (cmd !== 'download' || !S.download) return;
    openDownloadDialog();
  }));

  window.addEventListener('yt-navigate-finish', () => {
    qualityDoneFor = '';
  });

  // כל רכיב בנפרד, כדי שתקלה באחד לא תעצור את השאר
  const TICK = [
    () => handleAds(),
    () => handlePromos(),
    () => applyQuality(),
    () => handleSpeed(),
    () => refreshDownloadButtons(),
    () => hookOfficialButtons(),
    // טמפרמונקי בלבד: פריט "הגדרות יוטיוב פרימיום" בתפריטים של יוטיוב
    () => ensureSettingsEntry(),
  ];

  onReady(() => {
    applySettings();
    setInterval(() => {
      for (const fn of TICK) {
        try { fn(); } catch {}
      }
    }, 500);
    setInterval(keepAwake, 60 * 1000);
  });
})();
