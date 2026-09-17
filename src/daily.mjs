import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { open, ROOT } from './db.mjs';
import { dailyReport, usd } from './app.mjs';

export function renderDaily(r) {
  const o = r.overview, pct = x => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const L = [`# Deal Desk daily brief: ${r.date}`, ''];
  L.push('## TODAY\'S OPPORTUNITIES', '');
  if (!r.opportunities.length) L.push('- No qualified properties yet. Run `npm run ingest`.');
  for (const p of r.opportunities)
    L.push(`- **#${p.id} ${p.address}** (${p.neighborhood}): score ${p.score} (${p.score_breakdown.map(b => b.signal).join(', ')}). ARV ${usd(p.est_arv)} [ESTIMATED, ${p.arv_confidence}], max contract ${usd(p.offer_high)} [ESTIMATED]. Verify: ${p.record_url}`);
  if (r.prospects.length) L.push('', `- ${r.prospects.length} investor/wholesaler prospect(s) not yet contacted: ${r.prospects.map(b => b.company ?? b.name).join(', ')}`);
  L.push('', '## TODAY\'S ACTIONS (you)', '');
  if (!r.tasks.length) L.push('- Nothing due.');
  for (const t of r.tasks) L.push(`- [${t.kind}] ${t.title}${t.detail ? `: ${t.detail}` : ''}`);
  L.push('', '## OUTREACH', '', `- Awaiting your approval: ${r.approvals.length}`);
  const blocked = r.approvals.filter(a => a.risk_flags.some(f => f.level === 'BLOCK'));
  if (blocked.length) L.push(`- ${blocked.length} of them are blocked (see BLOCKERS).`);
  L.push(`- Approved, waiting for you to send: ${r.approved.length}`);
  L.push('', '## DEALS', '');
  if (!r.deals.length) L.push('- No active conversations need attention.');
  for (const d of r.deals) L.push(`- #${d.id} [${d.track}] ${d.stage}${d.next_action ? `: ${d.next_action}` : ''}`);
  L.push('', '## MONEY', '',
    `- Actual revenue: ${usd(o.actual_revenue ?? 0)} · Expenses: ${usd(o.expenses ?? 0)} · Net: ${usd(o.net_profit ?? 0)}`,
    `- Expected (not income until paid): ${usd(o.expected_revenue ?? 0)} · Pipeline fees on active deals: ${usd(o.estimated_pipeline_value ?? 0)}`,
    `- Messages sent: ${o.messages_sent} · Response rate: ${pct(o.response_rate)} · Conversion: ${pct(o.conversion_rate)} · Cost/lead: ${o.cost_per_lead == null ? 'n/a' : usd(o.cost_per_lead)}`);
  L.push('', '## BLOCKERS', '');
  for (const b of r.blockers) L.push(`- ${b}`);
  if (!r.blockers.length) L.push('- None.');
  L.push('', '## NEXT ACTION', '', `**${r.next_action}**`, '');
  return L.join('\n');
}

if (process.argv[1]?.endsWith('daily.mjs')) {
  const db = open();
  const md = renderDaily(dailyReport(db));
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const file = resolve(ROOT, 'reports', `daily-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, md);
  console.log(md + `\n(saved ${file})`);
  db.close();
}
