// Validation with CORRECT per-product venueId (derived from productVenueSet,
// the entry with the smallest viewDisplayOrder — the one that drives the calendar).
const BASE = 'https://services.clorian.com';
const SECRET = 'thesagradafamiliafrontendoftomorrow';
const POS = '649', SG = 1;
const H = (tok) => ({
  Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json',
  pos: POS, 'accept-language': 'en', Origin: 'https://tickets.sagradafamilia.org',
  Referer: 'https://tickets.sagradafamilia.org/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
});
const tok = await (await fetch(`${BASE}/user/api/oauth/token?secretKey=${SECRET}`, {
  method: 'POST', headers: { Origin: 'https://tickets.sagradafamilia.org', Referer: 'https://tickets.sagradafamilia.org/' },
})).json().then((j) => j.access_token);

const products = [
  { id: 4374, name: 'Guided Tour' },
  { id: 4375, name: 'Basic entry' },
  { id: 4443, name: 'With Towers' },
  { id: 4779, name: 'Guide + Towers' },
];
const months = [[6, 2026], [7, 2026], [8, 2026]];

async function venueIdFor(pid) {
  const j = await (await fetch(`${BASE}/catalog/salesGroups/${SG}/product/${pid}/views/loyalty`, { headers: H(tok) })).json();
  const set = (j.productVenueSet || []).slice().sort((a, b) => (a.viewDisplayOrder ?? 99) - (b.viewDisplayOrder ?? 99));
  return set[0]?.venueId;
}
async function month(pid, venueId, m, y) {
  const qs = new URLSearchParams({ minTickets: '1', month: String(m), year: String(y), venueId: String(venueId) });
  const r = await fetch(`${BASE}/catalog/salesGroups/${SG}/product/${pid}/availability?${qs}`, { headers: H(tok) });
  return { status: r.status, map: await r.json().catch(() => ({})) };
}

for (const p of products) {
  const venueId = await venueIdFor(p.id);
  console.log(`\n========== ${p.id} ${p.name}  (venueId=${venueId}) ==========`);
  for (const [m, y] of months) {
    const { status, map } = await month(p.id, venueId, m, y);
    const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    const avail = entries.filter(([, v]) => v === 'availability').map(([d]) => d.slice(8));
    const no = entries.filter(([, v]) => v === 'no-availability').length;
    console.log(`${y}-${String(m).padStart(2, '0')}: status=${status} days=${entries.length} available=${avail.length} sold-out=${no}`);
    if (avail.length) console.log(`   available: ${avail.join(', ')}`);
  }
}
