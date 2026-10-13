// ---------- הקבצים שהנגן של יוטיוב עצמו מושך ----------
// כשיוטיוב מסרב לבקשה שלנו ("צריך להיכנס כדי לאמת שלא מדובר בבוט", כתובת שמסומנת כבוט)
// אבל הסרטון כן מתנגן בדף – לנגן עצמו יש כתובות videoplayback חתומות שעובדות בסשן הזה.
// מקשיבים לבקשות שלו ושומרים אותן, וההורדה נופלת אליהן כשכל השאר נכשל.
// יש להן שני סייגים: הן קיימות רק לאיכות שמתנגנת בפועל, והן פגות אחרי כמה שעות.

// ה-itag לא מופיע בכתובת כשם איכות – הטבלה היא רק למה שאנחנו יודעים למזג (MP4/M4A)
const PS_VIDEO_ITAGS = { 160: 144, 133: 240, 134: 360, 135: 480, 136: 720, 137: 1080, 298: 720, 299: 1080, 264: 1440, 266: 2160 };
const PS_FPS60 = { 298: 60, 299: 60 };
const PS_AUDIO_ITAGS = { 139: 48, 140: 128, 141: 256 };

const psSeen = new Map(); // videoId -> Map(itag -> format)

function psRemember(url) {
  try {
    if (!url || url.indexOf('videoplayback') < 0) return;
    const u = new URL(url, location.href);
    const itag = +u.searchParams.get('itag');
    if (!itag || (!PS_VIDEO_ITAGS[itag] && !PS_AUDIO_ITAGS[itag])) return;
    const id = typeof videoId === 'function' ? videoId() : null;
    if (!id) return;
    const clen = +u.searchParams.get('clen');
    // כתובת נקייה: בלי הטווח של הנגן ובלי המונה שלו, כדי שנוכל לבקש טווחים משלנו
    for (const k of ['range', 'rn', 'rbuf', 'ump', 'srfvp', 'alr']) u.searchParams.delete(k);
    const audio = !!PS_AUDIO_ITAGS[itag];
    const fmt = {
      itag,
      url: u.toString(),
      contentLength: clen ? String(clen) : '',
      bitrate: (audio ? PS_AUDIO_ITAGS[itag] : PS_VIDEO_ITAGS[itag]) * 1000,
      mimeType: audio ? 'audio/mp4; codecs="mp4a.40.2"' : 'video/mp4; codecs="avc1"',
    };
    if (!audio) {
      fmt.height = PS_VIDEO_ITAGS[itag];
      fmt.qualityLabel = fmt.height + 'p' + (PS_FPS60[itag] ? '60' : '');
      if (PS_FPS60[itag]) fmt.fps = 60;
    }
    if (!psSeen.has(id)) psSeen.set(id, new Map());
    psSeen.get(id).set(itag, fmt);
  } catch {}
}

(() => {
  try {
    const realFetch = window.fetch;
    window.fetch = function (input, init) {
      try { psRemember(typeof input === 'string' ? input : input && input.url); } catch {}
      return realFetch.apply(this, arguments);
    };
    const realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { psRemember(url); } catch {}
      return realOpen.apply(this, arguments);
    };
  } catch {}
})();

// מה שנאסף לסרטון, במבנה של fetchStreams. null אם אין מספיק (צריך לפחות פס קול)
function pageStreamInfo(id) {
  const map = psSeen.get(id);
  if (!map || !map.size) return null;
  const all = [...map.values()];
  const audio = all.filter(f => !f.height).sort((a, b) => b.bitrate - a.bitrate)[0];
  if (!audio || !audio.contentLength) return null;
  const videos = all.filter(f => f.height && f.contentLength).sort((a, b) => b.height - a.height);
  let details = {};
  try {
    const pr = window.ytInitialPlayerResponse;
    if (pr?.videoDetails?.videoId === id) details = pr.videoDetails;
  } catch {}
  return {
    id,
    title: details.title || (typeof pageTitle === 'function' ? pageTitle(id) : '') || document.title.replace(/ - YouTube.*$/, ''),
    author: details.author || '',
    length: +details.lengthSeconds || 0,
    thumbs: details.thumbnail?.thumbnails || [],
    fromPage: true,
    audio, videos,
  };
}
