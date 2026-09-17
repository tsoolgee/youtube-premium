"""בדיקת הנגן על יוטיוב האמיתי: ברירות מחדל כמו Premium (איכות "אוטומטי", בלי חלון צף אוטומטי בדסקטופ),
לוח המהירות עד 4 וצ'יפ 3.0, בלי פרסומות. וגם מהירויות Premium כבויות (בלי צ'יפ 3.0 מת) ו-m.youtube.

python test/real/player.py [--video ID] [--dark] [--lang en] [--headed] [--speed-off] [--mobile]
פלט: test/real/out/player-*.png ו-player.json. בלי הורדות ובלי שרת.
"""
import argparse
import asyncio
import json
import shutil
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent / "out"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"

ap = argparse.ArgumentParser()
ap.add_argument("--video", default="dQw4w9WgXcQ")
ap.add_argument("--proxy", default="http://127.0.0.1:10809")
ap.add_argument("--dark", action="store_true")
ap.add_argument("--lang", default="he")
ap.add_argument("--headed", action="store_true")
ap.add_argument("--speed-off", action="store_true")
ap.add_argument("--mobile", action="store_true")
A = ap.parse_args()
TAG = "player" + ("-mobile" if A.mobile else "") + ("-speedoff" if A.speed_off else "") + ("-dark" if A.dark else "") + ("-en" if A.lang != "he" else "")
report = {"tag": TAG, "video": A.video, "steps": []}


def step(name, **data):
    report["steps"].append({"step": name, **data})
    print(name, json.dumps(data, ensure_ascii=False)[:1200], flush=True)


async def shot(page, name):
    await page.screenshot(path=str(OUT / f"{TAG}-{name}.png"))


# רושם כל רישום של enterpictureinpicture ב-mediaSession (גם דרך ה-prototype), לפני שהתוסף נטען
PIP_SPY = """(() => { window.__pipReg = []; const P = MediaSession.prototype, set = P.setActionHandler;
  P.setActionHandler = function (a, h) { if (a === 'enterpictureinpicture') window.__pipReg.push(h ? 'set' : 'null'); return set.apply(this, arguments); }; })()"""

STATE_JS = """() => {
  const p = document.querySelector('#movie_player'); const v = p && p.querySelector('video');
  let q = null, rate = null;
  try { q = p.getPlaybackQuality(); rate = p.getPlaybackRate(); } catch {}
  return { ad: !!(p && p.classList.contains('ad-showing')), t: v && +v.currentTime.toFixed(1), paused: v && v.paused,
    elRate: v && v.playbackRate, playerRate: rate, quality: q, pipReg: window.__pipReg,
    visibleAdEls: [...document.querySelectorAll('ytd-ad-slot-renderer, #player-ads, .ytp-ad-module *, ytd-in-feed-ad-layout-renderer, #masthead-ad, ad-slot-renderer')].filter(e => e.offsetParent).length }
}"""


async def main():
    OUT.mkdir(exist_ok=True)
    ext = Path(tempfile.mkdtemp()) / "ext"
    shutil.copytree(ROOT / "extension", ext)
    profile = tempfile.mkdtemp()
    w, hgt = (360, 780) if A.mobile else (1400, 950)
    async with async_playwright() as p:
        args = [f"--disable-extensions-except={ext}", f"--load-extension={ext}", f"--lang={A.lang}",
                "--autoplay-policy=no-user-gesture-required", f"--window-size={w},{hgt}"]
        if not A.headed:
            args.append("--headless=new")
        opts = dict(headless=False, executable_path=EDGE, proxy={"server": A.proxy},
                    ignore_default_args=["--disable-extensions", "--disable-component-extensions-with-background-pages"],
                    args=args, viewport={"width": w, "height": hgt},
                    color_scheme="dark" if A.dark else "light", locale=A.lang)
        if A.mobile:
            opts.update(user_agent=MOBILE_UA, is_mobile=True, has_touch=True, device_scale_factor=2)
        ctx = await p.chromium.launch_persistent_context(profile, **opts)
        await ctx.add_init_script(PIP_SPY)
        # אסור לגעת בשרת ה-Drive
        await ctx.route("**/script.google.com/**", lambda r: r.abort())
        await ctx.route("**/script.googleusercontent.com/**", lambda r: r.abort())
        mine = lambda x: x.url.startswith("chrome-extension://") and x.url.endswith("/background.js")
        sw = next((x for x in ctx.service_workers if mine(x)), None)
        while not sw:
            x = await ctx.wait_for_event("serviceworker", timeout=30000)
            sw = x if mine(x) else None
        settings = {"downloadMethod": "browser", "serverUrl": "http://127.0.0.1:9"}
        if A.speed_off:
            settings["speed"] = False
        await sw.evaluate("s => new Promise(r => chrome.storage.local.set({ settings: s }, r))", settings)
        page = await ctx.new_page()
        page.on("pageerror", lambda e: report.setdefault("page_errors", []).append(str(e)[:300]))
        host = "m.youtube.com" if A.mobile else "www.youtube.com"
        await page.goto(f"https://{host}/watch?v={A.video}", wait_until="domcontentloaded", timeout=120000)
        await asyncio.sleep(8)
        await page.evaluate("() => { const v = document.querySelector('#movie_player video, video'); v && v.play().catch(() => {}); }")
        samples = []
        for _ in range(15):
            samples.append(await page.evaluate(STATE_JS))
            await asyncio.sleep(1)
        cfg = await page.evaluate("""() => { const g = window.ytInitialPlayerResponse?.playerConfig?.granularVariableSpeedConfig;
          return g && { max: g.maximumPlaybackRate, opts: (g.defaultPlaybackRateOptions || []).map(o => o.label + (o.isPremiumUpsell ? '*' : '')) }; }""")
        step("playback", first=samples[0], last=samples[-1], adSeconds=sum(1 for s in samples if s["ad"]),
             maxVisibleAdEls=max(s["visibleAdEls"] for s in samples), speedConfig=cfg)
        await shot(page, "01-watch")
        if A.mobile:
            report["final"] = await page.evaluate(STATE_JS)
            await ctx.close()
            (OUT / f"{TAG}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            return

        # תפריט ההגדרות: שורת האיכות צריכה להיות "אוטומטי (...)"
        await page.hover("#movie_player")
        await page.click(".ytp-settings-button")
        await asyncio.sleep(1)
        rows = await page.evaluate("() => [...document.querySelectorAll('.ytp-settings-menu .ytp-menuitem')].map(r => r.textContent.trim())")
        step("settings-menu", rows=rows)
        await shot(page, "02-settings")
        qitem = page.locator(".ytp-settings-menu .ytp-menuitem", has_text="איכות" if A.lang == "he" else "Quality")
        if await qitem.count():
            await qitem.first.click()
            await asyncio.sleep(1)
            qrows = await page.evaluate("() => [...document.querySelectorAll('.ytp-quality-menu .ytp-menuitem')].filter(r => r.offsetParent).map(r => r.textContent.trim() + (r.getAttribute('aria-checked') === 'true' ? ' ✓' : ''))")
            step("quality-menu", rows=qrows)
            await shot(page, "03-quality")
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.5)
            await page.hover("#movie_player")
            await page.click(".ytp-settings-button")
            await asyncio.sleep(1)

        item = page.locator(".ytp-settings-menu .ytp-menuitem", has_text="מהירות" if A.lang == "he" else "speed")
        if await item.count():
            await item.first.click()
            await asyncio.sleep(1)
            chips = await page.evaluate("() => [...document.querySelectorAll('.ytp-variable-speed-panel-preset-button')].map(b => b.textContent.trim() + (b.querySelector('svg, .ytp-variable-speed-panel-premium-upsell-icon') ? '*' : ''))")
            slider = await page.evaluate("() => { const s = document.querySelector('.ytp-varispeed-input-slider'); return s && { max: s.max }; }")
            chip = page.locator(".ytp-variable-speed-panel-preset-button", has_text="3.0")
            has3 = await chip.count() > 0
            if has3:
                await chip.first.click()
                await asyncio.sleep(1.5)
            await shot(page, "04-speed")
            step("speed", chips=chips, slider=slider, clicked3=has3, after=await page.evaluate(STATE_JS),
                 display=await page.evaluate("() => document.querySelector('.ytp-variable-speed-panel-display span')?.textContent"),
                 upsell=await page.evaluate("() => [...document.querySelectorAll('tp-yt-paper-dialog, ytd-mealbar-promo-renderer, yt-sheet-view-model')].filter(e => e.offsetParent).map(e => e.tagName)"))
        else:
            step("speed", error="speed item not found")
        await page.keyboard.press("Escape")
        # מעבר לשונית: בדסקטופ לא נכנסים לחלון צף
        await page.evaluate("() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }")
        await asyncio.sleep(2)
        report["final"] = await page.evaluate("() => ({ ...(" + STATE_JS + ")(), pipEl: !!document.pictureInPictureElement })")
        step("final", **report["final"])
        await ctx.close()
    (OUT / f"{TAG}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


asyncio.run(main())
