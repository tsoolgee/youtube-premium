// רשימת ההגדרות – משותפת לדיאלוג ההגדרות של הטמפרמונקי, לחלון התוסף, לגשר ולסקריפט שבדף.
// type: bool / select.
const SETTING_GROUPS = [
  { id: 'ads', label: 'פרסומות', labelEn: 'Ads' },
  { id: 'watch', label: 'צפייה', labelEn: 'Playback' },
  { id: 'download', label: 'הורדות', labelEn: 'Downloads' },
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
  { key: 'autoPip', type: 'select', group: 'watch', def: 'mobile', label: 'חלון צף אוטומטי', desc: 'מעבר לחלון צף כשיוצאים מהלשונית באמצע ניגון. במחשב צריך Chrome 134 ומעלה, והדפדפן מבקש אישור בפעם הראשונה',
    labelEn: 'Automatic picture-in-picture', descEn: 'Switches to a floating window when you leave the tab while playing. On desktop it needs Chrome 134+, and the browser asks for permission the first time',
    options: [
      { value: 'off', label: 'כבוי', labelEn: 'Off' },
      { value: 'mobile', label: 'רק בטלפון (m.youtube)', labelEn: 'Mobile only (m.youtube)' },
      { value: 'always', label: 'גם במחשב', labelEn: 'On desktop too' },
    ] },
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
      { value: 'mp3', label: 'שמע בלבד (MP3)', labelEn: 'Audio only (MP3)' },
    ] },
  { key: 'hookOfficialButton', type: 'bool', group: 'download', def: true, label: 'כפתור ההורדה של יוטיוב', desc: 'כפתור "הורדה" ו"הורדה" בתפריט ⋮ מורידים במקום הצעת Premium',
    labelEn: 'YouTube’s Download button', descEn: 'The Download button and the ⋮ menu item download instead of showing the Premium offer' },
  { key: 'mp3Bitrate', type: 'select', group: 'download', def: '320', label: 'איכות MP3', desc: 'קצב הסיביות בהמרה ל-MP3. גבוה יותר = קובץ גדול יותר',
    labelEn: 'MP3 quality', descEn: 'Bitrate for MP3 conversion. Higher = bigger file',
    options: [
      { value: '128', label: '128 kbps', labelEn: '128 kbps' },
      { value: '192', label: '192 kbps', labelEn: '192 kbps' },
      { value: '256', label: '256 kbps', labelEn: '256 kbps' },
      { value: '320', label: '320 kbps (ברירת מחדל)', labelEn: '320 kbps (default)' },
    ] },
  { key: 'downloadInRow', type: 'bool', group: 'download', def: true, label: 'הורדה בשורת הכפתורים', desc: 'כפתור "הורדה" תמיד ליד "שיתוף". כבוי – כמו ביוטיוב: במסך צר הוא עובר לתפריט ⋮',
    labelEn: 'Download in the button row', descEn: 'The Download button always sits next to Share. Off – like YouTube: on narrow screens it moves into the ⋮ menu' },
  { key: 'h264Only', type: 'bool', group: 'download', def: true, label: 'רק H.264 (נפתח בכל נגן)', desc: 'מסתיר איכויות שיוטיוב נותן רק ב-AV1 (בדרך כלל 1440p ו-4K) – נגן Windows בלי הרחבת AV1 מראה בהן רק שמע',
    labelEn: 'H.264 only (plays everywhere)', descEn: 'Hides qualities YouTube only offers in AV1 (usually 1440p and 4K) – the Windows player shows them as audio only without the AV1 extension' },
];

const DEFAULTS = Object.fromEntries(SETTINGS.map(s => [s.key, s.def]));

// ערכים ישנים (2.1.0): איכות ההורדה high/medium/low היו 1080/720/360
// autoPip היה בוליאני (0.0.6 ומטה): דלוק = רק בטלפון, כמו שהיה
const LEGACY_VALUES = {
  downloadQuality: { high: '1080', medium: '720', low: '360' },
  autoPip: { true: 'mobile', false: 'off' },
};
function migrateSettings(settings) {
  const out = { ...(settings || {}) };
  for (const [key, map] of Object.entries(LEGACY_VALUES)) {
    if (Object.prototype.hasOwnProperty.call(map, out[key])) out[key] = map[out[key]];
  }
  return out;
}
