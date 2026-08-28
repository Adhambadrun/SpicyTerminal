#!/usr/bin/env python3
"""build_web.py — assemble the single-file Netlify-ready index.html.

Repo layout:
  index.html                    <- emitted here (repo root, build artifact)
  logo.png                      -> tab favicon tile (resized to 128x128)
  wordmark_alpha.png            -> transparent-bg wordmark (header + welcome)
  index_template.html           -> page template with __PLACEHOLDER__ slots
  ocrad.js                      -> pure offline OCR engine
  spicy_data.js / spicy_engine.js / app.js -> inlined scripts

Run from anywhere:  python3 build_web.py
"""
import base64, pathlib, io

SRC = pathlib.Path(__file__).resolve().parent

def png64(src, resize):
    from PIL import Image
    im = Image.open(src)
    if "x" in resize:
        w_s, h_s = resize.split("x")
        if w_s and h_s:
            w, h = int(w_s), int(h_s)
        elif w_s:
            w = int(w_s)
            h = int(im.height * (w / im.width))
        else:
            h = int(h_s)
            w = int(im.width * (h / im.height))
        im = im.resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

tpl = (SRC / "index_template.html").read_text(encoding="utf-8")
mark = png64(SRC / "logo.png", "128x128")          # tab favicon
full = png64(SRC / "wordmark_alpha.png", "640x")  # header + welcome wordmark
ocrad = (SRC / "ocrad.js").read_text(encoding="utf-8") if (SRC / "ocrad.js").exists() else ""
data = (SRC / "spicy_data.js").read_text(encoding="utf-8")
engine = (SRC / "spicy_engine.js").read_text(encoding="utf-8")
app = (SRC / "app.js").read_text(encoding="utf-8")

html = (tpl.replace("__LOGO_MARK_B64__", mark)
           .replace("__LOGO_FULL_B64__", full)
           .replace("__OCRAD_JS__", ocrad)
           .replace("__SPICY_DATA__", data)
           .replace("__SPICY_ENGINE__", engine)
           .replace("__APP_JS__", app))

dst = SRC / "index.html"
dst.write_text(html, encoding="utf-8")
print(f"Built {dst}: {len(html):,} bytes ({len(html)/1024/1024:.2f} MB)")
