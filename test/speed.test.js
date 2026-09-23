// בדיקות למהירות בלי DOM: node test/speed.test.js
// מה שחשוב כאן – המהירות לא נשמרת בין טעינות (כמו ביוטיוב), והנגן של יוטיוב לא נדחף ל-2.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/features/speed.js', 'utf8');

const noop = () => {};
const store = { 'ytu-speed': '3' }; // ערך שנשאר מגרסה ישנה
const vid = { playbackRate: 1, isConnected: true };
const calls = [];
const playerRates = [0.25, 0.5, 1, 1.25, 1.5, 1.75, 2];
const player = {
  getAvailablePlaybackRates: () => playerRates.slice(),
  setPlaybackRate(r) { calls.push(r); this.rate = r; },
  getPlaybackRate() { return this.rate; },
  rate: 1,
  querySelector: () => null,
  querySelectorAll: () => [],
};
const listeners = {};
const ctx = {
  S: { speed: true }, console, Math, Date, JSON, String, Number, WeakSet, Array, Promise, setTimeout, clearTimeout,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  document: {
    addEventListener: (t, h) => { listeners[t] = h; },
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { lang: 'he' },
  },
  window: { addEventListener: noop },
  getComputedStyle: () => ({ direction: 'ltr' }),
  mainVideo: () => vid,
  video: () => vid,
  activePlayer: () => player,
  uiText: he => he,
  isTyping: () => false,
  PREVIEW_SEL: '#preview',
};
vm.createContext(ctx);
vm.runInContext(src + ';Object.assign(this, { setRate, speedStore, speedWanted, patchPlayerRates, dropSpeedWant });', ctx);

// 1. ערך שנשמר בגרסאות קודמות נמחק בטעינה – אחרת הוא היה חוזר בכל ריענון
assert.strictEqual('ytu-speed' in store, false, 'המפתח הישן נמחק');

// 2. מהירות Premium: הסרטון בלבד. את הנגן של יוטיוב לא דוחפים ל-2 (משם הגיע "חוזר לכפול 2")
ctx.setRate(3);
assert.strictEqual(vid.playbackRate, 3);
assert.deepStrictEqual(calls, [], 'לא נוגעים ב-setPlaybackRate של הנגן מעל 2');
assert.strictEqual(player.rate, 1, 'הנגן נשאר על המהירות שלו');
assert.strictEqual(ctx.speedWanted(vid), 3);

// 3. שום דבר לא נשמר באחסון – ריענון מתחיל מחדש, והמהירות נשמרת רק בזיכרון (סרטון הבא באותה לשונית)
assert.deepStrictEqual(Object.keys(store), []);
assert.strictEqual(ctx.speedStore.get(), 3);

// 4. עד 2 – הנגן של יוטיוב קובע, והמהירות שלנו משוחררת
ctx.setRate(1.5);
assert.deepStrictEqual(calls, [1.5]);
assert.strictEqual(vid.playbackRate, 1.5);
assert.strictEqual(ctx.speedWanted(vid), null);
assert.strictEqual(ctx.speedStore.get(), null);
assert.deepStrictEqual(Object.keys(store), []);

// 5. מעל המקסימום – נעצר ב-4
ctx.setRate(9);
assert.strictEqual(vid.playbackRate, 4);

console.log('speed.test.js: ok');
