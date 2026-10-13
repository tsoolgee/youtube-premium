// ---------- הורדה מהצפייה ----------
// כשיוטיוב מסרב לתת לנו קישורים (בדיקת בוט, SABR בלי PO token) אבל הסרטון כן מתנגן –
// הבייטים כבר עוברים בדפדפן: הנגן דוחף אותם ל-MediaSource. אנחנו מאזינים ל-appendBuffer,
// אוספים את אותם מקטעים בדיוק (fMP4, מה ש-mux.js יודע למזג) ובונים מהם קובץ.
// המחיר: צריך לתת לסרטון להתנגן עד הסוף – אין קיצור דרך, זו הצפייה עצמה.

const CAP_LIMIT = 2 * 1024 * 1024 * 1024; // גבול זיכרון, שלא נפיל את הלשונית
const capTracks = new Map();   // SourceBuffer -> { kind, init, parts, bytes }
let capArmed = null;           // { id, started, onChange } – מה אוספים עכשיו

const capKind = type => (/^audio/i.test(type || '') ? 'audio' : 'video');
const capIsInit = b => {
  // מקטע האתחול מתחיל ב-ftyp/moov; מקטע מדיה ב-moof/styp
  const tag = String.fromCharCode(...b.subarray(4, 8));
  return tag === 'ftyp' || tag === 'moov';
};

function capRecord(sb, data) {
  if (!data || !data.byteLength) return;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
  let track = capTracks.get(sb);
  if (!track) {
    track = { kind: capKind(sb.__ytuType), init: null, parts: [], bytes: 0 };
    capTracks.set(sb, track);
  }
  const copy = bytes.slice();
  // מקטע האתחול נשמר תמיד (הוא זעיר), המדיה רק כשמקליטים
  if (capIsInit(copy)) { track.init = copy; return; }
  if (!capArmed) return;
  if (track.bytes + copy.length > CAP_LIMIT) return;
  track.parts.push(copy);
  track.bytes += copy.length;
  if (capArmed.onChange) try { capArmed.onChange(); } catch {}
}

(() => {
  try {
    const addSB = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (type) {
      const sb = addSB.apply(this, arguments);
      try { sb.__ytuType = type; } catch {}
      return sb;
    };
    const append = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      try { capRecord(this, data); } catch {}
      return append.apply(this, arguments);
    };
  } catch {}
})();

// מתחילים להקליט את הסרטון שמתנגן: מאפסים את מה שנאסף ומנגנים מההתחלה
function capStart(id, onChange) {
  for (const track of capTracks.values()) { track.parts = []; track.bytes = 0; }
  capArmed = { id, started: Date.now(), onChange };
  const v = mainVideo() || video();
  try {
    const p = activePlayer();
    if (p && p.seekTo) p.seekTo(0, true);
    else if (v) v.currentTime = 0;
    if (v && v.paused) v.play().catch(() => {});
  } catch {}
  return capArmed;
}

const capStop = () => { capArmed = null; };

// כמה מהסרטון כבר נאסף, לפי מה שהנגן הספיק להוריד (buffered), ולא לפי מה שנצפה
function capProgress(length) {
  const v = mainVideo() || video();
  if (!v || !v.buffered || !v.buffered.length) return 0;
  const end = v.buffered.end(v.buffered.length - 1);
  const total = length || v.duration || (v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0);
  return total ? Math.min(1, end / total) : 0;
}

const capBytes = () => [...capTracks.values()].reduce((n, t) => n + t.bytes, 0);

// מחבר את מה שנאסף לקובץ אחד לכל מסלול, בדיוק במבנה ש-fetchFile היה מחזיר
function capTrackFile(kind) {
  const track = [...capTracks.values()].filter(t => t.kind === kind && t.bytes).sort((a, b) => b.bytes - a.bytes)[0];
  if (!track || !track.init) return null;
  const out = new Uint8Array(track.init.length + track.bytes);
  out.set(track.init, 0);
  let at = track.init.length;
  for (const part of track.parts) { out.set(part, at); at += part.length; }
  return out;
}

// הקבצים לבנייה: [וידאו, שמע] או [שמע] – לפי מה שנאסף ומה שביקשו
function capFiles(audioOnly) {
  const audio = capTrackFile('audio');
  if (!audio) return null;
  const vid = audioOnly ? null : capTrackFile('video');
  return vid ? [vid, audio] : [audio];
}
