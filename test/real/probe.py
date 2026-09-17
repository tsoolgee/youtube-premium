"""בדיקות ממוקדות על יוטיוב האמיתי (Edge + התוסף + הפרוקסי), תרחיש לפי שם.

python test/real/probe.py <scenario> [--video ID] [--dark] [--lang en] [--headed]
תרחישים: www-download (הורדת 1080p אמיתית של סרטון קצר + ffprobe, יישור שורת הפעולות, שגיאות 403),
www-menu (פריט ההורדה בתפריט ⋮ לפני/אחרי, הסרה מהתפריט עם "ביטול"), downloads-page,
mobile (m.youtube ב-360px, סרגל מצומצם → "עוד" → "הורדה"), music (music.youtube.com),
popup (חלון התוסף ב-380px עם עבודות מדומות).
פלט: test/real/out/probe-<scenario>-*.png ו-probe-<scenario>.json.
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
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"

ap = argparse.ArgumentParser()
ap.add_argument("scenario")
ap.add_argument("--video", default="jNQXAC9IVRw")
ap.add_argument("--proxy", default="http://127.0.0.1:10809")
ap.add_argument("--dark", action="store_true")
ap.add_argument("--lang", default="he")
ap.add_argument("--headed", action="store_true")
ap.add_argument("--js", action="append", default=[], help="eval: קובצי JS שרצים אחד אחרי השני בדף")
ap.add_argument("--url", default=None)
ap.add_argument("--width", type=int, default=360)
ap.add_argument("--choice", default="360", help="www-download: 1080/720/360/144/audio")
ap.add_argument("--no-ext", action="store_true", help="בלי התוסף (להשוואה)")
A = ap.parse_args()
report = {"scenario": A.scenario, "video": A.video, "steps": []}


def step(name, **data):
    report["steps"].append({"step": name, **data})
    print(name, json.dumps(data, ensure_ascii=False)[:1500], flush=True)


async def shot(page, name):
    await page.screenshot(path=str(OUT / f"probe-{A.scenario}-{name}.png"))


# לחיצה על כפתור בתוך ה-shadow של הדיאלוג שלנו
CLICK_JS = """([choice, label]) => {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  for (const r of roots) {
    const row = choice && r.querySelector(`.dq-row[data-choice="${choice}"] input`);
    if (choice && row) row.click();
    const go = [...r.querySelectorAll('.dlg button, .toast button')].find(b => b.textContent.trim() === label);
    if (go) { go.click(); return true; }
  }
  return false;
}"""

# מבנה DOM מקוצר (תגיות, מחלקות, תכונות) – כדי לשכפל רכיבים של יוטיוב נאמנה
TREE_JS = """(sel) => { const root = document.querySelector(sel); if (!root) return null; const out = [];
  const walk = (e, d) => { const at = [...e.attributes].filter(a => a.name !== 'class' && a.name !== 'd').map(a => a.name + '=' + a.value.slice(0, 40)).join(' ');
    out.push(' '.repeat(d) + e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].join('.') : '') + (at ? ' [' + at + ']' : '') + (e.tagName === 'path' ? ' d=' + (e.getAttribute('d') || '').slice(0, 30) : '') + (!e.children.length && e.textContent.trim() ? ' "' + e.textContent.trim().slice(0, 30) + '"' : ''));
    if (d < 14) for (const c of e.children) walk(c, d + 1); };
  walk(root, 0); return out; }"""

SHADOW_TEXT_JS = """() => {
  const roots = [document]; const out = [];
  for (let i = 0; i < roots.length; i++) for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  for (const r of roots.slice(1)) for (const x of r.querySelectorAll('.dlg, .toast.show')) out.push(x.className + ': ' + x.textContent.replace(/\\s+/g, ' ').trim());
  return out;
}"""

ROW_JS = """() => {
  const row = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
  const menu = document.querySelector('ytd-watch-metadata #actions ytd-menu-renderer');
  if (!menu) return null;
  return [...menu.querySelectorAll('button')].filter(b => b.offsetParent).map(b => {
    const r = b.getBoundingClientRect();
    return { label: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20), top: Math.round(r.top * 10) / 10, h: Math.round(r.height * 10) / 10, w: Math.round(r.width) };
  });
}"""


async def no_server(ctx):
    """אסור להתחיל עבודות אמיתיות בשרת ה-Drive: הורדה בדפדפן בלבד, כתובת שרת מתה, וחסימת הממסר."""
    await ctx.route("**/script.google.com/**", lambda r: r.abort())
    await ctx.route("**/script.googleusercontent.com/**", lambda r: r.abort())
    sw = next((w for w in ctx.service_workers if w.url.startswith("chrome-extension://") and w.url.endswith("/background.js")), None)
    while not sw:
        w = await ctx.wait_for_event("serviceworker", timeout=30000)
        sw = w if w.url.startswith("chrome-extension://") and w.url.endswith("/background.js") else None
    await sw.evaluate("() => new Promise(r => chrome.storage.local.set({ settings: { downloadMethod: 'browser', serverUrl: 'http://127.0.0.1:9' } }, r))")
    step("no-server", settings=await sw.evaluate("() => new Promise(r => chrome.storage.local.get('settings', x => r(x.settings)))"))


async def launch(p, mobile=False):
    ext = Path(tempfile.mkdtemp()) / "ext"
    shutil.copytree(ROOT / "extension", ext)
    args = ([] if A.no_ext else [f"--disable-extensions-except={ext}", f"--load-extension={ext}"]) + [f"--lang={A.lang}",
            "--autoplay-policy=no-user-gesture-required"]
    if not A.headed:
        args.append("--headless=new")
    opts = dict(headless=False, executable_path=EDGE, proxy={"server": A.proxy},
                ignore_default_args=["--disable-extensions", "--disable-component-extensions-with-background-pages"],
                args=args, accept_downloads=True, color_scheme="dark" if A.dark else "light", locale=A.lang)
    if mobile:
        opts.update(viewport={"width": A.width, "height": 780}, user_agent=MOBILE_UA, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        opts.update(viewport={"width": 1400, "height": 950})
    ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), **opts)
    await ctx.add_init_script("(() => { const a = Element.prototype.attachShadow; Element.prototype.attachShadow = function (o) { return a.call(this, { ...o, mode: 'open' }); }; })()")
    if not A.no_ext:
        await no_server(ctx)
    # מי קורא ל-fetch של videoplayback בלי range (לאתר את מקור שגיאות 403)
    await ctx.add_init_script("""(() => { const f = window.fetch; window.__vpStacks = [];
      window.fetch = function (i, o) { try { const u = String(i && i.url || i); if (/videoplayback/.test(u) && !/[&]range=/.test(u) && window.__vpStacks.length < 5) window.__vpStacks.push(u.slice(0, 120) + ' | ' + new Error().stack); } catch {} return f.apply(this, arguments); }; })()""")
    page = await ctx.new_page()
    page.on("console", lambda m: m.type == "error" and report.setdefault("console_errors", []).append(m.text[:300]))
    page.on("pageerror", lambda e: report.setdefault("page_errors", []).append(str(e)[:300]))

    async def headers_of(r):
        try:
            h = await r.request.all_headers()
            fr = r.frame.url[:80] if r.frame else None
        except Exception as e:
            h, fr = {"err": str(e)[:100]}, None
        report.setdefault("err_headers", []).append({"frame": fr, "worker": bool(r.request.service_worker), "h": {k: v for k, v in h.items() if k in ("origin", "referer", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-site", "err")}})

    def on_resp(r):
        if r.status == 403 and len(report.get("err_headers", [])) < 3:
            asyncio.ensure_future(headers_of(r))
        if r.status >= 400:
            u = r.url
            report.setdefault("http_errors", []).append({"status": r.status, "url": u[:1600], "range": "&range=" in u and u.split("&range=")[1][:30],
                "sabr": "sabr=1" in u, "method": r.request.method, "ours": "&range=" in u and "c=VISIONOS" in u, "afterStep": len(report["steps"]), "rtype": r.request.resource_type})
    page.on("response", on_resp)
    # מי יזם את הבקשות ל-videoplayback (initiator של CDP) – כדי לדעת אם שגיאות 403 הן שלנו
    cdp = await ctx.new_cdp_session(page)
    await cdp.send("Network.enable")

    def on_req(ev):
        u = ev["request"]["url"]
        if "videoplayback" in u and "&range=" not in u:
            st = ev.get("initiator", {}).get("stack") or {}
            frames = []
            while st and len(frames) < 12:
                frames += [f"{f['functionName']}@{f['url'].split('/')[-1]}:{f['lineNumber']}" for f in st.get("callFrames", [])]
                st = st.get("parent")
            report.setdefault("videoplayback_initiators", []).append({"q": u.split("?")[1][:80], "frames": frames[:12]})
    cdp.on("Network.requestWillBeSent", on_req)
    return ctx, page


async def watch(page, url):
    await page.goto(url, wait_until="domcontentloaded", timeout=120000)
    await asyncio.sleep(9)


async def www_download(page):
    await watch(page, f"https://www.youtube.com/watch?v={A.video}")
    await page.evaluate("() => window.scrollTo(0, 400)")
    await asyncio.sleep(2)
    step("row-before", row=await page.evaluate(ROW_JS))
    await shot(page, "1-before")
    await page.locator("ytd-watch-metadata ytd-download-button-renderer button").first.click()
    await asyncio.sleep(3)
    step("dialog", texts=await page.evaluate(SHADOW_TEXT_JS),
         checked=await page.evaluate("() => { const r=[document];for(let i=0;i<r.length;i++)for(const e of r[i].querySelectorAll('*'))if(e.shadowRoot)r.push(e.shadowRoot); for (const x of r) { const d = x.querySelector('.dq-dialog'); if (d) return { checked: [...d.querySelectorAll('input:checked')].map(i => i.value), okDisabled: d.querySelector('.dq-ok').disabled }; } }"))
    await shot(page, "2-dialog")
    downloads = []
    page.on("download", lambda d: downloads.append(d))
    ok = await page.evaluate(CLICK_JS, [A.choice, "הורדה" if A.lang == "he" else "Download"])
    step("start", clicked=ok)
    await asyncio.sleep(1.2)
    step("progress", row=await page.evaluate(ROW_JS), texts=await page.evaluate(SHADOW_TEXT_JS),
         icon=await page.evaluate("() => document.querySelector('ytd-watch-metadata .ytu-dl-icon')?.outerHTML"))
    await shot(page, "3-progress")
    # "לצפייה בסרטון" בטוסט → דף ההורדות בזמן ההורדה
    await page.evaluate(CLICK_JS, [None, "לצפייה בסרטון" if A.lang == "he" else "View"])
    await asyncio.sleep(2.5)
    step("downloads-page-during", url=page.url, grid=await page.evaluate("() => document.querySelector('ytd-browse:not([hidden]) ytd-rich-grid-renderer')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300)"))
    await shot(page, "3b-downloads-page")
    for _ in range(300):
        if downloads:
            break
        await asyncio.sleep(1)
    dl = downloads[0]
    target = OUT / ("probe-" + dl.suggested_filename)
    await dl.save_as(str(target))
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "compact", str(target)], capture_output=True, text=True)
    step("file", file=target.name, size=target.stat().st_size, ffprobe=(probe.stdout or probe.stderr).strip())
    await asyncio.sleep(2)
    await shot(page, "3c-downloads-page-done")
    await page.go_back()
    await asyncio.sleep(4)
    await page.evaluate("() => window.scrollTo(0, 400)")
    await page.mouse.move(5, 900)
    await asyncio.sleep(1.5)
    step("row-after", row=await page.evaluate(ROW_JS), texts=await page.evaluate(SHADOW_TEXT_JS))
    await shot(page, "4-after")
    await asyncio.sleep(20)  # הנגן ממשיך לנגן – שגיאות שמגיעות אחרי ההורדה
    step("after-wait")


async def open_watch_menu(page):
    await page.locator("ytd-watch-metadata #actions ytd-menu-renderer yt-button-shape#button-shape button, ytd-watch-metadata #actions ytd-menu-renderer > yt-button-shape button").last.click()
    await asyncio.sleep(1.5)


MENU_JS = """() => [...document.querySelectorAll('tp-yt-iron-dropdown:not([aria-hidden=true]) ytd-menu-service-item-download-renderer, tp-yt-iron-dropdown:not([aria-hidden=true]) ytd-menu-service-item-renderer, tp-yt-iron-dropdown:not([aria-hidden=true]) yt-list-item-view-model, tp-yt-iron-dropdown:not([aria-hidden=true]) yt-download-list-item-view-model')]
  .filter(e => e.offsetParent).map(e => ({ tag: e.tagName, text: e.textContent.replace(/\\s+/g, ' ').trim(), icon: (e.querySelector('path') || {}).getAttribute?.('d')?.slice(0, 40), attrs: [...e.attributes].map(a => a.name).join(',') }))"""


SIDE_MENU_JS = """async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const item = document.querySelector('#secondary yt-lockup-view-model');
  const id = item.querySelector('a[href*="v="]').getAttribute('href').match(/v=([\\w-]{11})/)[1];
  const btns = [...item.querySelectorAll('button')];
  btns[btns.length - 1].scrollIntoView({ block: 'center' });
  await sleep(300);
  btns[btns.length - 1].click();
  await sleep(1500);
  const dl = [...document.querySelectorAll('yt-download-list-item-view-model')].filter(e => e.offsetParent);
  return { id, items: dl.map(e => ({ text: e.textContent.trim(), icon: (e.querySelector('svg path') || { getAttribute: () => '' }).getAttribute('d').slice(0, 24) })) };
}"""


async def www_menu(page):
    await watch(page, f"https://www.youtube.com/watch?v={A.video}")
    r = await page.evaluate(SIDE_MENU_JS)
    step("menu-before", **r)
    await page.keyboard.press("Escape")
    await asyncio.sleep(1)
    # מסמנים את הסרטון שבכרטיס כאילו הורד (בלי הורדה אמיתית)
    await page.evaluate("id => { localStorage.setItem('ytu-dl-done', JSON.stringify([{ id, title: 'x', at: 1 }])); window.dispatchEvent(new StorageEvent('storage', { key: 'ytu-dl-done' })); }", r["id"])
    await asyncio.sleep(1)
    r = await page.evaluate(SIDE_MENU_JS)
    await asyncio.sleep(1)
    step("menu-done", **r)
    await shot(page, "1-menu-done")
    item = page.locator("tp-yt-iron-dropdown yt-download-list-item-view-model").first
    await item.click()
    await asyncio.sleep(1.5)
    step("after-remove", texts=await page.evaluate(SHADOW_TEXT_JS), done=await page.evaluate("() => localStorage.getItem('ytu-dl-done')"),
         menuOpen=await page.evaluate("() => [...document.querySelectorAll('yt-download-list-item-view-model')].some(e => e.offsetParent)"))
    await shot(page, "2-removed-toast")
    await page.evaluate(CLICK_JS, [None, "ביטול" if A.lang == "he" else "Undo"])
    await asyncio.sleep(1)
    step("after-undo", done=await page.evaluate("() => localStorage.getItem('ytu-dl-done')"))
    r = await page.evaluate(SIDE_MENU_JS)
    step("menu-after-undo", **r)
    await shot(page, "3-menu-after-undo")
    await page.keyboard.press("Escape")
    # דף ההורדות: הסרה מהתפריט של הכרטיס
    await page.goto("https://www.youtube.com/feed/downloads", wait_until="domcontentloaded")
    await asyncio.sleep(7)
    step("downloads-page", grid=await page.evaluate("() => document.querySelector('ytd-browse:not([hidden]) ytd-rich-grid-renderer')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300)"))
    await shot(page, "4-downloads-page")


async def downloads_page(page):
    await watch(page, f"https://www.youtube.com/watch?v={A.video}")
    await page.evaluate("id => localStorage.setItem('ytu-dl-done', JSON.stringify([{ id, title: 'Me at the zoo', author: 'jawed', length: 19, at: Date.now() }, { id: 'dQw4w9WgXcQ', title: 'Rick', length: 213, at: Date.now() + 1 }]))", A.video)
    await page.goto("https://www.youtube.com/feed/downloads", wait_until="domcontentloaded")
    await asyncio.sleep(8)
    step("page", text=await page.evaluate("() => document.querySelector('ytd-browse:not([hidden]) ytd-rich-grid-renderer')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400)"))
    await shot(page, "1")


async def mobile(page):
    await page.goto(f"https://m.youtube.com/watch?v={A.video}&app=m", wait_until="domcontentloaded", timeout=120000)
    await asyncio.sleep(10)
    bar = "() => [...document.querySelectorAll('ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions > *')].map(e => e.tagName + ':' + (e.querySelector('button')?.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)))"
    step("bar", bar=await page.evaluate(bar))
    await shot(page, "1-watch")
    more = page.locator("ytm-slim-video-action-bar-renderer .slim-action-more-button button, ytm-slim-video-action-bar-renderer button-view-model button[aria-label='עוד'], ytm-slim-video-action-bar-renderer button-view-model button[aria-label='More']").first
    if await more.count():
        await more.click()
        await asyncio.sleep(2)
        step("sheet-tree", tree=await page.evaluate(TREE_JS, "bottom-sheet-container yt-list-item-view-model"))
        step("more-button", tree=await page.evaluate(TREE_JS, "ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions > button-view-model:last-of-type"))
        step("bar-tree", tree=await page.evaluate(TREE_JS, "ytm-slim-video-action-bar-renderer"))
        step("sheet", items=await page.evaluate("() => [...document.querySelectorAll('bottom-sheet-container yt-list-item-view-model')].map(e => e.textContent.trim())"))
        await shot(page, "2-sheet")
        dl = page.locator("bottom-sheet-container yt-list-item-view-model", has_text="הורדה" if A.lang == "he" else "Download").first
        if await dl.count():
            await dl.click()
            await asyncio.sleep(3)
            step("after-click", texts=await page.evaluate(SHADOW_TEXT_JS), url=page.url,
                 sheetOpen=await page.evaluate("() => !!document.querySelector('bottom-sheet-container yt-list-item-view-model')"))
            await shot(page, "3-dialog")
            await page.evaluate(CLICK_JS, [None, "ביטול" if A.lang == "he" else "Cancel"])
            # אחרי הורדה (מסומן ב-localStorage): בגיליון "הסרה מההורדות", ולחיצה מוחקת מיד עם טוסט "ביטול"
            await page.evaluate("id => { localStorage.setItem('ytu-dl-done', JSON.stringify([{ id, title: 'x', at: 1 }])); window.dispatchEvent(new StorageEvent('storage', { key: 'ytu-dl-done' })); }", A.video)
            await asyncio.sleep(1)
            await more.click()
            await asyncio.sleep(2)
            step("sheet-done", items=await page.evaluate("() => [...document.querySelectorAll('bottom-sheet-container yt-list-item-view-model')].map(e => e.textContent.trim() + ' ' + ((e.querySelector('svg path') || { getAttribute: () => '-' }).getAttribute('d') || '').slice(0, 12))"))
            await shot(page, "4-sheet-done")
            rm = page.locator("bottom-sheet-container yt-list-item-view-model[data-ytu-mweb-dl-item]").first
            if await rm.count():
                await rm.click()
                await asyncio.sleep(1.5)
                step("sheet-removed", texts=await page.evaluate(SHADOW_TEXT_JS), done=await page.evaluate("() => localStorage.getItem('ytu-dl-done')"))
                await shot(page, "5-removed")
    else:
        step("no-more-button")


async def music(page):
    await page.goto(f"https://music.youtube.com/watch?v={A.video}", wait_until="domcontentloaded", timeout=120000)
    await asyncio.sleep(10)
    await shot(page, "1")
    menu = await page.evaluate("""async () => { const b = document.querySelector('ytmusic-player-bar ytmusic-menu-renderer yt-button-shape button, ytmusic-player-bar #button-shape button'); if (!b) return 'no menu'; b.click(); await new Promise(r => setTimeout(r, 1500));
      return [...document.querySelectorAll('ytmusic-menu-popup-renderer tp-yt-paper-listbox > *')].map(e => e.tagName + ':' + e.textContent.trim()); }""")
    step("player-bar-menu", items=menu)
    step("music-dl-item", tree=await page.evaluate(TREE_JS, "ytmusic-menu-popup-renderer ytmusic-menu-service-item-download-renderer"))
    await shot(page, "2-menu")
    dl = page.locator("ytmusic-menu-popup-renderer ytmusic-menu-service-item-download-renderer").first
    if await dl.count():
        downloads = []
        page.on("download", lambda d: downloads.append(d))
        await dl.click()
        await asyncio.sleep(2)
        step("after-click", texts=await page.evaluate(SHADOW_TEXT_JS))
        await shot(page, "3-after-click")
        for _ in range(120):
            if downloads:
                break
            await asyncio.sleep(1)
        step("download", file=downloads and downloads[0].suggested_filename)
        await asyncio.sleep(2)
        menu = await page.evaluate("""async () => { const b = document.querySelector('ytmusic-player-bar ytmusic-menu-renderer yt-button-shape button, ytmusic-player-bar #button-shape button'); b.click(); await new Promise(r => setTimeout(r, 1500));
          return [...document.querySelectorAll('ytmusic-menu-popup-renderer ytmusic-menu-service-item-download-renderer')].map(e => e.textContent.trim() + ' ' + (e.querySelector('svg path')?.getAttribute('d') || '').slice(0, 14)); }""")
        step("menu-after-download", items=menu)
        await shot(page, "4-menu-after")
    step("buttons", dl=await page.evaluate("() => [...document.querySelectorAll('ytmusic-download-button-renderer, ytmusic-menu-service-item-download-renderer')].length"))


async def popup(page):
    """חלון התוסף ב-380px עם עבודות מדומות באחסון (בלי שרת): יורד 40%, מוכן, שגיאה – מודדים שהשורות לא נמעכות."""
    ctx = page.context
    sw = next(w for w in ctx.service_workers if w.url.endswith("/background.js"))
    ext_id = sw.url.split("/")[2]
    now = 1789000000000
    jobs = [
        {"localId": "a", "jobId": "fake-a", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "videoId": "jNQXAC9IVRw", "type": "video", "quality": "720", "title": "Me at the zoo – כותרת ארוכה מאוד כדי לבדוק קיצור עם שלוש נקודות", "state": "downloading", "percent": 40, "created": now},
        {"localId": "b", "jobId": "fake-b", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "videoId": "dQw4w9WgXcQ", "type": "audio", "quality": "mp3", "title": "Rick Astley - Never Gonna Give You Up", "state": "done", "size": 3400000, "short_url": "https://did.li/abc123", "drive_url": "https://drive.google.com/file/d/x/view", "created": now - 1},
        {"localId": "c", "jobId": "fake-c", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "videoId": "aqz-KE-bpKQ", "type": "video", "quality": "1080", "title": "Big Buck Bunny", "state": "error", "error": {"code": "YT_BOT_CHECK", "message": "YouTube asked to confirm you are not a bot"}, "created": now - 2},
    ]
    # מצב "יורד" נשמר כמו שהוא: השרת מת (127.0.0.1:9) ו-script.google.com חסום, כך שה-polling לא מגיע לשום מקום
    await sw.evaluate("j => new Promise(r => chrome.storage.local.set({ driveJobs: j }, r))", jobs)
    # 400: גוף החלון 380px + פס גלילה אנכי (כמו שכרום מרחיב את החלון), כדי שלא ייראה פס גלילה אופקי מדומה
    await page.set_viewport_size({"width": 400, "height": 900})
    await page.goto(f"chrome-extension://{ext_id}/popup.html", wait_until="domcontentloaded")
    await asyncio.sleep(6)
    step("thumbs", loaded=await page.evaluate(r"""() => Promise.all([...document.querySelectorAll('.job-thumb')].map(t => new Promise(r => {
      const u = (t.style.backgroundImage.match(/url\("(.+)"\)/) || [])[1]; if (!u) return r('none');
      const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r('error ' + u); i.src = u; })))"""))
    rows = await page.evaluate("""() => [...document.querySelectorAll('ul.jobs li')].map(li => {
      const w = s => { const e = li.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
      const lr = li.getBoundingClientRect();
      const over = [...li.querySelectorAll('*')].some(e => { const r = e.getBoundingClientRect(); return r.bottom > lr.bottom + 0.5 || r.right > lr.right + 0.5 || r.left < lr.left - 0.5; });
      return { li: [Math.round(lr.width), Math.round(lr.height)], thumb: w('.job-thumb'), title: w('.job-title'), meta: w('.job-meta'), bar: w('.bar'), link: w('.job-link'), err: w('.job-err'), overflow: over, text: li.textContent.slice(0, 80) }; })""")
    step("rows", dir=await page.evaluate("() => document.documentElement.dir"), rows=rows,
         scrollX=await page.evaluate("() => document.documentElement.scrollWidth - innerWidth"))
    await page.evaluate("() => document.querySelector('#jobs').scrollIntoView()")
    await shot(page, f"1-jobs-{A.lang}")


async def eval_js(page):
    await watch(page, A.url or f"https://www.youtube.com/watch?v={A.video}")
    for i, f in enumerate(A.js):
        code = Path(f).read_text(encoding="utf-8")
        try:
            step(f"js{i}", result=await page.evaluate(code))
        except Exception as e:
            step(f"js{i}", error=str(e)[:800])
        await shot(page, f"js{i}")


async def main():
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        ctx, page = await launch(p, mobile=A.scenario == "mobile" or "m.youtube" in (A.url or ""))
        try:
            await {"www-download": www_download, "www-menu": www_menu, "downloads-page": downloads_page,
                   "mobile": mobile, "music": music, "popup": popup, "eval": eval_js}[A.scenario](page)
        except Exception as e:
            step("exception", error=str(e)[:500])
        finally:
            await ctx.close()
    errs = report.get("http_errors", [])
    report["http_error_summary"] = {}
    for e in errs:
        k = f"{e['status']} {e['url'].split('?')[0][:60]} {e['rtype']}"
        report["http_error_summary"][k] = report["http_error_summary"].get(k, 0) + 1
    (OUT / f"probe-{A.scenario}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("http errors:", json.dumps(report["http_error_summary"], ensure_ascii=False))
    print("console errors:", len(report.get("console_errors", [])), json.dumps(report.get("console_errors", [])[:8], ensure_ascii=False)[:1500])


asyncio.run(main())
