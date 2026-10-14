"""tools/bug_report_intake/self_test.py — the intake, end to end, with no network.

Run with:  python3 tools/bug_report_intake/self_test.py
       or  python3 tools/bug_report_intake/intake.py --self-test

A synthetic "SpicyTerminal bug report" email (the exact shape the app's
`Report a bug` button writes, plus a screenshot) goes through parse → issue →
hook payload → reply, and a whole mailbox pass runs against a fake IMAP box
and a fake GitHub, so the order of operations — issue first, label the moment
the issue exists, hook, reply — and the reply-mode rules are pinned.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile
from email.message import EmailMessage

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import intake  # noqa: E402

PASSED = 0
FAILED = 0


def check(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print("  PASS  " + name)
    else:
        FAILED += 1
        print("  FAIL  " + name + ("  (" + str(detail)[:300] + ")" if detail else ""))


# ---------------------------------------------------------------------------
# a report exactly as the app's `Report a bug` button writes it
# ---------------------------------------------------------------------------

REPORT_TEXT = (
    "=== SPICY TERMINAL BUG REPORT ===\r\n"
    "TO: adhambadraan@gmail.com\r\n"
    "WHEN: 2026-10-13 23:24:19 UTC\r\n"
    "AI MODEL: gemini-flash\r\n"
    "\r\n"
    "=== WHAT I PASTED ===\r\n"
    "1 AA6892I 15APR Q LHRJFK SS1  1230P  320P /DCAA /E\r\n"
    "OPERATED BY BRITISH AIRWAYS\r\n"
    " 2 AA 913I 16APR F MIABOG SS1  1018A  105P /DCAA /E\r\n"
    "\r\n"
    "=== WHAT THE APP PRODUCED ===\r\n"
    "1 AA 6892 15APR LHR JFK 1230P 320P I 772 7.50 3452 N\r\n"
    "2 AA 9131 16APR MIA BOG 1018A 105P Y 738 3.47 1507 N\r\n"
    "\r\n"
    "=== WHAT I EXPECTED INSTEAD ===\r\n"
    "\r\n"
    "Esteemed Developer,\r\n"
    "\r\n"
    "Leg 2 should read AA 913 in class I, not AA 9131 | economy.\r\n"
    "\r\n"
    "[image: image.png]\r\n"
    "\r\n"
    "=== ANY OTHER DETAILS ===\r\n"
    "\r\n"
    "=== ENGINE LEARN LOG (1) ===\r\n"
    "1) 2026-10-13 — glyph fold\r\n"
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def make_eml(subject="SpicyTerminal bug report", sender='"Frank Expert" <frank@bcflights.com>',
             text=REPORT_TEXT, html=None, attach=True) -> bytes:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "adhambadraan@gmail.com"
    msg["Subject"] = subject
    msg["Date"] = "Wed, 14 Oct 2026 02:26:16 +0300"
    msg["Message-ID"] = "<CACvL5_test@mail.gmail.com>"
    if html is not None and text is None:
        msg.set_content(html, subtype="html")
    else:
        msg.set_content(text)
        if html is not None:
            msg.add_alternative(html, subtype="html")
    if attach:
        msg.add_attachment(PNG, maintype="image", subtype="png", filename="image.png")
    return msg.as_bytes()


# ---------------------------------------------------------------------------
# 1. subjects: exactly the one, never a Re:/Fwd:
# ---------------------------------------------------------------------------
print("\n1. subject matching")
check("01 the exact subject matches", intake.is_bug_report_subject("SpicyTerminal bug report"))
check("02 case and spacing do not matter", intake.is_bug_report_subject("  spicyterminal  BUG report "))
check("03 a Re: is a conversation, not a new report", not intake.is_bug_report_subject("Re: SpicyTerminal bug report"))
check("04 a Fwd: is not a new report either", not intake.is_bug_report_subject("Fwd: SpicyTerminal bug report"))
check("05 a different subject does not match", not intake.is_bug_report_subject("SpicyTerminal feedback"))

# ---------------------------------------------------------------------------
# 2. parsing the email
# ---------------------------------------------------------------------------
print("\n2. parse_report")
report = intake.parse_report(make_eml())
check("06 sender name and address", report["from_name"] == "Frank Expert" and report["from_email"] == "frank@bcflights.com", report["from"])
check("07 subject, date and Message-ID kept", report["subject"] == "SpicyTerminal bug report"
      and report["date"].startswith("Wed, 14 Oct 2026") and report["message_id"] == "<CACvL5_test@mail.gmail.com>")
check("08 received date is normalised to ISO", report["received_iso"].startswith("2026-10-1"), report["received_iso"])
s = report["sections"]
check("09 WHAT I PASTED is its own section", s.get("pasted", "").startswith("1 AA6892I 15APR") and "OPERATED BY" in s["pasted"], s.get("pasted"))
check("10 WHAT THE APP PRODUCED is its own section", s.get("produced", "").startswith("1 AA 6892 15APR") and s["produced"].rstrip().endswith("1507 N"))
check("11 WHAT I EXPECTED keeps the reporter's words", "Leg 2 should read AA 913" in s.get("expected", ""))
check("12 the header block is kept", "AI MODEL: gemini-flash" in s.get("header", ""))
check("13 the learn log is kept separately", s.get("learn_log", "").startswith("1) 2026-10-13"))
check("14 the empty section is empty, not missing", "other" in s and s["other"].strip() == "")
check("15 the screenshot is an attachment with bytes", len(report["attachments"]) == 1 and report["attachments"][0]["filename"] == "image.png"
      and report["attachments"][0]["data"] == PNG and report["attachments"][0]["content_type"] == "image/png")
check("16 the text source is text/plain", report["text_source"] == "text/plain")

html_only = intake.parse_report(make_eml(text=None, html="<p>Hello<br>=== WHAT I PASTED ===<br>1 BA 117 LHR JFK</p><script>x()</script>", attach=False))
check("17 an HTML-only email is read as text", html_only["text_source"] == "text/html" and "Hello" in html_only["text"] and "x()" not in html_only["text"], html_only["text"])
check("18 and its sections still split", html_only["sections"].get("pasted", "").strip() == "1 BA 117 LHR JFK", html_only["sections"])
plain_note = intake.parse_report(make_eml(text="it printed the wrong aircraft for BA 117", attach=False))
check("19 a hand-written email with no headings is one preamble", plain_note["sections"] == {"preamble": "it printed the wrong aircraft for BA 117"}, plain_note["sections"])

# ---------------------------------------------------------------------------
# 3. the issue
# ---------------------------------------------------------------------------
print("\n3. issue title and body")
title = intake.issue_title(report)
check("20 title names the reporter, the day and the first pasted line",
      title.startswith("Bug report from Frank Expert (2026-10-1") and "1 AA6892I 15APR" in title, title)
body = intake.issue_body(report, "Adhambadrun/SpicyTerminal", "https://github.com/x/y/actions/runs/1")
for needle in ("| From | Frank Expert <frank@bcflights.com> |", "### What the reporter pasted", "1 AA6892I 15APR Q LHRJFK",
               "### What the app produced", "### What they expected instead", "Leg 2 should read AA 913",
               "`image.png`", "image/png", "[workflow run artifact](https://github.com/x/y/actions/runs/1)",
               "## Agent brief", "`npm run build`", "`npm test`", "merge it", "NEW VERSION LIVE", "Full email as received"):
    check("21 body carries: " + needle[:40], needle in body)
check("22 the pipe in the reporter's text does not break the table", "| Message-ID | `<CACvL5_test@mail.gmail.com>` |" in body)
check("23 the brief references the issue once it exists", "`Fixes #42`" in intake.agent_brief(report, "Adhambadrun/SpicyTerminal", 42))
weird = intake.parse_report(make_eml(text="=== WHAT I PASTED ===\n```\nfenced\n```\n", attach=False))
check("24 a code fence inside the paste cannot escape the issue's fence", "````text\n```\nfenced\n```\n````" in intake.issue_body(weird, "r"))

# ---------------------------------------------------------------------------
# 4. the reply
# ---------------------------------------------------------------------------
print("\n4. the reply to the reporter")
reply = intake.reply_text(report, "https://spicyterminal.example")
check("25 greets by first name", reply.startswith("Hi Frank,"))
check("26 says the fix is under way", "fix is under way" in reply)
check("27 promises 3 to 30 minutes", "3 to 30 minutes" in reply)
check("28 tells them to refresh SpicyTerminal, with the site", "refresh SpicyTerminal (https://spicyterminal.example)" in reply)
check("29 mentions the on-page notice", "NEW VERSION LIVE" in reply)
check("30 short: under 700 characters", len(reply) < 700, len(reply))
check("31 no site url → plain 'refresh SpicyTerminal'", "refresh SpicyTerminal and" in intake.reply_text(report))
check("32 reply mode rules", intake.should_reply("dispatched", True) and not intake.should_reply("dispatched", False)
      and intake.should_reply("always", False) and not intake.should_reply("never", True))

# ---------------------------------------------------------------------------
# 5. the hook payload
# ---------------------------------------------------------------------------
print("\n5. the agent hook payload")
payload = intake.webhook_payload(report, "Adhambadrun/SpicyTerminal", {"number": 7, "html_url": "https://github.com/x/y/issues/7", "title": title}, "run")
check("33 event, repo and issue", payload["event"] == "spicyterminal.bug_report" and payload["issue"]["number"] == 7)
check("34 the whole email travels: text, sections, sender", payload["email"]["text"] == report["text"]
      and payload["email"]["sections"]["pasted"] == s["pasted"] and payload["email"]["from_email"] == "frank@bcflights.com")
check("35 small attachments are inlined as base64", payload["email"]["attachments"][0].get("base64") and "data" not in payload["email"]["attachments"][0])
check("36 the brief rides along", "Fixes #7" in payload["brief"])
check("37 JSON-serialisable, no bytes", json.dumps(payload) is not None)
check("38 and carries no secret", "GMAIL" not in json.dumps(payload) and "password" not in json.dumps(payload).lower())

# ---------------------------------------------------------------------------
# 6. Gmail plumbing helpers
# ---------------------------------------------------------------------------
print("\n6. Gmail helpers")
q = intake.gmail_raw_query("SpicyTerminal bug report", "SpicyTerminal-Handled", 14)
check("39 the X-GM-RAW query is one quoted IMAP string", q.startswith('"subject:\\"SpicyTerminal bug report\\"') and q.endswith('newer_than:14d"'), q)
check("40 the handled label is excluded the way Gmail spells it", "-label:spicyterminal-handled" in q)
labels = intake.labels_from_fetch_header(b'5 (X-GM-LABELS (\\Inbox "\\\\Important" "Bug (x) Reports" SpicyTerminal-Handled) UID 55 BODY[] {1234}')
check("41 labels are parsed, quoted or bare", labels == ["\\Inbox", "\\Important", "Bug (x) Reports", "SpicyTerminal-Handled"], labels)
check("42 label matching is case-insensitive", intake.label_matches(labels, "spicyterminal-handled") and not intake.label_matches(labels, "Other"))
check("43 a header without labels gives none", intake.labels_from_fetch_header(b"5 (UID 55 BODY[] {1234})") == [])


# ---------------------------------------------------------------------------
# 7. a whole mailbox pass against fakes
# ---------------------------------------------------------------------------
print("\n7. process_mailbox: order of operations and failure handling")


class FakeMailbox:
    def __init__(self, messages):
        self.messages = messages           # uid -> (labels, raw)
        self.log = []
        self.fail_reply = False

    def ensure_label(self, label): self.log.append(("ensure_label", label))
    def search(self, raw_query): self.log.append(("search", raw_query)); return list(self.messages)
    def fetch(self, uid): self.log.append(("fetch", uid)); return self.messages[uid]
    def mark_handled(self, uid, label): self.log.append(("label", uid, label)); self.messages[uid] = ([label], self.messages[uid][1])
    def send_reply(self, report, body):
        if self.fail_reply:
            raise OSError("smtp down")
        self.log.append(("reply", report["from_email"], body))
        return report["from_email"]


class FakeGitHub:
    def __init__(self, fail=False):
        self.fail, self.issues, self.comments, self.labels_ensured = fail, [], [], 0

    def ensure_labels(self): self.labels_ensured += 1
    def create_issue(self, title, body):
        if self.fail:
            raise RuntimeError("GitHub: creating the issue failed (500)")
        self.issues.append((title, body))
        return {"number": len(self.issues), "html_url": f"https://github.com/x/y/issues/{len(self.issues)}", "title": title}
    def comment(self, number, body): self.comments.append((number, body))


def cfg(**over):
    base = {"repo": "Adhambadrun/SpicyTerminal", "run_url": "https://run", "webhook_url": "https://hook", "webhook_token": "",
            "reply_mode": "dispatched", "subject": "SpicyTerminal bug report", "handled_label": "SpicyTerminal-Handled",
            "max_per_run": 10, "lookback_days": 14, "site_url": "", "out_dir": tempfile.mkdtemp(prefix="intake-test-")}
    base.update(over)
    return base


calls = []
def hook_ok(url, token, payload): calls.append(("hook", url, payload["issue"]["number"] if payload["issue"] else None)); return True, 202
def hook_refused(url, token, payload): calls.append(("hook-refused", url)); return False, 500
saved = []
def fake_save(out_dir, key, raw, report, issue_md, reply, payload): saved.append(key); return pathlib.Path(out_dir) / key

# happy path: two reports, one Re:, one already handled
box = FakeMailbox({
    b"1": ([], make_eml()),
    b"2": ([], make_eml(sender="Lamar García <lamar@bcflights.com>")),
    b"3": ([], make_eml(subject="Re: SpicyTerminal bug report")),
    b"4": (["SpicyTerminal-Handled"], make_eml()),
})
gh = FakeGitHub()
stats = intake.process_mailbox(cfg(), box, gh, dispatch=hook_ok, save=fake_save)
check("44 two issues for two real reports, the Re: and the handled one skipped",
      stats == {"found": 4, "issues": 2, "dispatched": 2, "replied": 2, "skipped": 2, "errors": 0}, stats)
check("45 the label is written for the Re: too (no re-reads next run)", ("label", b"3", "SpicyTerminal-Handled") in box.log)
check("46 the already-labelled email is not labelled again", ("label", b"4", "SpicyTerminal-Handled") not in box.log)
order = [e[0] for e in box.log if e[0] in ("fetch", "label", "reply") and (len(e) < 2 or e[1] in (b"1", "frank@bcflights.com"))]
check("47 per email: fetch → issue → label → hook → reply", order[:3] == ["fetch", "label", "reply"], order)
check("48 hook called with the issue number", ("hook", "https://hook", 1) in calls and ("hook", "https://hook", 2) in calls, calls)
check("49 every issue gets a status comment", len(gh.comments) == 2 and "accepted (202)" in gh.comments[0][1] and "sent to frank@bcflights.com" in gh.comments[0][1], gh.comments)
check("50 bundles saved per issue", saved == ["issue-1", "issue-2"], saved)
check("51 GitHub labels ensured once per run", gh.labels_ensured == 1)

# the hook refuses → by default the 3–30 minute promise is NOT sent
calls.clear(); saved.clear()
box = FakeMailbox({b"9": ([], make_eml())}); gh = FakeGitHub()
stats = intake.process_mailbox(cfg(), box, gh, dispatch=hook_refused, save=fake_save)
check("52 refused hook: issue opened, email labelled, no reply (mode dispatched)",
      stats["issues"] == 1 and stats["replied"] == 0 and ("label", b"9", "SpicyTerminal-Handled") in box.log and not any(e[0] == "reply" for e in box.log), stats)
check("53 the status comment says the hook refused and the reply was held", "refused (500)" in gh.comments[0][1] and "held" in gh.comments[0][1], gh.comments)

# no hook configured + mode always → reply anyway
box = FakeMailbox({b"9": ([], make_eml())}); gh = FakeGitHub()
stats = intake.process_mailbox(cfg(webhook_url="", reply_mode="always"), box, gh, dispatch=intake.dispatch_agent, save=fake_save)
check("54 mode always: replied even with no hook", stats["replied"] == 1 and any(e[0] == "reply" for e in box.log), stats)
check("55 the comment tells the author to set AGENT_WEBHOOK_URL", "AGENT_WEBHOOK_URL" in gh.comments[0][1], gh.comments)

# mode never
box = FakeMailbox({b"9": ([], make_eml())}); gh = FakeGitHub()
stats = intake.process_mailbox(cfg(reply_mode="never"), box, gh, dispatch=hook_ok, save=fake_save)
check("56 mode never: issue + hook, no reply", stats["issues"] == 1 and stats["dispatched"] == 1 and stats["replied"] == 0, stats)

# GitHub down → nothing is labelled, so the next run retries; no reply goes out
calls.clear()
box = FakeMailbox({b"9": ([], make_eml())}); gh = FakeGitHub(fail=True)
stats = intake.process_mailbox(cfg(), box, gh, dispatch=hook_ok, save=fake_save)
check("57 GitHub failure: counted, email left unlabelled for the next run, no hook, no reply",
      stats["errors"] == 1 and stats["issues"] == 0 and not any(e[0] in ("label", "reply") for e in box.log) and not calls, (stats, box.log, calls))

# SMTP down → the issue and the label stand; the comment says the reply failed… silently counted
box = FakeMailbox({b"9": ([], make_eml())}); box.fail_reply = True; gh = FakeGitHub()
stats = intake.process_mailbox(cfg(), box, gh, dispatch=hook_ok, save=fake_save)
check("58 SMTP failure: the issue and label stand, replied=0, errors=0", stats["issues"] == 1 and stats["replied"] == 0 and stats["errors"] == 0, stats)

# max per run
box = FakeMailbox({bytes(str(i), "ascii"): ([], make_eml()) for i in range(1, 6)}); gh = FakeGitHub()
stats = intake.process_mailbox(cfg(max_per_run=2), box, gh, dispatch=hook_ok, save=fake_save)
check("59 max_per_run caps one pass (the rest wait for the next run)", stats["issues"] == 2 and stats["found"] == 5, stats)

# the real save_bundle writes the .eml, the attachment, the issue, the reply and the payload
out = tempfile.mkdtemp(prefix="intake-bundle-")
payload = intake.webhook_payload(report, "r", {"number": 3, "html_url": "u", "title": "t"}, "")
folder = intake.save_bundle(out, "issue-3", make_eml(), report, "ISSUE", "REPLY", payload)
names = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())
check("60 save_bundle writes report.eml, issue.md, reply.txt, payload.json and the screenshot",
      names == ["attachments/01-image.png", "issue.md", "payload.json", "reply.txt", "report.eml"], names)
check("61 payload.json on disk carries no base64 blobs", "base64" not in (folder / "payload.json").read_text())

# ---------------------------------------------------------------------------
# 8. configuration
# ---------------------------------------------------------------------------
print("\n8. configuration")
os.environ.pop("BUG_REPORT_REPLY_MODE", None)
check("62 reply mode defaults to dispatched", intake.config()["reply_mode"] == "dispatched")
os.environ["BUG_REPORT_REPLY_MODE"] = "ALWAYS"
check("63 reply mode is case-insensitive", intake.config()["reply_mode"] == "always")
os.environ["BUG_REPORT_REPLY_MODE"] = "sometimes"
check("64 an unknown mode falls back to dispatched", intake.config()["reply_mode"] == "dispatched")
os.environ.pop("BUG_REPORT_REPLY_MODE", None)
os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_RUN_ID"] = "Adhambadrun/SpicyTerminal", "123"
check("65 the run url is built from the Actions environment", intake.config()["run_url"] == "https://github.com/Adhambadrun/SpicyTerminal/actions/runs/123")
for k in ("GMAIL_USER", "GMAIL_APP_PASSWORD"):
    os.environ.pop(k, None)
check("66 without Gmail secrets the run is a quiet no-op (exit 0)", intake.main([]) == 0)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
