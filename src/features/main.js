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
  for (const s of SETTINGS) saved[s.key] = S[s.key];
  Platform.save(saved);
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
  // החלון הקטן של ההורדות: רק ההורדה והרשימה שלה, בלי הפיצ'רים של דף יוטיוב
  if (dlwIsWindow()) return dlwStartWindow();
  applySettings();
  setInterval(() => {
    for (const fn of TICK) {
      try { fn(); } catch {}
    }
  }, 500);
  setInterval(keepAwake, 60 * 1000);
});
