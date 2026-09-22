"""בונה את התוסף ואת סקריפט הטמפרמונקי מתוך src/.

python build.py  ->  extension/  (לטעינה ב-chrome://extensions)
                     userscript/youtube-premium.user.js
                     dist/youtube-premium-extension.zip
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
EXT = ROOT / "extension"

# סדר הקבצים בחבילה שרצה בדף. כל הקבצים חולקים scope אחד (בתוך IIFE).
CORE = ["settings.js"]
BUNDLE = [
    "mux.js",
    "features/util.js",
    "features/ads.js",
    "features/background-play.js",
    "features/pip.js",
    "features/quality.js",
    "features/speed.js",
    # vendor נטען לפני mp3.js שמשתמש בו. lame.min.js הוא LGPL-3.0 – נשמר
    # כקובץ נפרד ומיוחס ב-README (lame.sourceforge.net).
    "vendor/lame.min.js",
    "mp3.js",
    "features/download.js",
    "features/official-button.js",
    "features/panel.js",
    "features/main.js",
]


def read(name):
    return (SRC / name).read_text(encoding="utf-8").strip() + "\n"


def bundle(platform):
    body = "\n".join([read(name) for name in [*CORE, platform, *BUNDLE]])
    indented = "\n".join(("  " + line) if line else "" for line in body.splitlines())
    return f"(() => {{\n  'use strict';\n  if (window.__ytuLoaded) return;\n  window.__ytuLoaded = true;\n\n{indented}\n}})();\n"


def build_extension():
    if EXT.exists():
        shutil.rmtree(EXT)
    EXT.mkdir()
    for name in ["manifest.json", "settings.js", "bridge.js", "popup.html", "popup.js"]:
        shutil.copy(SRC / name, EXT / name)
    shutil.copytree(SRC / "icons", EXT / "icons")
    note = "// נוצר אוטומטית ע\"י build.py מתוך src/ – לא לערוך ישירות.\n"
    (EXT / "main.js").write_text(note + bundle("platform-extension.js"), encoding="utf-8")
    return EXT


def build_userscript(version):
    header = f"""// ==UserScript==
// @name         יוטיוב פרימיום
// @author       צול גאה – TSOOLGEE.UK
// @homepageURL  https://github.com/tsoolgee/youtube-premium
// @downloadURL  https://raw.githubusercontent.com/tsoolgee/youtube-premium/main/userscript/youtube-premium.user.js
// @updateURL    https://raw.githubusercontent.com/tsoolgee/youtube-premium/main/userscript/youtube-premium.user.js
// @namespace    https://github.com/tsoolgee/youtube-premium
// @version      {version}
// @description  בלי פרסומות, ניגון ברקע, הורדת וידאו ו-MP3 ישירות בדפדפן, חלון צף, איכות מרבית ומהירויות עד פי 4
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://music.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

// נוצר אוטומטית ע"י build.py מתוך src/ – לא לערוך ישירות.
"""
    out = ROOT / "userscript" / "youtube-premium.user.js"
    out.parent.mkdir(exist_ok=True)
    out.write_text(header + bundle("platform-userscript.js"), encoding="utf-8")
    return out


def build_zip():
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    out = dist / "youtube-premium-extension.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(EXT.rglob("*")):
            if f.is_file():
                z.write(f, "youtube-premium/" + f.relative_to(EXT).as_posix())
    return out


if __name__ == "__main__":
    version = json.loads(read("manifest.json"))["version"]
    print(build_extension())
    print(build_userscript(version))
    print(build_zip())
