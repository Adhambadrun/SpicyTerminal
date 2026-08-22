#!/usr/bin/env python3
"""build_web.py — assemble the single-file Netlify-ready index.html.

Repo layout:
  index.html                    <- emitted here (repo root, build artifact)
  assets/logo.png               -> tab favicon tile (resized to 128x128)
  assets/logo_wordmark_new_original.png -> source of the wordmark
  src/wordmark_alpha.png        -> transparent-bg wordmark (header + welcome)
  src/index_template.html       -> page template with __PLACEHOLDER__ slots
  src/spicy_data.js / spicy_engine.js / app.js -> inlined scripts

Run from anywhere:  python3 src/build_web.py
Regenerate wordmark_alpha.png from the original upload:
  magick "assets/logo_wordmark_new_original.png" -alpha on \
    -channel A -fx 'max(max(r,g),b)' \
    -channel RGB -fx 'u.a<0.002?0:u/u.a' \
    -channel A -fx 'a<0.04?0:a' +channel /tmp/wm.png
  magick /tmp/wm.png -crop "$(magick /tmp/wm.png -alpha extract -threshold 4% -format '%@' info:)" +repage src/wordmark_alpha.png
"""
import base64, pathlib, subprocess, tempfile, os

SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parent

def png64(src, resize):
    out = tempfile.mktemp(suffix=".png")
    subprocess.run(["magick", str(src), "-resize", resize, out], check=True)
    b = base64.b64encode(open(out, "rb").read()).decode()
    os.unlink(out)
    return b

tpl = (SRC / "index_template.html").read_text(encoding="utf-8")
mark = png64(ROOT / "assets" / "logo.png", "128x128")   # tab favicon (the S tile)
full = png64(SRC / "wordmark_alpha.png", "640x")        # header + welcome wordmark
data = (SRC / "spicy_data.js").read_text(encoding="utf-8")
engine = (SRC / "spicy_engine.js").read_text(encoding="utf-8")
app = (SRC / "app.js").read_text(encoding="utf-8")
html = (tpl.replace("__LOGO_MARK_B64__", mark)
           .replace("__LOGO_FULL_B64__", full)
           .replace("__SPICY_DATA__", data)
           .replace("__SPICY_ENGINE__", engine)
           .replace("__APP_JS__", app))
dst = ROOT / "index.html"
dst.write_text(html, encoding="utf-8")
print(dst, len(html), "bytes")
