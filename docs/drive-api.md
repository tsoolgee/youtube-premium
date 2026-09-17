# שרת הורדה מיוטיוב לדרייב – API גרסה 1.3

התוסף → ממסר Apps Script → שרת ביתי (yt-dlp) → Google Drive. נטפרי חוסם את `ytdrive.tsoolgee.uk`, לכן עובדים דרך הממסר.
קוד רפרנס עובד: `Documents/CLAOD/yt-drive-server/extension/common.js` + `background.js`.

## מעטפת הממסר
תמיד `POST` לכתובת ה-exec, `Content-Type: text/plain;charset=utf-8` (בלי preflight), `redirect: "follow"` (חובה).
```json
{ "path": "/download", "key": "", "body": { "url": "https://youtu.be/…", "type": "audio", "quality": "mp3" } }
```
גוגל מחזיר לפעמים דף שגיאה חד-פעמי (לא JSON) – לנסות שוב 1-2 פעמים.
כתובת ברירת מחדל: `https://script.google.com/macros/s/AKfycbxewFuo8cSzfhhsGYsfwPD68MvB20UELCLXzazk6GbiWqCB5Y07IS5sYDAXjvhMVFMl/exec`

## נתיבים (כל תשובה עם `"ok": true/false`)
- `POST /download` body `{url, type: audio|video, quality}` – audio: `mp3|m4a`, video: `best|1080|720|480|360`. → `{ ok, job_id, state: "queued" }`
- `GET /status/<job_id>` (במעטפת בלי body), כל 5 שניות דרך הממסר. תוך כדי: `{ ok, state, stage, percent, title, duration, position }`. בסיום: `{ ok, state:"done", percent:100, title, file_name, size, cached, short_url, drive_url, view_url }`
- `GET /health` – בלי אימות: `{ ok, service:"yt-drive", accept_cookies, cookies }`
- `GET /queue` – `{ ok, queued, active, accept_cookies, cookies }`
- `POST /cookies` body `{ cookies: "<Netscape>" }` → `{ ok, message, pool }`

## מצבים
`queued → checking → downloading → converting → copying → uploading → shortening → done`, ובכל שלב `error` (עם `error.code`, `error.message`).
`stage` ב-downloading: `video`/`audio`; `percent` רק ב-downloading; `position` ב-queued.

## שגיאות: `{ ok:false, error:{ code, message, detail } }` – להציג `message`
משימה: `NETFREE_BLOCKED` (לבקש פתיחה), `NETFREE_PENDING` (לנסות בעוד דקות), `NETFREE_STREAM_BLOCKED` (איכות אחרת/שמע), `VIDEO_FILE_BLOCKED` (כפתור "הורדת שמע"), `YT_BOT_CHECK` (לשתף עוגיות), `YT_PRIVATE`, `YT_UNAVAILABLE`, `YT_AGE_RESTRICTED`, `LIVE_NOT_SUPPORTED`, `TOO_LONG`, `DRIVE_FULL`, `DRIVE_NOT_AVAILABLE`, `DRIVE_UPLOAD_TIMEOUT`, `SSL_ERROR`, `NETWORK`, `DOWNLOAD_FAILED`, `INTERNAL`.
בקשה: `UNAUTHORIZED`, `BAD_URL`, `BAD_FORMAT`, `RATE_LIMIT`, `QUEUE_FULL`, `JOB_NOT_FOUND` (השרת הופעל מחדש).
עוגיות: `BAD_COOKIES`, `NOT_LOGGED_IN`, `COOKIES_INVALID`, `COOKIES_DISABLED`.

## עוגיות
רגיש: גישה לחשבון גוגל של התורם. אזהרה ברורה, לא לשלוח בלי הסכמה יזומה, להמליץ על חשבון משני. להציג רק אם `/health` מחזיר `accept_cookies: true`.
איסוף: `chrome.cookies.getAll({domain})` ל-`.youtube.com` ו-`.google.com`, שורת Netscape לכל עוגייה: `domain(עם נקודה)\tTRUE\tpath\tsecure(TRUE/FALSE)\texpiry\tname\tvalue`, כותרת `# Netscape HTTP Cookie File`. חייבת להיות עוגיית התחברות (`SAPISID`, `__Secure-3PSID`, `__Secure-1PSID`, `__Secure-3PAPISID`, `SID`), אחרת "לא מחובר ליוטיוב".

## דרישות תוסף
service worker נרדם: עבודות ב-storage + alarms. סגירת popup לא עוצרת בדיקות; התראה בסיום. קצב בדיקה 5 שניות. מילוי אוטומטי של הקישור מהלשונית. מפתח API אופציונלי (`key: ""`).
