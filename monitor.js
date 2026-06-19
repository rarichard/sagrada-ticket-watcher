#!/usr/bin/env node
// Sagrada Família ticket-availability watcher.
// Polls the OFFICIAL ticketing backend (Clorian, used by tickets.sagradafamilia.org)
// for a target visit date across all individual ticket types, and fires a loud
// Pushover alert the moment a slot opens. Notify-only: it never books or pays.
//
// Zero dependencies — uses Node's built-in fetch (Node 18+).
//
// Config via environment variables:
//   PUSHOVER_TOKEN   (required to send alerts) Pushover application token
//   PUSHOVER_USER    (required to send alerts) Pushover user key
//   TARGET_DATE      visit date to watch, YYYY-MM-DD   (default 2026-07-07)
//   STATE_FILE       path to dedupe state file         (default ./state.json)
//   LOOP_MINUTES     if set, run forever every N minutes; else run once and exit
//
// Exit code 0 on a clean check (whether or not anything was available).

import fs from 'node:fs';

const BASE = 'https://services.clorian.com';
const SECRET = 'thesagradafamiliafrontendoftomorrow'; // public key baked into the official frontend
const POS = '649';
const SALES_GROUP = 1;
const VENUE = 1;
const STORE = 'https://tickets.sagradafamilia.org/en';

// The four individual ticket types sold on the official store.
const PRODUCTS = [
  { id: 4374, name: 'Guided Tour', slug: 'sagrada-familia-with-guided-tour' },
  { id: 4375, name: 'Basic entry (Sagrada Família)', slug: 'sagrada-familia' },
  { id: 4443, name: 'With Towers', slug: 'sagrada-familia-with-towers' },
  { id: 4779, name: 'Guide + Towers', slug: 'sagrada-familia-with-guide-and-visit-to-the-towers' },
];

const TARGET_DATE = process.env.TARGET_DATE || '2026-07-07';
const STATE_FILE = process.env.STATE_FILE || new URL('./state.json', import.meta.url).pathname;
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN;
const PUSHOVER_USER = process.env.PUSHOVER_USER;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function productUrl(p) {
  return `${STORE}/${SALES_GROUP}-individual/${p.id}-${p.slug}`;
}

async function getToken() {
  const r = await fetch(`${BASE}/user/api/oauth/token?secretKey=${SECRET}`, {
    method: 'POST',
    headers: {
      Origin: 'https://tickets.sagradafamilia.org',
      Referer: 'https://tickets.sagradafamilia.org/',
    },
  });
  if (!r.ok) throw new Error(`token request failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (!j.access_token) throw new Error('no access_token in token response');
  return j.access_token;
}

function headers(tok) {
  return {
    Authorization: `Bearer ${tok}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    pos: POS,
    'accept-language': 'en',
    Origin: 'https://tickets.sagradafamilia.org',
    Referer: 'https://tickets.sagradafamilia.org/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
}

// Returns the availability status string for TARGET_DATE for one product,
// e.g. "availability" | "no-availability" | "unknown" (date not in the month map).
async function checkProduct(tok, product, date) {
  const [year, month] = date.split('-').map(Number); // month is 1-based, which the API wants
  const qs = new URLSearchParams({
    minTickets: '1',
    month: String(month),
    year: String(year),
    venueId: String(VENUE),
  });
  const url = `${BASE}/catalog/salesGroups/${SALES_GROUP}/product/${product.id}/availability?${qs}`;
  const r = await fetch(url, { headers: headers(tok) });
  if (!r.ok) throw new Error(`availability ${product.id} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const map = await r.json();
  return map[date] ?? 'unknown';
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { alerted: {} }; // { alerted: { "<productId>": "<date>" } }
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log('WARN could not write state file:', e.message);
  }
}

async function sendPushover({ title, message, url, urlTitle }) {
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) {
    log('PUSHOVER_TOKEN/PUSHOVER_USER not set — would have sent alert:', title, '|', message);
    return false;
  }
  const body = new URLSearchParams({
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    title,
    message,
    priority: '2', // emergency: repeats until acknowledged
    retry: '60', // re-alert every 60s
    expire: '3600', // for up to 1 hour
    sound: 'persistent',
    url: url || STORE,
    url_title: urlTitle || 'Open official ticket store',
  });
  const r = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 1) {
    log('ERROR Pushover send failed:', r.status, JSON.stringify(j));
    return false;
  }
  log('Pushover alert sent:', title);
  return true;
}

async function runOnce() {
  const tok = await getToken();
  const state = loadState();
  const results = [];
  for (const p of PRODUCTS) {
    try {
      const status = await checkProduct(tok, p, TARGET_DATE);
      results.push({ p, status });
    } catch (e) {
      results.push({ p, status: 'error', error: e.message });
      log('WARN', p.name, e.message);
    }
  }

  const summary = results.map((r) => `${r.p.name}=${r.status}`).join('  ');
  log(`[${TARGET_DATE}] ${summary}`);

  // Newly available products = available now AND not already alerted for this date.
  const available = results.filter((r) => r.status === 'availability');
  const fresh = available.filter((r) => state.alerted[r.p.id] !== TARGET_DATE);

  // Reset dedupe for products that are no longer available (so a re-open re-alerts).
  for (const r of results) {
    if (r.status !== 'availability' && state.alerted[r.p.id] === TARGET_DATE) {
      delete state.alerted[r.p.id];
    }
  }

  if (fresh.length) {
    const names = fresh.map((r) => r.p.name).join(', ');
    const first = fresh[0].p;
    await sendPushover({
      title: `🎟️ Sagrada Família OPEN — ${TARGET_DATE}`,
      message: `Tickets just opened for ${TARGET_DATE}: ${names}. Book NOW on the official site before it sells out.`,
      url: productUrl(first),
      urlTitle: `Book ${first.name}`,
    });
    for (const r of fresh) state.alerted[r.p.id] = TARGET_DATE;
  }

  saveState(state);
  return { results, fresh };
}

const loopMin = Number(process.env.LOOP_MINUTES || 0);
if (loopMin > 0) {
  log(`Starting loop: checking ${TARGET_DATE} every ${loopMin} min`);
  const tick = () => runOnce().catch((e) => log('ERROR run failed:', e.message));
  await tick();
  setInterval(tick, loopMin * 60 * 1000);
} else {
  try {
    await runOnce();
  } catch (e) {
    log('ERROR run failed:', e.message);
    process.exit(1);
  }
}
