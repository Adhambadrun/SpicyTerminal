#!/usr/bin/env python3
"""build_web.py — assemble the single-file Netlify-ready index.html.

Repo layout:
  index.html                    <- emitted here (repo root, offline copy)
  public/index.html             <- emitted here (deploy output: Vercel/Netlify)
  logo.png                      -> tab favicon tile (resized to 128x128)
  wordmark_alpha.png            -> transparent-bg wordmark (header + welcome)
  index_template.html           -> page template with __PLACEHOLDER__ slots
  ocrad.js                      -> pure offline OCR engine
  spicy_data.js / spicy_engine.js / app.js -> inlined scripts

Run from anywhere:  python3 build_web.py
"""
import base64, pathlib, io, subprocess, tempfile

SRC = pathlib.Path(__file__).resolve().parent

def png64(src, resize):
    """Return a resized PNG as base64 without making Pillow mandatory.

    The app is a static artifact and should still build on a clean machine.
    Pillow is convenient locally, but ImageMagick or the original PNG are
    perfectly adequate fallbacks and avoid a mysterious build failure.
    """
    try:
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
    except ImportError:
        # ImageMagick is available on common Linux/macOS developer images.
        # Use a temporary file so no generated assets are left in the repo.
        try:
            with tempfile.NamedTemporaryFile(suffix=".png") as out:
                subprocess.run(["convert", str(src), "-strip", "-resize", resize, str(out.name)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return base64.b64encode(pathlib.Path(out.name).read_bytes()).decode()
        except (OSError, subprocess.SubprocessError):
            # Last resort: a valid unresized source still produces a working
            # site; the build must never fail solely because an optional image
            # optimizer is unavailable.
            return base64.b64encode(src.read_bytes()).decode()

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

# Deploy output.  public/ is the default output directory on Vercel and the
# publish directory in netlify.toml, so a `git push` deploy ships ONLY the
# single-file app — never the repo's screenshots, sources or archives.
pub = SRC / "public"
pub.mkdir(exist_ok=True)
(pub / "index.html").write_text(html, encoding="utf-8")
print(f"Built {pub / 'index.html'}: {len(html):,} bytes ({len(html)/1024/1024:.2f} MB)")
