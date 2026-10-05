#!/usr/bin/env python3
"""build_web.py — assemble the single-file Netlify-ready index.html.

Repo layout:
  index.html                    <- emitted here (repo root, offline copy)
  public/index.html             <- emitted here (deploy output: Vercel/Netlify)
  logo.png                      -> tab favicon tile (resized to 128x128)
  wordmark_alpha.png            -> transparent-bg wordmark (header + welcome)
  index_template.html           -> page template with __PLACEHOLDER__ slots
  ocrad.js                      -> pure offline OCR engine
  spicy_data.js / spicy_engine.js / spicy_links.js / app.js / seatmap.js -> inlined scripts
  seatmap.css                    -> inlined Seat Map route styles

Run from anywhere:  python3 build_web.py
"""
import base64, pathlib, io, subprocess, tempfile

# Always build and deploy the working single-file application.
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

mark = png64(SRC / "logo.png", "128x128")          # tab favicon
full = png64(SRC / "wordmark_alpha.png", "640x")  # header + welcome wordmark

tpl = (SRC / "index_template.html").read_text(encoding="utf-8")
ocrad = (SRC / "ocrad.js").read_text(encoding="utf-8") if (SRC / "ocrad.js").exists() else ""
data = (SRC / "spicy_data.js").read_text(encoding="utf-8")
engine = (SRC / "spicy_engine.js").read_text(encoding="utf-8")
links = (SRC / "spicy_links.js").read_text(encoding="utf-8")
app = (SRC / "app.js").read_text(encoding="utf-8")
seatmap_css = (SRC / "seatmap.css").read_text(encoding="utf-8")
seatmap_js = (SRC / "seatmap.js").read_text(encoding="utf-8")
html = (tpl.replace("__LOGO_MARK_B64__", mark)
           .replace("__LOGO_FULL_B64__", full)
           .replace("__OCRAD_JS__", ocrad)
           .replace("__SPICY_DATA__", data)
           .replace("__SPICY_ENGINE__", engine)
           .replace("__SPICY_LINKS__", links)
           .replace("__APP_JS__", app)
           .replace("__SEATMAP_CSS__", seatmap_css)
           .replace("__SEATMAP_JS__", seatmap_js))

# Keep both historical entry points in sync: index.html is the deploy root;
# app.html remains a friendly direct URL for existing bookmarks.
for name in ("index.html", "app.html"):
    dst = SRC / name
    dst.write_text(html, encoding="utf-8")
    print(f"Built {dst}: {len(html):,} bytes ({len(html)/1024/1024:.2f} MB)")

# Deploy output. public/ is the default output directory on Vercel and the
# publish directory in netlify.toml. It contains only self-contained app pages,
# never the repo's screenshots, source files or archives.
pub = SRC / "public"
pub.mkdir(exist_ok=True)
for name in ("index.html", "app.html", "seatmap.html"):
    dst = pub / name
    dst.write_text(html, encoding="utf-8")
    print(f"Built {dst}: {len(html):,} bytes ({len(html)/1024/1024:.2f} MB)")
