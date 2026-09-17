"""בדיקה על יוטיוב האמיתי: Edge עם התוסף, דרך פרוקסי מקומי שעוקף את נטפרי.

python test/real/harness.py [video_id] [--proxy http://127.0.0.1:10809] [--dark] [--lang en] [--headed] [--skip-download] [--shorts] [--mobile] [--width 360] [--prefix x-]
--shorts: דף שורטס (video "-" = השורט הראשון בפיד) (www, או m.youtube עם --mobile). --mobile: m.youtube ב-360px (או --width) עם UA של אנדרואיד. --prefix: קידומת לשמות הקבצים.
פלט: test/real/out/*.png + report.json. מוריד באמת קובץ אודיו אחד לבדיקה (לא נשמר בריפו).
Chrome הרשמי מתעלם מ---load-extension, ולכן Edge.
"""
import argparse
import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent / "out"
MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

ap = argparse.ArgumentParser()
ap.add_argument("video", nargs="?", default="dQw4w9WgXcQ")
ap.add_argument("--proxy", default="http://127.0.0.1:10809")
ap.add_argument("--dark", action="store_true")
ap.add_argument("--lang", default="he")
ap.add_argument("--headed", action="store_true")
ap.add_argument("--skip-download", action="store_true")
ap.add_argument("--shorts", action="store_true")
ap.add_argument("--mobile", action="store_true")
ap.add_argument("--width", type=int, default=360)
ap.add_argument("--prefix", default="")
A = ap.parse_args()

report = {"video": A.video, "steps": []}


def step(name, **data):
    report["steps"].append({"step": name, **data})
    print(name, json.dumps(data, ensure_ascii=False)[:500], flush=True)


STATE_JS = """() => {
  const p = document.querySelector('#movie_player'); const v = p && p.querySelector('video');
  return { loaded: !!window.__ytuLoaded, ad: !!(p && p.classList.contains('ad-showing')),
    t: v && +v.currentTime.toFixed(1), paused: v && v.paused, rate: v && v.playbackRate, muted: v && v.muted,
    hidden: document.hidden, vis: document.visibilityState,
    visibleAdEls: [...document.querySelectorAll('ytd-ad-slot-renderer, #player-ads, .ytp-ad-module *, ytd-in-feed-ad-layout-renderer, #masthead-ad')].filter(e => e.offsetParent).length,
    ourButtons: document.querySelectorAll('.ytu-btn, #ytu-host .fab').length }
}"""

# מחפש בכל shadow root פתוח/סגור שאפשר להגיע אליו – הדיאלוג שלנו נבנה ב-shadow
DIALOG_JS = """() => {
  const out = [];
  const walk = root => { for (const e of root.querySelectorAll('*')) { if (e.shadowRoot) { out.push(e.shadowRoot.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400)); walk(e.shadowRoot); } } };
  walk(document);
  const ytDialogs = [...document.querySelectorAll('tp-yt-paper-dialog, yt-dialog-view-model, ytd-popup-container [role=dialog]')].filter(e => e.offsetParent).map(e => e.tagName + ': ' + e.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200));
  const bodyDialogs = [...document.querySelectorAll('[role=dialog], [class*=ytu], [id*=ytu]')].filter(e => e.offsetParent || e.shadowRoot).map(e => e.tagName + '#' + e.id + '.' + e.className + ': ' + (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200));
  return { shadowTexts: out.filter(Boolean), ytDialogs, ourDialogs: bodyDialogs };
}"""


QUICK_STATE_JS = """() => { const v = [...document.querySelectorAll('video')].find(x => x.currentTime > 0) || document.querySelector('video');
  const p = v && v.closest('.html5-video-player'); return { loaded: !!window.__ytuLoaded, ad: !!(p && p.classList.contains('ad-showing')), t: v && +v.currentTime.toFixed(1), paused: v && v.paused, rate: v && v.playbackRate }; }"""

QUICK_DOM_JS = """() => ({
  ours: [...document.querySelectorAll('[data-ytu-mweb-dl], [class*=ytu], [id*=ytu]')].filter(e => e.offsetParent).map(e => e.tagName + '.' + e.className + ' ' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30))),
  dl: [...document.querySelectorAll('ytd-download-button-renderer, [data-ytu-mweb-dl], yt-download-list-item-view-model')].map(e => e.tagName + ' vis=' + !!e.offsetParent + ' ' + e.textContent.trim().slice(0, 30)),
  promos: [...document.querySelectorAll('ytd-mealbar-promo-renderer, ytm-mealbar-promo-renderer, ytm-promoted-sparkles-web-renderer, ad-slot-renderer, ytm-companion-ad-renderer, ytd-ad-slot-renderer, ytd-reel-video-renderer[is-active] ytd-ad-slot-renderer')].filter(e => e.offsetParent).map(e => e.tagName),
  bar: (b => b && { scrollW: b.scrollWidth, clientW: b.clientWidth, scrollL: b.scrollLeft, docScrollX: document.documentElement.scrollWidth - innerWidth,
    items: [...b.children].map(c => { const r = c.getBoundingClientRect(); return c.tagName.toLowerCase() + '@' + Math.round(r.left) + '..' + Math.round(r.right); }) })(document.querySelector('ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions')),
  buttons: [...document.querySelectorAll('ytm-slim-video-action-bar-renderer button, ytd-reel-video-renderer[is-active] button, ytm-reel-player-overlay-renderer button, reel-action-bar-view-model button')].filter(e => e.offsetParent).map(e => e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)) })"""

QUICK_MENU_JS = """() => [...document.querySelectorAll('tp-yt-iron-dropdown:not([aria-hidden=true]) ytd-menu-service-item-renderer, tp-yt-iron-dropdown:not([aria-hidden=true]) ytd-menu-service-item-download-renderer, tp-yt-iron-dropdown:not([aria-hidden=true]) yt-list-item-view-model, tp-yt-iron-dropdown:not([aria-hidden=true]) yt-download-list-item-view-model, bottom-sheet-container yt-list-item-view-model, bottom-sheet-container ytm-menu-item')]
  .filter(e => e.offsetParent).map(e => e.tagName + ': ' + e.textContent.replace(/\\s+/g, ' ').trim())"""

MORE_SEL = ", ".join([
    "ytd-reel-video-renderer[is-active] #menu-button button", "ytd-shorts ytd-reel-video-renderer[is-active] ytd-menu-renderer button",
    "ytm-slim-video-action-bar-renderer button-view-model button[aria-label='עוד']", "ytm-slim-video-action-bar-renderer button-view-model button[aria-label='More']",
    "ytm-slim-video-action-bar-renderer .slim-action-more-button button", "ytm-reel-player-overlay-renderer ytm-menu-renderer button",
    "ytm-reel-player-overlay-renderer button[aria-label*='עוד']", "ytm-reel-player-overlay-renderer button[aria-label*='More']"])


async def quick(page):
    """שורטס / m.youtube: ניגון, פרסומות, צילומים, ותפריט ⋮ / גיליון "עוד" → "הורדה"."""
    await asyncio.sleep(10)
    await page.evaluate("() => { const v = document.querySelector('video'); v && v.play().catch(() => {}); }")
    samples = []
    for _ in range(12):
        samples.append(await page.evaluate(QUICK_STATE_JS))
        await asyncio.sleep(1)
    step("playback", first=samples[0], last=samples[-1], adSeconds=sum(1 for s in samples if s["ad"]))
    await page.screenshot(path=str(OUT / (A.prefix + "01-watch.png")))
    step("dom", **(await page.evaluate(QUICK_DOM_JS)))
    if A.mobile and not A.shorts:
        await page.evaluate("() => window.scrollTo(0, 150)")
        await asyncio.sleep(2)
        await page.screenshot(path=str(OUT / (A.prefix + "02-scrolled.png")))
    more = page.locator(MORE_SEL).first
    if await more.count() and await more.is_visible():
        await more.click()
        await asyncio.sleep(2)
        step("menu", items=await page.evaluate(QUICK_MENU_JS))
        await page.screenshot(path=str(OUT / (A.prefix + "03-menu.png")))
        step("dom-menu-open", **(await page.evaluate(QUICK_DOM_JS)))
        dl = page.locator("tp-yt-iron-dropdown:not([aria-hidden=true]) :is(yt-download-list-item-view-model, ytd-menu-service-item-download-renderer, yt-list-item-view-model), bottom-sheet-container yt-list-item-view-model",
                          has_text="הורדה" if A.lang == "he" else "Download").first
        if await dl.count() and await dl.is_visible():
            await dl.click()
            await asyncio.sleep(4)
            step("download-dialog", **(await page.evaluate(DIALOG_JS)))
            await page.screenshot(path=str(OUT / (A.prefix + "04-download-dialog.png")))
        else:
            step("download-item", error="no download item in menu")
    else:
        step("menu", error="no more button")


async def main():
    OUT.mkdir(exist_ok=True)
    ext = Path(tempfile.mkdtemp()) / "ext"
    shutil.copytree(ROOT / "extension", ext)
    profile = tempfile.mkdtemp()
    async with async_playwright() as p:
        args = [f"--disable-extensions-except={ext}", f"--load-extension={ext}", f"--lang={A.lang}",
                "--autoplay-policy=no-user-gesture-required", "--window-size=1400,950"]
        if not A.headed:
            args.append("--headless=new")
        view = dict(viewport={"width": A.width, "height": 780}, user_agent=MOBILE_UA, is_mobile=True, has_touch=True, device_scale_factor=2) if A.mobile else dict(viewport={"width": 1400, "height": 950})
        ctx = await p.chromium.launch_persistent_context(
            profile, headless=False, executable_path=EDGE, proxy={"server": A.proxy},
            ignore_default_args=["--disable-extensions", "--disable-component-extensions-with-background-pages"],
            args=args, accept_downloads=True, color_scheme="dark" if A.dark else "light", locale=A.lang, **view)
        # הדיאלוג שלנו ב-shadow סגור; בבדיקה פותחים אותו כדי שאפשר יהיה ללחוץ בתוכו
        await ctx.add_init_script("(() => { const a = Element.prototype.attachShadow; Element.prototype.attachShadow = function (o) { return a.call(this, { ...o, mode: 'open' }); }; })()")
        # אסור להתחיל עבודות אמיתיות בשרת ה-Drive: הורדה בדפדפן בלבד, כתובת שרת מתה, וחסימת הממסר
        await ctx.route("**/script.google.com/**", lambda r: r.abort())
        await ctx.route("**/script.googleusercontent.com/**", lambda r: r.abort())
        mine = lambda w: w.url.startswith("chrome-extension://") and w.url.endswith("/background.js")
        sw = next((w for w in ctx.service_workers if mine(w)), None)
        while not sw:
            w = await ctx.wait_for_event("serviceworker", timeout=30000)
            sw = w if mine(w) else None
        await sw.evaluate("() => new Promise(r => chrome.storage.local.set({ settings: { downloadMethod: 'browser', serverUrl: 'http://127.0.0.1:9' } }, r))")
        page = await ctx.new_page()
        page.on("console", lambda m: m.type == "error" and report.setdefault("console_errors", []).append(m.text[:300]))
        page.on("pageerror", lambda e: report.setdefault("page_errors", []).append(str(e)[:300]))
        if A.shorts or A.mobile:
            host = "m.youtube.com" if A.mobile else "www.youtube.com"
            await page.goto(f"https://{host}/" + (("shorts/" + (A.video if A.video != "-" else "")) if A.shorts else "watch?v=" + A.video), wait_until="domcontentloaded", timeout=120000)
            await quick(page)
            report["final_state"] = await page.evaluate(STATE_JS)
            await ctx.close()
            (OUT / (A.prefix + "report.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            return
        await page.goto(f"https://www.youtube.com/watch?v={A.video}", wait_until="domcontentloaded", timeout=120000)
        await asyncio.sleep(8)
        await page.evaluate("() => { const v = document.querySelector('#movie_player video'); v && v.play().catch(() => {}); }")

        samples = []
        for _ in range(20):
            samples.append(await page.evaluate(STATE_JS))
            await asyncio.sleep(1)
        step("playback", first=samples[0], last=samples[-1], adSeconds=sum(1 for s in samples if s["ad"]),
             maxVisibleAdEls=max(s["visibleAdEls"] for s in samples), ourButtons=samples[-1]["ourButtons"])
        await page.screenshot(path=str(OUT / (A.prefix + "01-watch.png")))

        # ניגון ברקע: מדמים יציאה מהלשונית
        await page.evaluate("() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); }")
        await asyncio.sleep(3)
        step("background", state=await page.evaluate(STATE_JS))

        # תפריט המהירות המקורי
        # נגן מוסתר (למשל "צריך להיכנס כדי לאמת שלא מדובר בבוט" בפרוקסי) – מדלגים על בדיקת המהירות
        if not await page.locator("#movie_player video").is_visible():
            step("speed", error="player not visible", text=await page.evaluate("() => document.querySelector('#movie_player .ytp-error, #movie_player yt-player-error-message-renderer')?.textContent.trim().slice(0, 120)"))
        else:
            await page.hover("#movie_player")
            await page.click(".ytp-settings-button")
            await asyncio.sleep(1)
            await page.screenshot(path=str(OUT / (A.prefix + "02-settings-menu.png")))
            item = page.locator(".ytp-settings-menu .ytp-menuitem", has_text="מהירות" if A.lang == "he" else "speed")
            if await item.count():
                await item.first.click()
                await asyncio.sleep(1)
                slider = await page.evaluate("() => { const s = document.querySelector('.ytp-varispeed-input-slider'); return s && { max: s.max, aria: s.getAttribute('aria-valuemax') }; }")
                chip = page.locator(".ytp-variable-speed-panel-preset-button", has_text="3.0")
                if await chip.count():
                    await chip.first.click()
                    await asyncio.sleep(1.5)
                await page.screenshot(path=str(OUT / (A.prefix + "03-speed-panel.png")))
                step("speed", slider=slider, afterChip=await page.evaluate(STATE_JS),
                     display=await page.evaluate("() => document.querySelector('.ytp-variable-speed-panel-display span')?.textContent"),
                     upsell=await page.evaluate("() => [...document.querySelectorAll('tp-yt-paper-dialog, yt-mealbar-promo-renderer, ytd-mealbar-promo-renderer')].filter(e => e.offsetParent).map(e => e.tagName)"))
            else:
                step("speed", error="speed menu item not found")
            await page.keyboard.press("Escape")
            await asyncio.sleep(1)

        # כפתור ההורדה הרשמי
        await page.evaluate("() => window.scrollTo(0, 450)")
        await asyncio.sleep(2)
        btn = page.locator("ytd-watch-metadata ytd-download-button-renderer button").first
        count = await btn.count()
        vis = await btn.is_visible() if count else False
        step("download-button", exists=count > 0, visible=vis)
        if vis:
            await btn.click()
            await asyncio.sleep(5)
            await page.screenshot(path=str(OUT / (A.prefix + "04-download-dialog.png")))
            step("download-dialog", **(await page.evaluate(DIALOG_JS)))
            if not A.skip_download:
                clicked = await page.evaluate("""() => {
                  const roots = [document];
                  for (let i = 0; i < roots.length; i++) for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
                  for (const r of roots) {
                    const opts = [...r.querySelectorAll('[role=radio], input[type=radio], label, [role=option]')];
                    const audio = opts.find(x => /שמע|audio/i.test((x.textContent || '') + (x.value || '') + (x.getAttribute('aria-label') || '')));
                    const go = [...r.querySelectorAll('button, [role=button]')].find(b => /^\\s*(הורדה|download)\\s*$/i.test(b.textContent));
                    if (audio && go) { audio.click(); go.click(); return true; }
                  }
                  return false;
                }""")
                step("download-start", clicked=clicked)
                if clicked:
                    try:
                        dl = await page.wait_for_event("download", timeout=300000)
                        target = OUT / ("download-" + dl.suggested_filename)
                        await dl.save_as(str(target))
                        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "compact", str(target)], capture_output=True, text=True)
                        step("download-done", file=target.name, size=target.stat().st_size, ffprobe=(probe.stdout or probe.stderr).strip())
                    except Exception as e:
                        step("download-done", error=str(e)[:300])
                    await asyncio.sleep(2)
                    await page.screenshot(path=str(OUT / (A.prefix + "05-after-download.png")))
        report["final_state"] = await page.evaluate(STATE_JS)
        await ctx.close()
    (OUT / (A.prefix + "report.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("errors:", json.dumps({k: report.get(k) for k in ("console_errors", "page_errors")}, ensure_ascii=False)[:1500])


asyncio.run(main())
