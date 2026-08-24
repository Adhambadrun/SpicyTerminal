#!/usr/bin/env python3
"""Generate the team instruction pictures (pure PIL — text stays crisp).
Run:  python3 instructions/_make_pics.py
Output: instructions/step01..step09 PNG + ALL_STEPS.png"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root
OUTDIR = os.path.join(ROOT, "instructions")
D = "/usr/share/fonts/truetype/dejavu/"
def F(n, s): return ImageFont.truetype(D + n, s)
sans  = lambda s: F("DejaVuSans.ttf", s)
sansb = lambda s: F("DejaVuSans-Bold.ttf", s)
mono  = lambda s: F("DejaVuSansMono.ttf", s)
monob = lambda s: F("DejaVuSansMono-Bold.ttf", s)

BG="#05080b"; PANE="#0a0f14"; LINE="#17222b"; OUTG="#51e07c"; RED="#e2574b"
GREEN2="#1f9d55"; GREEN="#53d977"; DIM="#546a77"; TXT="#dbe7de"; BTND="#18222b"; BTNB="#22313c"
W,H = 1600,900
EH = H-116   # bottom of drawable area (caption strip below)

def canvas(bg=BG):
    im = Image.new("RGB", (W,H), bg)
    return im, ImageDraw.Draw(im)

def caption(d, s, sub=None):
    d.rectangle([0, EH, W, H], fill="#0b1117")
    d.line([0, EH, W, EH], fill="#1e2b34", width=2)
    f = sansb(34)
    tw = d.textlength(s, font=f)
    d.text(((W-tw)/2, EH+18), s, font=f, fill="#eef4f7")
    if sub:
        f2 = sans(24)
        tw2 = d.textlength(sub, font=f2)
        d.text(((W-tw2)/2, EH+66), sub, font=f2, fill="#7f95a0")

def badge(d, x, y, n):
    r = 30
    d.ellipse([x-r, y-r, x+r, y+r], fill=RED, outline="white", width=3)
    d.text((x, y), str(n), font=sansb(36), fill="white", anchor="mm")

def ring(d, box, color=GREEN, w=6, r=12, pad=10):
    x0,y0,x1,y1 = box
    d.rounded_rectangle([x0-pad-8, y0-pad-8, x1+pad+8, y1+pad+8], radius=r+8, outline="#1d5c37", width=3)
    d.rounded_rectangle([x0-pad, y0-pad, x1+pad, y1+pad], radius=r, outline=color, width=w)

def arrow(d, x0, y0, x1, y1, color=GREEN, w=6):
    d.line([x0, y0, x1, y1], fill=color, width=w)
    import math
    ang = math.atan2(y1-y0, x1-x0)
    for da in (2.6, -2.6):
        d.line([x1, y1, x1+26*math.cos(ang+da), y1+26*math.sin(ang+da)], fill=color, width=w)

def btn(d, x, y, w, h, label, kind="dark", font=None, highlight=False):
    styles = {"convert": (RED, "#ffffff"), "ai": (GREEN2, "#04240f"),
              "dark": (BTND, "#9fb4bf"), "copy": (BTND, "#e6f0ea"), "enter": ("#22c55e", "#05230f")}
    bgc, fgc = styles[kind]
    d.rounded_rectangle([x, y, x+w, y+h], radius=8, fill=bgc,
                        outline=BTNB if kind in ("dark","copy") else None, width=2)
    f = font or monob(22)
    d.text((x+w/2, y+h/2), label, font=f, fill=fgc, anchor="mm")
    return (x, y, x+w, y+h)

WORD = None
def wordmark(width=330):
    global WORD
    if WORD is None:
        WORD = Image.open(os.path.join(ROOT, "src", "wordmark_alpha.png")).convert("RGBA")
    r = width / WORD.width
    return WORD.resize((width, int(WORD.height*r)), Image.LANCZOS)

def header(im, d):
    wm = wordmark(330); im.paste(wm, (44, 26), wm)
    d.text((W-44, 46), "made by Lamar Garcia", font=mono(20), fill="#5b6e77", anchor="ra")

def panes(im, d, y0=96, y1=612, in_lines=(), out_lines=(), cursor=False, in_dim=False):
    for i in range(2):
        x0 = 44 + i*760; x1 = x0 + 712
        d.rounded_rectangle([x0, y0, x1, y1], radius=10, fill=PANE, outline=LINE, width=2)
        d.text((x0+22, y0+18), "INPUT" if i == 0 else "OUTPUT",
               font=monob(17), fill=OUTG if i == 1 else "#7f95a0")
    ty = y0 + 60
    col = "#3d4f57" if in_dim else TXT
    for ln in in_lines:
        d.text((66, ty), ln, font=mono(19), fill=col); ty += 30
    if cursor: d.line([66, ty+4, 66, ty+28], fill="#9fb4bf", width=3)
    ty = y0 + 60
    for ln in out_lines:
        d.text((820, ty), ln, font=mono(19), fill=OUTG); ty += 30
    return (44, y0, 756, y1), (800, y0, 1512, y1)

def bar(d, y=636, thumbs=0, marks=None):
    x = 44
    boxes = {}
    boxes["convert"] = btn(d, x, y, 168, 60, "CONVERT", "convert"); x += 184
    boxes["ai"]      = btn(d, x, y, 168, 60, "AI AUTO", "ai");      x += 184
    boxes["attach"]  = btn(d, x, y, 168, 60, "+ ATTACH", "dark");   x += 184
    boxes["clear"]   = btn(d, x, y, 64, 60, "×", "dark", font=monob(30)); x += 80
    for i in range(thumbs):   # screenshot proof thumbnails
        d.rounded_rectangle([x, y+9, x+62, y+51], radius=4, fill="#141d24", outline=BTNB, width=2)
        d.rectangle([x+8, y+17, x+54, y+21], fill="#2c3a44")
        d.rectangle([x+8, y+25, x+44, y+29], fill="#22303a")
        d.rectangle([x+8, y+33, x+50, y+37], fill="#22303a")
        d.rectangle([x+8, y+41, x+36, y+45], fill="#5b2c26")
        x += 72
    boxes["copy"] = btn(d, W-44-150, y, 150, 60, "COPY", "copy")
    return boxes

def status(d, y=724, left="READY", warn=False):
    d.text((44, y), left, font=monob(18), fill="#f0a35c" if warn else GREEN)
    t = "Generate Api"
    d.text((W-260, y), t, font=mono(18), fill="#5e7681", anchor="ra")
    tw = d.textlength(t, font=mono(18))
    d.line([W-260, y+26, W-260, y+26], fill="#3e4f59", width=0)  # placeholder
    d.text((W-44, y), "Report a bug", font=mono(18), fill="#3e4f59", anchor="ra")

def app(im, d, **kw):
    header(im, d)
    boxes = {}
    pb, ob = panes(im, d, in_lines=kw.get("in_lines", ()), out_lines=kw.get("out_lines", ()),
                   cursor=kw.get("cursor", False), in_dim=kw.get("in_dim", False))
    boxes["input"], boxes["output"] = pb, ob
    boxes.update(bar(d, thumbs=kw.get("thumbs", 0)))
    status(d, left=kw.get("status", "READY"), warn=kw.get("warn", False))
    return boxes

IN_LN = ["Qatar Airways QR 1059", "Tue 18 Nov  Doha (DOH) - Cairo (CAI)",
         "Dep 7:55 PM   Arr 10:35 PM", "Boeing 737 MAX 8   Economy (N)"]
OUT_LN = ["1 QR 1059 18NOV DOH CAI 755P 1035P N 38N 3.40 1284",
          "N / DEP-HAMAD INTL / ARR-CAIRO INTL / CABIN-ECONOMY"]

def browser(d, url, page_bg="#ffffff"):
    d.rounded_rectangle([20, 20, W-20, EH-20], radius=14, fill="#2b2d30", outline="#17181a", width=2)
    d.rounded_rectangle([36, 30, 700, 84], radius=10, fill="#3a3d41")
    d.text((82, 58), "SpicyTerminal", font=sans(22), fill="#e8eaed", anchor="lm")
    ring_fav = Image.open(os.path.join(ROOT, "assets", "logo.png")).convert("RGBA").resize((34, 34))
    return ring_fav, (36, 96, W-36, EH-36)

def chrome_bar(d, fav, url_txt):
    im = d._image
    im.paste(fav, (46, 40), fav)
    for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        d.ellipse([250+44*i, 46, 274+44*i, 70], fill=c)
    d.rounded_rectangle([380, 40, W-56, 76], radius=18, fill="#3c4043")
    d.ellipse([398, 50, 418, 66], outline="#9aa0a6", width=2)
    d.rectangle([404, 58, 412, 66], fill="#3c4043", outline="#9aa0a6", width=2)
    d.text((444, 58), url_txt, font=sans(24), fill="#e8eaed", anchor="lm")

PIX = "AIzaSyD4bX7kQ2mN8pL3vR9tC6wE1yU5iO0aS4dF7gH2jK9zX"

def save(im, name):
    im.save(os.path.join(OUTDIR, name))
    print("wrote", name)

# ---------------------------------------------------------------- step 1
def step01():
    im, d = canvas("#111315")
    fav, page = browser(d, "")
    chrome_bar(d, fav, "spicyterminal.netlify.app")
    d.rectangle(list(page), fill=BG)
    d.rounded_rectangle([page[0]+70, 130, page[2]-70, 205], radius=10, fill=PANE, outline=LINE, width=2)
    d.text((page[0]+95, 152), "INPUT", font=monob(17), fill="#7f95a0")
    d.rounded_rectangle([page[0]+70, 225, page[2]-70, 300], radius=10, fill=PANE, outline=LINE, width=2)
    d.text((page[0]+95, 247), "OUTPUT", font=monob(17), fill=OUTG)
    bar(d, y=340)
    ring(d, (380, 40, W-56, 76))
    badge(d, 352, 100, 1)
    caption(d, "Open your browser and go to:  spicyterminal.netlify.app", "Bookmark it — this is the whole app, nothing to install")
    save(im, "step01_open_site.png")

# ---------------------------------------------------------------- step 2
def step02():
    im, d = canvas()
    app(im, d, status="READY")
    back = im.filter(ImageFilter.GaussianBlur(7))
    im = back; d = ImageDraw.Draw(im)
    ov = Image.new("RGBA", (W, H), (4, 8, 12, 110))
    im.paste(ov, (0, 0), ov)
    cw, ch = 560, 470; cx, cy = (W-cw)//2, 170
    d.rounded_rectangle([cx, cy, cx+cw, cy+ch], radius=22, fill="#0c131a", outline="#1e2b34", width=2)
    wm = wordmark(420); im.paste(wm, (cx+(cw-420)//2, cy+42), wm)
    d.text((W/2, cy+200), "Made by Lamar García", font=monob(28), fill="#eef4f7", anchor="ma")
    d.text((W/2, cy+258), "Updates and bug fixes are", font=mono(20), fill="#637888", anchor="ma")
    d.text((W/2, cy+290), "applied automatically.", font=mono(20), fill="#637888", anchor="ma")
    eb = btn(d, W/2-120, cy+340, 240, 76, "ENTER", "enter", font=monob(30))
    ring(d, eb)
    badge(d, W/2+150, cy+330, 2)
    caption(d, "First visit only — press ENTER", "This welcome screen shows once; after that the app opens directly")
    save(im, "step02_press_enter.png")

# ---------------------------------------------------------------- step 3
def step03():
    im, d = canvas()
    bx = app(im, d, in_lines=IN_LN, out_lines=OUT_LN, cursor=True, status="OFFLINE ENGINE — 1 segment(s)")
    ring(d, bx["input"])
    badge(d, 26, 350, 3)
    caption(d, "Paste your flights with Ctrl+V — it converts by itself", "Text, emails, airline sites... no API key needed for text")
    save(im, "step03_paste_flights.png")

# ---------------------------------------------------------------- step 4
def step04():
    im, d = canvas()
    bx = app(im, d, in_lines=IN_LN, out_lines=OUT_LN, status="OFFLINE ENGINE — 1 segment(s)")
    ring(d, bx["copy"])
    badge(d, W-44-150-30, 612, 4)
    caption(d, "Answer appears on the right — press COPY, paste into BO (Ctrl+V)", "Copy happens ONLY when you press the button")
    save(im, "step04_press_copy.png")

# ---------------------------------------------------------------- step 5
def step05():
    im, d = canvas()
    bx = app(im, d, thumbs=1, status="1 screenshot(s) attached")
    x = 44+184*3+80
    ring(d, (x, 645, x+62, 687), r=6)
    badge(d, x+96, 636, 5)
    d.rounded_rectangle([180, 320, 640, 470], radius=8, fill="#101820", outline="#2c3a44", width=2)
    d.text((200, 340), "your screenshot", font=mono(18), fill="#546a77")
    d.text((200, 380), "QR 1059  DOH - CAI", font=mono(20), fill="#c9d8ce")
    d.text((200, 416), "18 Nov   7:55 PM", font=mono(20), fill="#c9d8ce")
    arrow(d, 660, 395, x-24, 616, color=GREEN, w=5)
    caption(d, "Pasting a picture also works — it converts automatically", "Small preview appears next to the × button so you know it landed")
    save(im, "step05_screenshot_proof.png")

# ---------------------------------------------------------------- step 6
def step06():
    im, d = canvas()
    app(im, d, in_lines=IN_LN, status="AI needs a Gemini key", warn=True)
    zoom = (830, 380, 1500, 520)
    d.rounded_rectangle(zoom, radius=12, fill="#0b1117", outline=GREEN, width=4)
    d.text((850, 400), "bottom right corner:", font=mono(18), fill="#7f95a0")
    gk = btn(d, 850, 440, 300, 60, "Generate Api", "dark", font=monob(22))
    rb = btn(d, 1170, 440, 300, 60, "Report a bug", "dark", font=monob(22))
    ring(d, gk)
    arrow(d, 1330, 530, 1315, 706, color=GREEN, w=5)
    badge(d, 810, 390, 6)
    caption(d, "Screenshots need the AI once — press  Generate Api  (bottom right)", "Only for pictures or very messy text; plain text never needs it")
    save(im, "step06_press_generate_api.png")

# ---------------------------------------------------------------- Google page scaffold
def google(url, d, im):
    fav, page = browser(d, "")
    chrome_bar(d, fav, url)
    d.rectangle(list(page), fill="#f8f9fa")
    d.text((page[0]+70, 150), "Google AI Studio", font=sansb(44), fill="#1f1f1f")
    d.text((page[0]+70, 215), "Get your Gemini API key", font=sans(28), fill="#5f6368")
    return page

# ---------------------------------------------------------------- step 7
def step07():
    im, d = canvas("#111315")
    page = google("aistudio.google.com/apikey", d, None)
    cw, ch = 860, 330; cx, cy = (W-cw)//2, 300
    d.rounded_rectangle([cx, cy, cx+cw, cy+ch], radius=14, fill="white", outline="#dadce0", width=2)
    d.text((cx+40, cy+40), "API keys", font=sansb(30), fill="#1f1f1f")
    d.text((cx+40, cy+95), "You need one free key. It takes about 20 seconds.", font=sans(24), fill="#5f6368")
    kb = (cx+40, cy+150, cx+360, cy+220)
    d.rounded_rectangle(kb, radius=10, fill="#1a73e8")
    d.text(((kb[0]+kb[2])/2, (kb[1]+kb[3])/2), "Create API key", font=sansb(28), fill="white", anchor="mm")
    d.text((cx+40, cy+250), "Sign in with any Google account if asked.", font=sans(22), fill="#5f6368")
    ring(d, kb, color="#1a73e8", r=10)
    badge(d, cx+20, cy+130, 7)
    caption(d, "Google opens — press the blue  Create API key  button", "Free. Any Google/Gmail account works")
    save(im, "step07_create_key.png")

# ---------------------------------------------------------------- step 8
def step08():
    im, d = canvas("#111315")
    page = google("aistudio.google.com/apikey", d, None)
    cw, ch = 1000, 360; cx, cy = (W-cw)//2, 280
    d.rounded_rectangle([cx, cy, cx+cw, cy+ch], radius=14, fill="white", outline="#dadce0", width=2)
    d.text((cx+40, cy+40), "Your new API key", font=sansb(30), fill="#1f1f1f")
    kb = (cx+40, cy+110, cx+cw-170, cy+185)
    d.rounded_rectangle(kb, radius=10, fill="#f1f3f4", outline="#dadce0", width=2)
    d.text(((kb[0]+kb[2])/2, (kb[1]+kb[3])/2), PIX, font=mono(26), fill="#1f1f1f", anchor="mm")
    cb = (kb[2]+30, kb[1], kb[2]+120, kb[3])
    d.rounded_rectangle([cb[0]+12, cb[1]+14, cb[2]-4, cb[3]-18], radius=6, outline="#1a73e8", width=4)
    d.rounded_rectangle([cb[0]+4, cb[1]+22, cb[2]-12, cb[3]-10], radius=6, outline="#1a73e8", width=4)
    d.text((cx+40, cy+230), "The key is long and starts with  AIza...", font=sans(24), fill="#5f6368")
    d.text((cx+40, cy+280), "Keep it private — it is yours.", font=sans(24), fill="#5f6368")
    ring(d, cb, color="#1a73e8", r=8)
    badge(d, cx+16, cy+90, 8)
    caption(d, "Press the copy icon next to the key (or select it and Ctrl+C)", "One key per person — takes 20 seconds, once ever")
    save(im, "step08_copy_key.png")

# ---------------------------------------------------------------- step 9
def step09():
    im, d = canvas()
    app(im, d, thumbs=1, status="AI CONVERTED")
    back = im.filter(ImageFilter.GaussianBlur(6))
    im = back; d = ImageDraw.Draw(im)
    ov = Image.new("RGBA", (W, H), (4, 8, 12, 140))
    im.paste(ov, (0, 0), ov)
    cw, ch = 780, 330; cx, cy = (W-cw)//2, 210
    d.rounded_rectangle([cx, cy, cx+cw, cy+ch], radius=14, fill="#0c1218", outline="#1e2b34", width=2)
    d.text((cx+40, cy+36), "AI (GEMINI) KEY", font=monob(22), fill=GREEN)
    d.text((cx+40, cy+90), "Stored in this browser only — never sent to us.", font=mono(19), fill=DIM)
    kb = (cx+40, cy+140, cx+cw-40, cy+205)
    d.rounded_rectangle(kb, radius=8, fill="#070b0f", outline=BTNB, width=2)
    d.text((kb[0]+20, (kb[1]+kb[3])/2), PIX[:34] + "…", font=mono(22), fill=TXT, anchor="lm")
    sb = btn(d, cx+cw-260, cy+240, 200, 64, "SAVE", "ai", font=monob(24))
    btn(d, cx+cw-440, cy+240, 150, 64, "CANCEL", "dark", font=monob(20))
    ring(d, sb)
    badge(d, cx+cw-60, cy+225, 9)
    caption(d, "The key box opens by itself — paste the key and press SAVE", "Saved forever in your browser. You will never do this again")
    save(im, "step09_paste_save.png")

STEPS = [step01, step02, step03, step04, step05, step06, step07, step08, step09]
NAMES = ["step01_open_site.png", "step02_press_enter.png", "step03_paste_flights.png",
         "step04_press_copy.png", "step05_screenshot_proof.png", "step06_press_generate_api.png",
         "step07_create_key.png", "step08_copy_key.png", "step09_paste_save.png"]

if __name__ == "__main__":
    for s in STEPS: s()
    imgs = [Image.open(os.path.join(OUTDIR, n)) for n in NAMES]
    tw = 800; gap = 8
    th = int(900 * tw / 1600)
    big = Image.new("RGB", (tw, len(imgs)*(th+gap)), "#0b1117")
    y = 0
    for i in imgs:
        big.paste(i.resize((tw, th), Image.LANCZOS), (0, y)); y += th+gap
    big.save(os.path.join(OUTDIR, "ALL_STEPS.png"))
    print("wrote ALL_STEPS.png")
