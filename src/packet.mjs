// The deliverable a client pays for: a printable ranked list of distressed properties with sources and labelled estimates.
// usage: node src/packet.mjs [--buyer=ID] [--n=10] [--types=sfr,duplex]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { open, one, all, parse, audit, ROOT } from './db.mjs';
import { hydrateBuyer } from './app.mjs';

const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = n => (n == null ? 'unknown' : '$' + Math.round(n).toLocaleString('en-US'));
const TYPE_UNITS = { sfr: 1, duplex: 2, multi: 3 };

export function selectPacket(db, { buyer = null, n = 10, types = null } = {}) {
  const wanted = types ?? buyer?.criteria?.property_types ?? [];
  const units = wanted.map(t => TYPE_UNITS[t]).filter(Boolean);
  const hoods = (buyer?.criteria?.areas ?? []).filter(a => a !== 'Cleveland');
  const rows = all(db, `SELECT p.* FROM properties p JOIN opportunities o ON o.property_id=p.id AND o.track='deal'
    WHERE o.stage != 'LEAD' AND o.failure IS NULL ${units.length ? `AND p.units IN (${units.join(',')})` : ''}
    ORDER BY p.score DESC, p.offer_high DESC LIMIT 400`);
  // Prefer the buyer's named neighborhoods, then spread across neighborhoods so one street doesn't fill the list.
  const pref = rows.filter(p => hoods.some(h => h.toLowerCase() === (p.neighborhood ?? '').toLowerCase()));
  const seen = new Map(), out = [];
  for (const p of [...pref, ...rows]) {
    if (out.includes(p) || (seen.get(p.neighborhood) ?? 0) >= 2) continue;
    seen.set(p.neighborhood, (seen.get(p.neighborhood) ?? 0) + 1);
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

export function renderPacket(props, { buyer, date, sender, redact = false }) {
  const hide = v => (redact ? '••••••' : esc(v));
  const dataDate = props[0]?.last_verified ?? date;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cleveland Distress List ${esc(date)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--ink:#18211D;--muted:#5B6862;--line:#D7DDD8;--accent:#1F5F4A;--soft:#EEF3EF;--warn:#9A6212;--warnsoft:#FBF0DC;--ok:#2F7D4F;--oksoft:#E3F1E8}
body{margin:0;background:#fff;color:var(--ink);font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif;padding:32px 16px}
.wrap{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
h1{font-size:24px;margin:0;font-weight:600;text-wrap:balance}h2{font-size:15px;margin:0;font-weight:600}
.muted{color:var(--muted)}.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.legend{display:flex;gap:10px;flex-wrap:wrap}.tag{font:500 10.5px "IBM Plex Mono",monospace;padding:1px 6px;border-radius:4px;letter-spacing:.03em}
.v{background:var(--oksoft);color:var(--ok)}.e{background:var(--warnsoft);color:var(--warn)}
article{border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;break-inside:avoid}
article header{grid-column:1/-1;display:flex;justify-content:space-between;gap:12px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:4px}
.rank{font:600 12px "IBM Plex Mono",monospace;color:var(--accent)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:3px 12px;margin:0}dt{color:var(--muted)}dd{margin:0}
ul{margin:0;padding-left:18px}
.foot{border-top:1px solid var(--line);padding-top:12px;font-size:12px}
@media (max-width:700px){article{grid-template-columns:1fr}}
@media print{body{padding:0}a{color:inherit}}
</style></head><body><div class="wrap">
<header><h1>Cleveland distressed 1–3 family properties</h1>
<p class="muted">${buyer ? `Prepared for ${esc(buyer.company ?? buyer.name)} · ` : ''}${esc(date)} · county data as of ${esc(dataDate)} · ${props.length} properties</p></header>
<div class="legend"><span><span class="tag v">VERIFIED</span> from Cuyahoga County / City of Cleveland public records (link on each)</span><span><span class="tag e">ESTIMATED</span> our model, not an appraisal: check before you offer</span></div>
${props.map((p, i) => {
  const why = parse(p.score_breakdown, []);
  return `<article><header><div><span class="rank">#${i + 1} · score ${p.score}</span><h2>${redact ? 'Address withheld' : esc(p.address)}, Cleveland OH ${esc(p.zip)}</h2><span class="muted">${esc(p.neighborhood)} · parcel ${hide(p.parcel_id)}</span></div>${redact ? '<span class="muted">County record</span>' : `<a href="${esc(p.record_url)}" target="_blank" rel="noopener">County record</a>`}</header>
<div><dl>
<dt>Type</dt><dd>${p.units ?? '?'}-family · ${p.living_sqft ?? '?'} sq ft · built ${p.year_built ?? '?'} <span class="tag v">VERIFIED</span></dd>
<dt>Condition</dt><dd>${p.condition_grade ? `grade ${esc(p.condition_grade)}` : 'not graded'}${p.survey_category ? ` · ${esc(p.survey_category)}` : ''} (city survey 2022)${p.photo_url && !redact ? ` · <a href="${esc(p.photo_url)}" target="_blank" rel="noopener">photo</a>` : ''}</dd>
<dt>Owner</dt><dd>${hide(p.owner_name)}${p.owner_out_of_state ? ' · out of state' : ''}</dd>
<dt>Mailing</dt><dd>${hide(p.owner_mailing)}</dd>
<dt>Last sale</dt><dd class="mono">${esc(p.last_sale_date ?? '?')} · ${usd(p.last_sale_amount)}</dd>
<dt>County value</dt><dd class="mono">${usd(p.county_market_value)}</dd>
</dl></div>
<div><dl>
<dt>Why listed</dt><dd><ul>${why.map(w => `<li>${esc(w.evidence)}</li>`).join('')}</ul></dd>
<dt>ARV</dt><dd class="mono">${usd(p.est_arv)} <span class="tag e">ESTIMATED</span> <span class="muted">${p.arv_comps} sales, ${esc(p.arv_confidence)} confidence</span></dd>
<dt>Repairs</dt><dd class="mono">${usd(p.est_repairs)} <span class="tag e">ESTIMATED</span></dd>
<dt>70% rule max</dt><dd class="mono">${usd(p.mao)} <span class="tag e">ESTIMATED</span></dd>
</dl></div></article>`;
}).join('\n')}
<div class="foot muted">
<p><b>Method.</b> Parcels with at least one distress signal (tax delinquency, foreclosure flag, code violations in the last 6 months, vacancy, condition grade D/F) are scored on transparent points. ARV = median $/sq ft of A/B-grade 1–3 family sales in the same neighborhood (else zip) over 24 months, bulk portfolio sales removed, applied to the subject's sq ft. Repairs = $/sq ft by condition grade. Properties whose ARV exceeds 3× county value are excluded until comps are checked by hand.</p>
<p><b>Use.</b> This is research, not an offer, listing or appraisal, and nobody here holds a contract on these properties. Owner contact is your responsibility: follow TCPA/National Do Not Call rules for calls and texts, and Ohio SB 155 disclosure if you plan to assign a contract.</p>
${sender && !redact ? `<p>${esc(sender)}</p>` : ''}
</div></div></body></html>`;
}

if (process.argv[1]?.endsWith('packet.mjs')) {
  const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
  const db = open();
  const buyer = arg('buyer') ? hydrateBuyer(one(db, 'SELECT * FROM buyers WHERE id=?', Number(arg('buyer')))) : null;
  const date = new Date().toISOString().slice(0, 10);
  const redact = process.argv.includes('--redact');
  const props = selectPacket(db, { buyer, n: Number(arg('n') ?? 10), types: arg('types')?.split(',') });
  const s = Object.fromEntries(all(db, 'SELECT key, value FROM settings').map(r => [r.key, r.value]));
  const sender = [s.sender_name, s.sender_business, s.sender_email].filter(Boolean).join(' · ');
  const slug = (buyer?.company ?? 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const file = resolve(ROOT, 'reports', `packet-${slug}${redact ? '-redacted' : ''}-${date}.html`);
  writeFileSync(file, renderPacket(props, { buyer, date, sender, redact }));
  audit(db, 'system', 'packet', 'buyers', buyer?.id ?? null, { file, properties: props.map(p => p.id) });
  console.log(file);
  db.close();
}
