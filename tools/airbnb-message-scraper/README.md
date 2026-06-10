# Airbnb Message Scraper + Analyzer

Local Playwright scraper that reads your **already-logged-in** Airbnb host
inbox, dumps every thread + message to JSON, then runs a Claude analyzer
that clusters guest questions and proposes quick-reply templates matched
to your historical tone.

**Read-only.** Does not send messages. Auto-send replies need a channel
manager (Hospitable / Hostaway / Hostfully) — see Phase 2 below.

---

## 0. Quit Chrome first

Playwright needs exclusive access to the Chrome user-data-dir.
Close every Chrome window (`Get-Process chrome | Stop-Process` on Windows
if you can't kill them through the UI) **before** running.

If you'd rather not touch your main Chrome profile, leave
`--profile-dir` unset — the scraper creates `.chrome-profile/` inside this
tool and the first run opens a one-time login window where you sign into
Airbnb. After that, the cookies live in `.chrome-profile/` and re-runs are
fully unattended.

---

## 1. One-time setup

```powershell
cd C:\Users\midom\Documents\acq-automation\tools\airbnb-message-scraper

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
playwright install chromium
```

---

## 2. First-time login (only once per profile dir)

Run the scraper in **smoke-test mode** with a tiny cap:

```powershell
python scrape.py --max-threads 1
```

A Chromium window opens. Log into Airbnb (host account). The window will
navigate to `airbnb.com/hosting/messaging` and grab one thread. After
that, cookies are saved in `.chrome-profile/` and future runs are
unattended.

---

## 3. Real run

```powershell
# Full inbox
python scrape.py

# Or capped + resumable for safety
python scrape.py --max-threads 50 --resume
```

Output: `airbnb-messages-YYYY-MM-DD.json` beside this file.

The script checkpoints to `scrape-state.json` after **every** thread, so a
crash mid-run loses zero work — re-run with `--resume`.

---

## 4. Analyze + propose quick-reply templates

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # if not already in env
python analyze.py airbnb-messages-2026-06-09.json
```

Output: `airbnb-quickreplies-proposed-YYYY-MM-DD.md`. Review, then
copy/paste the templates you like into Airbnb's `Manage quick replies`
UI. (Airbnb's API won't let us add them for you without channel-manager
status.)

---

## 5. Upload to the APG dashboard

```powershell
$json = Get-Content airbnb-messages-2026-06-09.json -Raw
curl.exe -X POST `
  -H "Content-Type: application/json" `
  -H "Cookie: $env:APG_SESSION_COOKIE" `
  --data-binary "@airbnb-messages-2026-06-09.json" `
  https://apg-dashboard.mithchell.workers.dev/admin/upload-airbnb-data
```

Or use the upload UI on the new Messages tab:
`https://apg-dashboard.mithchell.workers.dev/messages` → "Upload scraped JSON".

---

## Phase 2 — to actually auto-reply to guests

Airbnb's public API is closed to non-channel-managers. To send messages
programmatically you need one of:

| Tool          | Price (approx)        | What you get beyond this scraper                                  |
|---------------|-----------------------|-------------------------------------------------------------------|
| Hospitable    | $25–35 / listing / mo | AI auto-reply, unified inbox (Airbnb + VRBO + Booking.com), calendar sync, templated send |
| Hostaway      | $50 / listing / mo    | Same + revenue-management add-ons                                 |
| Hostfully     | $40 / listing / mo    | Same + a guest portal                                             |

This scraper covers everything that is possible **without** paying a
channel manager: read-only analytics + template proposals you paste in
manually.

---

## Common errors

| Symptom                                                  | Fix                                                                                      |
|----------------------------------------------------------|------------------------------------------------------------------------------------------|
| `Chrome profile is not logged into Airbnb`               | First-time login step (Section 2) wasn't completed. Re-run with `--max-threads 1`.       |
| `Profile dir locked` / `Failed to create lock`           | Quit every Chrome window. On Windows: `Get-Process chrome \| Stop-Process`.               |
| `Could not find the inbox thread list`                   | Airbnb shipped a DOM refactor. Update `THREAD_LIST_SELECTORS` at the top of `scrape.py`. |
| `2FA / verify your identity` prompt                      | Complete the prompt in the visible window once; cookies persist after.                   |
| `Cookie expired` / redirected to `/login` mid-run        | Same — log in once in the visible window, re-run.                                        |
| Many threads scrape with 0 messages                      | Airbnb is lazy-rendering. Increase the `wait_for_timeout` after the click in `scrape_thread`. |

---

## Output JSON shape (sample)

```json
{
  "scraped_at": "2026-06-09T18:42:01+00:00",
  "thread_count": 47,
  "message_count": 312,
  "threads": [
    {
      "thread_id": "1234567890",
      "url": "https://www.airbnb.com/hosting/thread/1234567890",
      "guest_name": "Sarah K.",
      "listing": "Downtown Loft · Birmingham",
      "check_in": "Jul 12, 2026",
      "check_out": "Jul 15, 2026",
      "reservation_status": "booked",
      "host_replied": true,
      "median_reply_minutes": 14.5,
      "scraped_at": "2026-06-09T18:42:01+00:00",
      "messages": [
        {
          "timestamp": "2026-06-09T16:01:00+00:00",
          "timestamp_raw": "Today 12:01 PM",
          "sender": "guest",
          "text": "Hi! What time can we check in?"
        },
        {
          "timestamp": "2026-06-09T16:18:00+00:00",
          "timestamp_raw": "Today 12:18 PM",
          "sender": "host",
          "text": "Anytime after 3pm! The lockbox code is..."
        }
      ]
    }
  ]
}
```
