#!/usr/bin/env python3
"""tools/bug_report_intake/intake.py — "SpicyTerminal bug report" emails, handled.

Every few minutes (GitHub Actions — bug-report-intake.yml, installed under
.github/workflows/)
this reads the author's Gmail inbox and, for each NEW email whose subject is
exactly "SpicyTerminal bug report":

  1. opens a GitHub issue carrying the whole email — sender, date, headers,
     the structured sections the app's `Report a bug` button writes (WHAT I
     PASTED / WHAT THE APP PRODUCED / WHAT I EXPECTED INSTEAD / ANY OTHER
     DETAILS), the attachment list, and an "Agent brief" that tells a repair
     agent exactly what to do (fix → test → build → PR → merge);
  2. labels the email in Gmail so it is never picked up twice;
  3. POSTs the same payload to AGENT_WEBHOOK_URL when one is configured — the
     hook that starts the repair agent;
  4. replies to the sender: the fix is under way, allow 3–30 minutes, then
     refresh SpicyTerminal. By default (BUG_REPORT_REPLY_MODE=dispatched) that
     promise is only sent once a hook actually accepted the job; `always`
     sends it on every report, `never` sends nothing;
  5. saves the original .eml and its attachments under intake-out/ so the
     workflow can keep them as a run artifact (screenshots matter for OCR bugs).

Standard library only — no pip, no OAuth dance: Gmail IMAP/SMTP with an app
password (2-Step Verification → App passwords). Nothing here ever prints a
secret, and the only thing that reaches the sender is the reply text below.

    python3 intake.py                      # the scheduled run
    python3 intake.py --dry-run a.eml …    # parse local .eml files, print the
                                           # issue + reply, touch no network
    python3 intake.py --self-test          # tools/bug_report_intake/self_test.py
"""
from __future__ import annotations

import base64
import datetime as _dt
import email
import email.policy
import email.utils
import imaplib
import json
import os
import pathlib
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from email.message import EmailMessage
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# configuration (environment)
# ---------------------------------------------------------------------------

DEFAULT_SUBJECT = "SpicyTerminal bug report"
DEFAULT_HANDLED_LABEL = "SpicyTerminal-Handled"
DEFAULT_ISSUE_LABELS = ["bug-report", "auto-intake"]
REPLY_MODES = ("dispatched", "always", "never")
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024          # saved to the artifact
MAX_WEBHOOK_ATTACHMENT_BYTES = 2 * 1024 * 1024  # inlined (base64) in the hook payload
IMAP_HOST, SMTP_HOST, SMTP_PORT = "imap.gmail.com", "smtp.gmail.com", 465


def env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    return default if value is None or not str(value).strip() else str(value).strip()


def config() -> dict:
    mode = env("BUG_REPORT_REPLY_MODE", "dispatched").lower()
    if mode not in REPLY_MODES:
        mode = "dispatched"
    repo = env("GITHUB_REPOSITORY", "Adhambadrun/SpicyTerminal")
    server = env("GITHUB_SERVER_URL", "https://github.com")
    run_id = env("GITHUB_RUN_ID")
    return {
        "gmail_user": env("GMAIL_USER"),
        "gmail_password": env("GMAIL_APP_PASSWORD"),
        "github_token": env("GITHUB_TOKEN"),
        "repo": repo,
        "run_url": f"{server}/{repo}/actions/runs/{run_id}" if run_id else "",
        "webhook_url": env("AGENT_WEBHOOK_URL"),
        "webhook_token": env("AGENT_WEBHOOK_TOKEN"),
        "reply_mode": mode,
        "subject": env("BUG_REPORT_SUBJECT", DEFAULT_SUBJECT),
        "handled_label": env("BUG_REPORT_LABEL", DEFAULT_HANDLED_LABEL),
        "max_per_run": max(1, int(env("BUG_REPORT_MAX_PER_RUN", "10") or 10)),
        "lookback_days": max(1, int(env("BUG_REPORT_LOOKBACK_DAYS", "14") or 14)),
        "site_url": env("SPICY_SITE_URL"),
        "out_dir": env("INTAKE_OUT_DIR", "intake-out"),
    }


def log(msg: str, level: str = "") -> None:
    prefix = f"::{level}::" if level in ("notice", "warning", "error") else ""
    print(prefix + msg, flush=True)


# ---------------------------------------------------------------------------
# the email → a report
# ---------------------------------------------------------------------------

class _TextOf(HTMLParser):
    """The smallest HTML→text that keeps paragraphs and line breaks."""
    _BREAK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "pre", "blockquote"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in self._BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
        elif tag in self._BREAK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    parser = _TextOf()
    parser.feed(markup or "")
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def normalize_subject(subject: str) -> str:
    return re.sub(r"\s+", " ", str(subject or "")).strip().lower()


def is_bug_report_subject(subject: str, wanted: str = DEFAULT_SUBJECT) -> bool:
    """Exactly the subject the app's button writes — a `Re:` or `Fwd:` is a
    conversation about a report, not a new one, and must not open a second issue."""
    return normalize_subject(subject) == normalize_subject(wanted)


SECTION_RE = re.compile(r"^\s*===\s*(.+?)\s*===\s*$", re.M)
SECTION_KEYS = (
    ("SPICY TERMINAL BUG REPORT", "header"),
    ("WHAT I PASTED", "pasted"),
    ("WHAT THE APP PRODUCED", "produced"),
    ("WHAT I EXPECTED INSTEAD", "expected"),
    ("ANY OTHER DETAILS", "other"),
    ("ENGINE LEARN LOG", "learn_log"),
    ("RECENT DETECTED MISTAKES", "mistakes"),
    ("WEEKLY REPORT", "weekly_report"),
)


def split_sections(text: str) -> dict:
    """The `=== HEADING ===` blocks the app writes, keyed by what they are.
    Text before the first heading (a hand-written note) lands in `preamble`;
    an email with no headings at all is one `preamble`."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    out: dict = {}
    matches = list(SECTION_RE.finditer(text))
    preamble = text[: matches[0].start()].strip() if matches else text.strip()
    if preamble:
        out["preamble"] = preamble
    for i, m in enumerate(matches):
        heading = m.group(1).strip().upper()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end():end].strip("\n").rstrip()
        key = next((k for prefix, k in SECTION_KEYS if heading.startswith(prefix)), None)
        if key is None:
            key = re.sub(r"[^a-z0-9]+", "_", heading.lower()).strip("_") or "section"
        if key in out:
            out[key] = (out[key] + "\n" + body).rstrip()
        else:
            out[key] = body
    return out


def _decode_part(part) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    for enc in (charset, "utf-8", "latin-1"):
        try:
            return payload.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return payload.decode("utf-8", "replace")


def parse_report(raw: bytes) -> dict:
    """One received email → everything the issue, the hook and the reply need."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    name, addr = email.utils.parseaddr(str(msg.get("From", "")))
    plain, html_body, attachments = [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        disposition = str(part.get("Content-Disposition", "")).lower()
        filename = part.get_filename()
        if filename or "attachment" in disposition or (ctype.startswith("image/") and "inline" in disposition):
            data = part.get_payload(decode=True) or b""
            attachments.append({
                "filename": filename or ("part." + (ctype.split("/")[-1] or "bin")),
                "content_type": ctype,
                "size": len(data),
                "content_id": str(part.get("Content-ID", "")).strip("<> "),
                "data": data,
            })
        elif ctype == "text/plain":
            plain.append(_decode_part(part))
        elif ctype == "text/html":
            html_body.append(_decode_part(part))
    text = "\n".join(p for p in plain if p.strip()).strip()
    source = "text/plain"
    if not text and html_body:
        text = html_to_text("\n".join(html_body))
        source = "text/html"
    date_hdr = str(msg.get("Date", ""))
    try:
        received = email.utils.parsedate_to_datetime(date_hdr) if date_hdr else None
    except (TypeError, ValueError):
        received = None
    return {
        "from": str(msg.get("From", "")),
        "from_name": name or addr.split("@")[0],
        "from_email": addr,
        "to": str(msg.get("To", "")),
        "date": date_hdr,
        "received_iso": received.isoformat() if received else "",
        "subject": str(msg.get("Subject", "")),
        "message_id": str(msg.get("Message-ID", "")).strip(),
        "references": str(msg.get("References", "")).strip(),
        "text": text,
        "text_source": source,
        "sections": split_sections(text),
        "attachments": attachments,
    }


# ---------------------------------------------------------------------------
# the report → an issue, a hook payload, a reply
# ---------------------------------------------------------------------------

def _fence(body: str, lang: str = "text") -> str:
    body = (body or "").strip("\n")
    if not body.strip():
        return "_(empty)_"
    ticks = "```"
    while ticks in body:
        ticks += "`"
    return f"{ticks}{lang}\n{body}\n{ticks}"


def _size(n: int) -> str:
    return f"{n / 1024:.1f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:.1f} MB"


def _cell(value) -> str:
    """One Markdown table cell: no pipes, no line breaks."""
    return re.sub(r"\s*\n\s*", " ", str(value)).replace("|", "\\|").strip()


def issue_title(report: dict) -> str:
    who = report.get("from_name") or report.get("from_email") or "unknown sender"
    pasted = (report.get("sections", {}).get("pasted") or "").strip()
    hint = ""
    if pasted:
        first = next((ln.strip() for ln in pasted.splitlines() if ln.strip()), "")
        hint = re.sub(r"\s+", " ", first)[:60]
    day = (report.get("received_iso") or "")[:10]
    title = f"Bug report from {who}"
    if day:
        title += f" ({day})"
    if hint:
        title += f": {hint}"
    return title[:240]


def agent_brief(report: dict, repo: str, issue_number: int | None) -> str:
    ref = f"#{issue_number}" if issue_number else "#<the number of this issue>"
    return "\n".join([
        f"Repository: `{repo}` — default branch `main`; Vercel deploys every merge to `main` automatically.",
        "",
        f"1. Reproduce with the real engine first (`node -e` against `spicy_engine.js`, or a new `test_*.js`) using **What the reporter pasted** above; compare with **What the app produced** and the reporter's expectation.",
        "2. Fix the root cause in the source (`spicy_engine.js`, `app.js`, `spicy_data.js`, `spicy_links.js`, …) — never only the symptom — and add a `test_*.js` that pins this exact itinerary, wired into `npm test` in `package.json`.",
        "3. `npm run build` (the committed `index.html` / `app.html` must be rebuilt), then `npm test` must stay green.",
        f"4. Open a pull request that says `Fixes {ref}` and merge it. The reporter was told the fix lands in 3–30 minutes and to refresh SpicyTerminal; the live page shows its own “NEW VERSION LIVE · REFRESH” notice as soon as Vercel finishes deploying.",
        "5. Keep `README.md` honest if behaviour changed. Do not touch unrelated features.",
    ])


def issue_body(report: dict, repo: str, run_url: str = "") -> str:
    s = report.get("sections", {})
    atts = report.get("attachments", [])
    att_line = ", ".join(f"`{a['filename']}` ({_size(a['size'])}, {a['content_type']})" for a in atts) or "none"
    rows = [
        ("From", report.get("from", "")),
        ("Received", report.get("date", "")),
        ("Subject", report.get("subject", "")),
        ("Message-ID", f"`{report.get('message_id', '')}`" if report.get("message_id") else ""),
        ("Attachments", att_line),
    ]
    if run_url:
        rows.append(("Original email", f"[workflow run artifact]({run_url}) (`.eml` + attachments)"))
    lines = ["## SpicyTerminal bug report — received by email", "", "| | |", "|---|---|"]
    lines += [f"| {k} | {_cell(v)} |" for k, v in rows if v]
    lines.append("")
    if s.get("header"):
        lines += ["<sub>" + " · ".join(ln.strip() for ln in s["header"].splitlines() if ln.strip()) + "</sub>", ""]
    if s.get("preamble"):
        lines += ["### Note from the reporter", "", s["preamble"], ""]
    lines += ["### What the reporter pasted", "", _fence(s.get("pasted", "")), ""]
    lines += ["### What the app produced", "", _fence(s.get("produced", "")), ""]
    lines += ["### What they expected instead", "", (s.get("expected") or "").strip() or "_(nothing written)_", ""]
    if (s.get("other") or "").strip():
        lines += ["### Any other details", "", s["other"].strip(), ""]
    for key, title in (("learn_log", "Engine learn log"), ("mistakes", "Recent detected mistakes"), ("weekly_report", "Weekly report (auto)")):
        if (s.get(key) or "").strip():
            lines += [f"<details><summary>{title}</summary>", "", _fence(s[key]), "", "</details>", ""]
    lines += ["<details><summary>Full email as received</summary>", "", _fence(report.get("text", "")), "", "</details>", ""]
    lines += ["## Agent brief", "", agent_brief(report, repo, None), ""]
    lines += ["<sub>Opened automatically by `tools/bug_report_intake/intake.py`.</sub>"]
    return "\n".join(lines)


def reply_text(report: dict, site_url: str = "") -> str:
    first = (report.get("from_name") or "").strip().split(" ")[0] or "there"
    where = f"SpicyTerminal ({site_url})" if site_url else "SpicyTerminal"
    return "\n".join([
        f"Hi {first},",
        "",
        "Thanks — your SpicyTerminal bug report is in and the fix is under way.",
        "",
        f"Please allow 3 to 30 minutes, depending on the repair. Then refresh {where} and the update will be live on your end — the page also shows a small \"NEW VERSION LIVE · REFRESH\" notice the moment the new build lands.",
        "",
        "Nothing else is needed from you. If the same itinerary still misbehaves after a refresh, just reply to this email.",
        "",
        "— SpicyTerminal · Adham Badran",
    ])


def webhook_payload(report: dict, repo: str, issue: dict | None, run_url: str = "") -> dict:
    atts, budget = [], MAX_WEBHOOK_ATTACHMENT_BYTES
    for a in report.get("attachments", []):
        item = {"filename": a["filename"], "content_type": a["content_type"], "size": a["size"]}
        if a["size"] <= budget:
            item["base64"] = base64.b64encode(a["data"]).decode("ascii")
            budget -= a["size"]
        atts.append(item)
    return {
        "event": "spicyterminal.bug_report",
        "repo": repo,
        "issue": {"number": issue["number"], "url": issue["html_url"], "title": issue["title"]} if issue else None,
        "email": {
            "from": report.get("from", ""), "from_name": report.get("from_name", ""), "from_email": report.get("from_email", ""),
            "date": report.get("date", ""), "subject": report.get("subject", ""), "message_id": report.get("message_id", ""),
            "text": report.get("text", ""), "sections": report.get("sections", {}), "attachments": atts,
        },
        "brief": agent_brief(report, repo, issue["number"] if issue else None),
        "run_url": run_url,
    }


def should_reply(mode: str, dispatched: bool) -> bool:
    if mode == "never":
        return False
    if mode == "always":
        return True
    return bool(dispatched)


# ---------------------------------------------------------------------------
# Gmail (IMAP + SMTP)
# ---------------------------------------------------------------------------

def gmail_raw_query(subject: str, handled_label: str, lookback_days: int) -> str:
    """The X-GM-RAW search: Gmail's own search syntax over IMAP. Labels are
    searched lower-cased with spaces and slashes as hyphens."""
    label = re.sub(r"[\s/]+", "-", handled_label.strip()).lower()
    inner = f'subject:"{subject}" -label:{label} newer_than:{int(lookback_days)}d'
    return '"' + inner.replace("\\", "\\\\").replace('"', '\\"') + '"'


def labels_from_fetch_header(header: bytes) -> list[str]:
    """The label list out of a FETCH header such as
    b'5 (X-GM-LABELS (\\\\Inbox "\\\\Important" "Bug Reports") UID 55 BODY[] {1234}'.
    Quoted names may contain spaces, parentheses and escaped characters, so
    this walks the text instead of trusting a regex."""
    text = (header or b"").decode("utf-8", "replace")
    start = text.find("X-GM-LABELS (")
    if start < 0:
        return []
    i = start + len("X-GM-LABELS (")
    labels, token, quoted, depth = [], "", False, 1
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == "\\" and i + 1 < len(text):
                token += text[i + 1]
                i += 2
                continue
            if ch == '"':
                labels.append(token)
                token, quoted = "", False
            else:
                token += ch
        elif ch == '"':
            quoted = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                if token:
                    labels.append(token)
                break
        elif ch == " ":
            if token:
                labels.append(token)
                token = ""
        else:
            token += ch
        i += 1
    return labels


def label_matches(labels: list[str], wanted: str) -> bool:
    w = wanted.strip().lower()
    return any(str(l).strip().strip("\\").lower() == w for l in labels)


class Mailbox:
    """The few IMAP/SMTP moves this needs, kept together so the self-test can
    swap in a fake."""

    def __init__(self, user: str, password: str):
        self.user, self.password = user, password
        self.imap: imaplib.IMAP4_SSL | None = None

    def open(self) -> None:
        self.imap = imaplib.IMAP4_SSL(IMAP_HOST, ssl_context=ssl.create_default_context())
        self.imap.login(self.user, self.password)
        typ, _ = self.imap.select("INBOX")
        if typ != "OK":
            raise RuntimeError("IMAP: could not select INBOX")

    def close(self) -> None:
        if self.imap is None:
            return
        try:
            self.imap.close()
        except Exception:
            pass
        try:
            self.imap.logout()
        except Exception:
            pass
        self.imap = None

    def ensure_label(self, label: str) -> None:
        # A Gmail label is an IMAP folder: CREATE makes it, ALREADYEXISTS is fine.
        try:
            self.imap.create('"' + label.replace('"', '\\"') + '"')
        except imaplib.IMAP4.error:
            pass

    def search(self, raw_query: str) -> list[bytes]:
        typ, data = self.imap.uid("SEARCH", None, "X-GM-RAW", raw_query)
        if typ != "OK":
            raise RuntimeError("IMAP: X-GM-RAW search failed")
        return [u for u in (data[0] or b"").split() if u]

    def fetch(self, uid: bytes) -> tuple[list[str], bytes]:
        typ, data = self.imap.uid("FETCH", uid, "(X-GM-LABELS BODY.PEEK[])")
        if typ != "OK":
            raise RuntimeError(f"IMAP: FETCH {uid!r} failed")
        labels, raw = [], b""
        for item in data:
            if isinstance(item, tuple) and len(item) >= 2:
                labels = labels_from_fetch_header(item[0])
                raw = item[1]
                break
        if not raw:
            raise RuntimeError(f"IMAP: FETCH {uid!r} returned no body")
        return labels, raw

    def mark_handled(self, uid: bytes, label: str) -> None:
        typ, _ = self.imap.uid("STORE", uid, "+X-GM-LABELS", '("' + label.replace('"', '\\"') + '")')
        if typ != "OK":
            raise RuntimeError(f"IMAP: could not label {uid!r}")

    def send_reply(self, report: dict, body: str) -> str:
        msg = EmailMessage()
        msg["From"] = email.utils.formataddr(("SpicyTerminal", self.user))
        msg["To"] = email.utils.formataddr((report.get("from_name", ""), report["from_email"]))
        subject = report.get("subject", DEFAULT_SUBJECT).strip()
        msg["Subject"] = subject if subject.lower().startswith("re:") else "Re: " + subject
        if report.get("message_id"):
            msg["In-Reply-To"] = report["message_id"]
            msg["References"] = (report.get("references", "") + " " + report["message_id"]).strip()
        msg["Auto-Submitted"] = "auto-replied"
        msg.set_content(body)
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ssl.create_default_context(), timeout=60) as smtp:
            smtp.login(self.user, self.password)
            smtp.send_message(msg)
        return report["from_email"]


# ---------------------------------------------------------------------------
# GitHub + the agent hook
# ---------------------------------------------------------------------------

def _http_json(method: str, url: str, body: dict | None, headers: dict, timeout: int = 30) -> tuple[int, dict | list | str]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = res.read().decode("utf-8", "replace")
            status = res.status
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace") if e.fp else ""
        status = e.code
    try:
        return status, json.loads(text) if text else {}
    except ValueError:
        return status, text[:500]


class GitHub:
    def __init__(self, repo: str, token: str, api: str = "https://api.github.com"):
        self.repo, self.token, self.api = repo, token, api.rstrip("/")

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "spicyterminal-bug-report-intake"}

    def ensure_labels(self) -> None:
        for name, color, desc in (("bug-report", "d73a4a", "A SpicyTerminal bug report received by email"),
                                  ("auto-intake", "0e8a16", "Opened automatically from the mailbox")):
            status, _ = _http_json("POST", f"{self.api}/repos/{self.repo}/labels",
                                   {"name": name, "color": color, "description": desc}, self._headers())
            if status not in (201, 422):
                log(f"label {name}: GitHub answered {status}", "warning")

    def create_issue(self, title: str, body: str) -> dict:
        status, doc = _http_json("POST", f"{self.api}/repos/{self.repo}/issues",
                                 {"title": title, "body": body, "labels": DEFAULT_ISSUE_LABELS}, self._headers())
        if status != 201 or not isinstance(doc, dict) or "number" not in doc:
            raise RuntimeError(f"GitHub: creating the issue failed ({status})")
        return {"number": doc["number"], "html_url": doc.get("html_url", ""), "title": doc.get("title", title)}

    def comment(self, number: int, body: str) -> None:
        status, _ = _http_json("POST", f"{self.api}/repos/{self.repo}/issues/{number}/comments", {"body": body}, self._headers())
        if status != 201:
            log(f"issue #{number}: comment failed ({status})", "warning")


def dispatch_agent(url: str, token: str, payload: dict) -> tuple[bool, int]:
    if not url:
        return False, 0
    headers = {"User-Agent": "spicyterminal-bug-report-intake", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        status, _ = _http_json("POST", url, payload, headers, timeout=45)
    except (urllib.error.URLError, OSError, ValueError) as e:
        log(f"agent hook unreachable: {e.__class__.__name__}", "warning")
        return False, 0
    return 200 <= status < 300, status


# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------

def save_bundle(out_dir: str, key: str, raw: bytes, report: dict, issue_md: str, reply: str, payload: dict) -> pathlib.Path:
    folder = pathlib.Path(out_dir) / re.sub(r"[^A-Za-z0-9._-]+", "-", key)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "report.eml").write_bytes(raw)
    (folder / "issue.md").write_text(issue_md, encoding="utf-8")
    (folder / "reply.txt").write_text(reply, encoding="utf-8")
    slim = json.loads(json.dumps(payload))
    for a in slim.get("email", {}).get("attachments", []):
        a.pop("base64", None)
    (folder / "payload.json").write_text(json.dumps(slim, indent=2, ensure_ascii=False), encoding="utf-8")
    att_dir = folder / "attachments"
    for i, a in enumerate(report.get("attachments", []), 1):
        if a["size"] > MAX_ATTACHMENT_BYTES:
            continue
        att_dir.mkdir(exist_ok=True)
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", a["filename"]) or f"attachment-{i}"
        (att_dir / f"{i:02d}-{name}").write_bytes(a["data"])
    return folder


def process_mailbox(cfg: dict, mailbox, github, dispatch=dispatch_agent, save=save_bundle) -> dict:
    """One pass over the inbox. Returns counts; never raises for one bad email."""
    stats = {"found": 0, "issues": 0, "dispatched": 0, "replied": 0, "skipped": 0, "errors": 0}
    mailbox.ensure_label(cfg["handled_label"])
    uids = mailbox.search(gmail_raw_query(cfg["subject"], cfg["handled_label"], cfg["lookback_days"]))
    stats["found"] = len(uids)
    log(f"mailbox: {len(uids)} candidate email(s) matching '{cfg['subject']}'")
    if uids and github is not None:
        github.ensure_labels()
    for uid in uids[: cfg["max_per_run"]]:
        try:
            labels, raw = mailbox.fetch(uid)
            if label_matches(labels, cfg["handled_label"]):
                stats["skipped"] += 1
                continue
            report = parse_report(raw)
            if not is_bug_report_subject(report["subject"], cfg["subject"]):
                log(f"uid {uid.decode()}: subject '{report['subject']}' is a reply/forward — labelled, no issue")
                mailbox.mark_handled(uid, cfg["handled_label"])
                stats["skipped"] += 1
                continue
            if not report["from_email"]:
                log(f"uid {uid.decode()}: no sender address — labelled, no issue", "warning")
                mailbox.mark_handled(uid, cfg["handled_label"])
                stats["skipped"] += 1
                continue

            title = issue_title(report)
            body = issue_body(report, cfg["repo"], cfg["run_url"])
            issue = github.create_issue(title, body) if github is not None else None
            if issue:
                stats["issues"] += 1
                log(f"uid {uid.decode()}: opened issue #{issue['number']} — {issue['html_url']}", "notice")
            # Labelled the moment the issue exists: a crash after this point can
            # cost a reply, never a duplicate issue.
            mailbox.mark_handled(uid, cfg["handled_label"])

            payload = webhook_payload(report, cfg["repo"], issue, cfg["run_url"])
            dispatched, status = dispatch(cfg["webhook_url"], cfg["webhook_token"], payload)
            if cfg["webhook_url"]:
                log(f"uid {uid.decode()}: agent hook {'accepted' if dispatched else 'refused'} ({status})",
                    "notice" if dispatched else "warning")
                stats["dispatched"] += int(dispatched)

            reply = reply_text(report, cfg["site_url"])
            replied_to = ""
            if should_reply(cfg["reply_mode"], dispatched):
                try:
                    replied_to = mailbox.send_reply(report, reply)
                    stats["replied"] += 1
                    log(f"uid {uid.decode()}: replied to {replied_to}", "notice")
                except Exception as e:  # SMTP refused, auth, network
                    log(f"uid {uid.decode()}: reply failed: {e.__class__.__name__}", "warning")
            else:
                log(f"uid {uid.decode()}: reply held (mode={cfg['reply_mode']}, agent hook "
                    f"{'not configured' if not cfg['webhook_url'] else 'did not accept'})")

            if issue and github is not None:
                status_lines = [
                    f"- Agent hook: {'accepted (' + str(status) + ')' if dispatched else ('not configured — set the `AGENT_WEBHOOK_URL` secret' if not cfg['webhook_url'] else 'refused (' + str(status) + ')')}",
                    f"- Reply to reporter: {'sent to ' + replied_to if replied_to else 'held (mode `' + cfg['reply_mode'] + '`)'}",
                ]
                if cfg["run_url"]:
                    status_lines.append(f"- Original email + attachments: [run artifact]({cfg['run_url']})")
                github.comment(issue["number"], "Intake status\n" + "\n".join(status_lines))

            key = f"issue-{issue['number']}" if issue else f"uid-{uid.decode()}"
            save(cfg["out_dir"], key, raw, report, body, reply, payload)
        except Exception as e:  # one bad email must not stop the others
            stats["errors"] += 1
            log(f"uid {uid.decode(errors='replace')}: {e.__class__.__name__}: {str(e)[:200]}", "error")
    return stats


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import self_test  # noqa: F401  (runs on import, exits with its own status)
        return 0
    if "--dry-run" in argv:
        files = [a for a in argv if a != "--dry-run"]
        if not files:
            print("usage: intake.py --dry-run message.eml [more.eml …]")
            return 2
        cfg = config()
        for f in files:
            report = parse_report(pathlib.Path(f).read_bytes())
            print("=" * 72)
            print("FILE   :", f)
            print("MATCH  :", is_bug_report_subject(report["subject"], cfg["subject"]))
            print("TITLE  :", issue_title(report))
            print("-" * 72)
            print(issue_body(report, cfg["repo"], cfg["run_url"]))
            print("-" * 72)
            print(reply_text(report, cfg["site_url"]))
        return 0

    cfg = config()
    if not cfg["gmail_user"] or not cfg["gmail_password"]:
        log("GMAIL_USER / GMAIL_APP_PASSWORD are not set — nothing to read, nothing done. "
            "Add them as repository secrets to switch the intake on.", "notice")
        return 0
    if not cfg["github_token"]:
        log("GITHUB_TOKEN is missing — cannot open issues.", "error")
        return 1
    log(f"reply mode: {cfg['reply_mode']}; agent hook: {'configured' if cfg['webhook_url'] else 'not configured'}")
    mailbox = Mailbox(cfg["gmail_user"], cfg["gmail_password"])
    try:
        mailbox.open()
    except (imaplib.IMAP4.error, OSError) as e:
        log(f"Gmail IMAP login failed ({e.__class__.__name__}). Use a Google App Password "
            "(2-Step Verification → App passwords), not the account password.", "error")
        return 1
    try:
        stats = process_mailbox(cfg, mailbox, GitHub(cfg["repo"], cfg["github_token"]))
    finally:
        mailbox.close()
    log("done: " + ", ".join(f"{k}={v}" for k, v in stats.items()), "notice")
    return 1 if stats["errors"] and not stats["issues"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
