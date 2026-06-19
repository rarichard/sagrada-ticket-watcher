# Sagrada Família ticket watcher

Watches the **official** Sagrada Família ticket store
([tickets.sagradafamilia.org](https://tickets.sagradafamilia.org/en)) for a target
visit date and sends a loud phone alert (via Pushover) the moment a slot opens —
across **all** individual ticket types:

| Ticket type | Product |
|---|---|
| Guided Tour | `4374` |
| Basic entry (Sagrada Família) | `4375` |
| With Towers | `4443` |
| Guide + Towers | `4779` |

**Target date:** `2026-07-07` (set in `.github/workflows/watch.yml` and overridable via `TARGET_DATE`).

It is **notify-only**: it never logs in, books, or pays. When you get the alert,
you complete the purchase yourself on the official site (the alert links straight to it).

## How it works

`monitor.js` calls the official store's backend (Clorian) the same way the website's
own calendar does — it authenticates with the public frontend key, then reads the
month-availability calendar for the target date. No scraping, no reCAPTCHA, no login.
A slot is considered open when the API returns `availability` (vs `no-availability`)
for the target date. `state.json` dedupes so you're alerted once per opening (re-alerts
if a date sells out and reopens).

## Running

The watcher runs automatically in **GitHub Actions every 5 minutes** (see
`.github/workflows/watch.yml`). It runs in the cloud, so your computer can be off.

### Required secrets

Set these two repo secrets (Settings → Secrets and variables → Actions), or via the CLI:

```bash
gh secret set PUSHOVER_TOKEN   # your Pushover application token
gh secret set PUSHOVER_USER    # your Pushover user key
```

### Run locally / once

```bash
# one check
TARGET_DATE=2026-07-07 PUSHOVER_TOKEN=xxx PUSHOVER_USER=yyy node monitor.js

# continuous local loop (every 5 min) instead of cron
LOOP_MINUTES=5 TARGET_DATE=2026-07-07 PUSHOVER_TOKEN=xxx PUSHOVER_USER=yyy node monitor.js
```

Without the Pushover variables set, it just logs what it *would* have sent — handy for testing.

## Getting Pushover (the loud phone alert)

1. Install the **Pushover** app (iOS/Android) and create an account ($5 one-time after a 30-day trial).
2. Your **user key** is on the app's main screen / [pushover.net](https://pushover.net) dashboard.
3. On pushover.net → *Create an Application/API Token* → gives you the **application token**.
4. Put both into the repo secrets above.

Alerts are sent at **emergency priority**: they repeat (with sound, through silent mode)
every 60s for up to an hour until you acknowledge them on your phone.

## Turning it off

Delete the repo, or disable the workflow in the Actions tab. The watch date is past July 7, 2026
anyway after the trip.
