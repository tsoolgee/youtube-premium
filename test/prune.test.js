// בדיקת לוגיקת ניקוי הפרסומות מתוך ads.js בלי DOM: node test/prune.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/features/ads.js', 'utf8');
const noop = () => {};
const ctx = {
  S: { adblock: true, adPrune: true }, JSON: { parse: JSON.parse },
  Response: function () {}, window: {}, setInterval: noop, setTimeout: noop,
  document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], head: { append: noop } },
  h: () => ({}), videoId: () => null, onShorts: () => false, mainVideo: () => null, activePlayer: () => null,
};
ctx.Response.prototype.json = function () { return Promise.resolve({}); };
vm.createContext(ctx);
vm.runInContext(src + ';this.prune=prune;this.contentLength=contentLength;', ctx);
const { prune } = ctx;

// player
const player = prune(ctx.JSON.parse(JSON.stringify({
  playabilityStatus: { status: 'OK' }, adPlacements: [1], playerAds: [1], adSlots: [1],
  videoDetails: { videoId: 'abcdefghijk', lengthSeconds: '212' }, streamingData: { formats: [1] },
})));
assert(!player.adPlacements && !player.playerAds && !player.adSlots && player.streamingData.formats.length === 1);
assert.strictEqual(ctx.contentLength.abcdefghijk, 212);

// browse עם גריד
const browse = prune({ responseContext: {}, contents: { richGridRenderer: { contents: [
  { richItemRenderer: { content: { videoRenderer: { videoId: 'a' } } } },
  { richItemRenderer: { content: { adSlotRenderer: {} } } },
  { richSectionRenderer: { content: { richShelfRenderer: { contents: [{ richItemRenderer: { content: { adSlotRenderer: {} } } }, { richItemRenderer: { content: { shortsLockupViewModel: {} } } }] } } } },
  { continuationItemRenderer: {} },
] } } });
const grid = browse.contents.richGridRenderer.contents;
assert.strictEqual(grid.length, 3);
assert.strictEqual(grid[1].richSectionRenderer.content.richShelfRenderer.contents.length, 1);

// next: פריט בצד + לוח מפרסם + playerResponse בתוך מערך pbj
const next = prune([{ playerResponse: { playabilityStatus: {}, adPlacements: [] }, response: { responseContext: {},
  engagementPanels: [{ engagementPanelSectionListRenderer: { targetId: 'engagement-panel-ads' } }, { engagementPanelSectionListRenderer: { targetId: 'engagement-panel-comments-section' } }],
  contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: [{ adSlotRenderer: {} }, { compactVideoRenderer: { videoId: 'x' } }] } } } } } }]);
assert(!('adPlacements' in next[0].playerResponse));
assert.strictEqual(next[0].response.engagementPanels.length, 1);
assert.strictEqual(next[0].response.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results.length, 1);

// reel_watch_sequence
const reel = prune({ responseContext: {}, entries: [
  { command: { reelWatchEndpoint: { videoId: 'a' } } },
  { command: { reelWatchEndpoint: { adClientParams: { isAd: true } } } },
  { command: { reelWatchEndpoint: { videoId: 'b', adClientParams: { isAd: false } } } },
] });
assert.strictEqual(reel.entries.length, 2);

// JSON שאינו של יוטיוב – לא נוגעים (גם אם יש שם מפתח שנראה כמו פרסומת)
const other = prune({ items: [{ adSlotRenderer: 1 }], adPlacements: 0 });
assert.strictEqual(other.items.length, 1);

// Premium: מהירות עד 4 בלי צ'יפ הצעה, בלי איכויות נעולות ובלי "צפייה בלי פרסומות" בתפריט ⋮
ctx.S.speed = true; ctx.S.hidePromos = true;
const pr = prune(ctx.JSON.parse(JSON.stringify({
  playabilityStatus: { status: 'OK', paygatedQualitiesMetadata: { qualityDetails: [] } },
  playerConfig: { granularVariableSpeedConfig: { minimumPlaybackRate: 25, maximumPlaybackRate: 200,
    defaultPlaybackRateOptions: [{ label: '2.0', value: 200, isPremiumUpsell: false }, { label: '3.0', value: 300, isPremiumUpsell: true }] } },
})));
assert.strictEqual(pr.playerConfig.granularVariableSpeedConfig.maximumPlaybackRate, 400);
assert(pr.playerConfig.granularVariableSpeedConfig.defaultPlaybackRateOptions.every(o => !o.isPremiumUpsell));
assert(!('paygatedQualitiesMetadata' in pr.playabilityStatus));
const wn = prune({ responseContext: {}, playerOverlays: { playerOverlayRenderer: { showPlaybackRateUpsellPanelCommand: { x: 1 }, autoplay: {} } },
  contents: { menuRenderer: { items: [
    { listItemViewModel: { title: { content: 'צפייה בלי פרסומות' }, entitySelectorType: 'LIST_ITEM_VIEW_MODEL_ENTITY_SELECTOR_TYPE_REMOVE_ADS_AD_STATE' } },
    { listItemViewModel: { title: { content: 'x' }, rendererContext: { commandContext: { onTap: { innertubeCommand: { showDialogCommand: { panelLoadingStrategy: { requestTemplate: { panelId: 'PApremium_upsell' } } } } } } } } },
    { menuServiceItemRenderer: { text: { runs: [{ text: 'דיווח' }] } } },
  ] } } });
assert(!('showPlaybackRateUpsellPanelCommand' in wn.playerOverlays.playerOverlayRenderer));
assert.strictEqual(wn.contents.menuRenderer.items.length, 1);
// בלי חסימת פרסומות – נתוני Premium עדיין משתנים, פרסומות לא
ctx.S.adblock = false;
const noAds = prune({ playabilityStatus: {}, adPlacements: [1], playerConfig: { granularVariableSpeedConfig: { maximumPlaybackRate: 200 } } });
assert(noAds.adPlacements && noAds.playerConfig.granularVariableSpeedConfig.maximumPlaybackRate === 400);
ctx.S.adblock = true; ctx.S.speed = false; ctx.S.hidePromos = false;

// מהירויות Premium כבויות אבל בלי הצעות: הצ'יפ 3.0 יוצא (אחרת היה צ'יפ "Premium" שמנגן ב-2), בלי פקודת ההצעה, והמקסימום נשאר 2
ctx.S.hidePromos = true;
const offSpeed = prune({ playabilityStatus: {}, playerConfig: { granularVariableSpeedConfig: { maximumPlaybackRate: 200,
  defaultPlaybackRateOptions: [{ label: '1.0', value: 100 }, { label: '2.0', value: 200 }, { label: '3.0', value: 300, isPremiumUpsell: true }] } },
  playerOverlays: { playerOverlayRenderer: { showPlaybackRateUpsellPanelCommand: {} } } });
assert.strictEqual(offSpeed.playerConfig.granularVariableSpeedConfig.maximumPlaybackRate, 200);
assert.deepStrictEqual(offSpeed.playerConfig.granularVariableSpeedConfig.defaultPlaybackRateOptions.map(o => o.label), ['1.0', '2.0']);
assert(!('showPlaybackRateUpsellPanelCommand' in offSpeed.playerOverlays.playerOverlayRenderer));
ctx.S.hidePromos = false;

// ההגדרה כבויה
ctx.S.adPrune = false;
assert(prune({ playabilityStatus: {}, adPlacements: [1] }).adPlacements);
console.log('prune: ok');
