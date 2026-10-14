# Bug-report intake — Gmail → GitHub issue → repair agent → reply

The `Report a bug` link in SpicyTerminal opens a Gmail compose to the author
with the subject **`SpicyTerminal bug report`** and a body that carries what the
user pasted, what the app produced, and what they expected. This folder turns
each of those emails into work, with nobody pressing anything:

```
 email arrives ──► GitHub Actions (every 5 min) ──► tools/bug_report_intake/intake.py
                                                    │
                      ┌─────────────────────────────┼──────────────────────────────┐
                      ▼                             ▼                              ▼
             GitHub issue                  AGENT_WEBHOOK_URL                 reply to sender
      (whole email + Agent brief,        (same payload: the hook          "fix under way — allow
       labels bug-report/auto-intake)     that starts the repair agent)    3–30 min, then refresh")
                      │
                      ▼
       the agent fixes → tests → `npm run build` → PR → merge → Vercel deploys
                      │
                      ▼
       every open tab shows  ● NEW VERSION LIVE  [REFRESH]  (the app's update notice)
```

The email is labelled `SpicyTerminal-Handled` in Gmail the moment its issue
exists, so it is never processed twice — whether or not it was read on a
phone in between. A `Re:` / `Fwd:` of the subject is a conversation about a
report, not a new one: it is labelled and skipped.

## Switch it on (once)

0. Put the workflow where GitHub runs it: copy
   `tools/bug_report_intake/bug-report-intake.yml` to
   `.github/workflows/bug-report-intake.yml` (GitHub web UI → *Add file*, or
   `git mv` + push). It ships here because the automation that opened the PR is
   not allowed to write under `.github/workflows/`.
1. Google Account → Security → **2-Step Verification** on → **App passwords**
   → create one named `SpicyTerminal intake`.
2. Repository → Settings → Secrets and variables → Actions → **Secrets**:
   - `GMAIL_USER` — the inbox the button writes to (`adhambadraan@gmail.com`)
   - `GMAIL_APP_PASSWORD` — the 16-character app password from step 1
3. Optional, same page:
   - secret `AGENT_WEBHOOK_URL` (+ `AGENT_WEBHOOK_TOKEN`, sent as a Bearer
     token) — the hook that starts the repair agent. It receives one JSON POST
     per report (shape below) and must answer 2xx to count as *accepted*.
   - variable `BUG_REPORT_REPLY_MODE` — `dispatched` (default: the 3–30 minute
     promise is only sent once a hook accepted the job), `always`, or `never`.
   - variable `SPICY_SITE_URL` — the public URL quoted in the reply.
4. Actions → **Bug report intake** → *Run workflow* to try it now; it then
   runs itself every 5 minutes on `main`.

Without the two Gmail secrets the job logs one notice and exits 0.

## What the reporter receives

```
Hi Frank,

Thanks — your SpicyTerminal bug report is in and the fix is under way.

Please allow 3 to 30 minutes, depending on the repair. Then refresh
SpicyTerminal and the update will be live on your end — the page also shows a
small "NEW VERSION LIVE · REFRESH" notice the moment the new build lands.

Nothing else is needed from you. If the same itinerary still misbehaves after
a refresh, just reply to this email.

— SpicyTerminal · Adham Badran
```

Sent from the same Gmail account over SMTP, threaded under the original
(`In-Reply-To` / `References`), marked `Auto-Submitted: auto-replied`.

## What the agent receives

The GitHub issue (title `Bug report from <sender> (<date>): <first pasted line>`)
carries a metadata table, the four sections as fenced blocks, the attachment
list, a link to the run artifact holding the original `.eml` and screenshots,
and an **Agent brief**: reproduce with the real engine → fix the root cause →
add a `test_*.js` → `npm run build` → `npm test` → PR with `Fixes #N` → merge.

The webhook gets the same thing as JSON:

```json
{
  "event": "spicyterminal.bug_report",
  "repo": "Adhambadrun/SpicyTerminal",
  "issue": { "number": 71, "url": "https://github.com/…/issues/71", "title": "…" },
  "email": {
    "from": "Frank Expert <frank@bcflights.com>", "from_name": "Frank Expert", "from_email": "frank@bcflights.com",
    "date": "Wed, 14 Oct 2026 02:26:16 +0300", "subject": "SpicyTerminal bug report", "message_id": "<…>",
    "text": "=== SPICY TERMINAL BUG REPORT ===\n…",
    "sections": { "header": "…", "pasted": "…", "produced": "…", "expected": "…", "other": "…" },
    "attachments": [ { "filename": "image.png", "content_type": "image/png", "size": 3047, "base64": "…" } ]
  },
  "brief": "Repository: `Adhambadrun/SpicyTerminal` — …",
  "run_url": "https://github.com/…/actions/runs/…"
}
```

Attachments up to 2 MB in total are inlined as base64; larger ones are listed
by name and kept in the run artifact (`gh run download <run-id>`).

Until a hook is configured, the hand-off is the issue itself: open a new agent
chat on this repository and say *"Fix issue #N and merge it"* — the brief in
the issue tells it the rest.

## Running it by hand

```
python3 tools/bug_report_intake/self_test.py            # 80 checks, no network
python3 tools/bug_report_intake/intake.py --dry-run x.eml  # print the issue + reply for a saved email
GMAIL_USER=… GMAIL_APP_PASSWORD=… GITHUB_TOKEN=… python3 tools/bug_report_intake/intake.py
```

Standard library only (`imaplib`, `smtplib`, `email`, `urllib`). Nothing here
prints a secret; the payload carries none.
