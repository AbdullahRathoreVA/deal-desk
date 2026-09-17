import { open, all } from './db.mjs';
import { runMatching, draftOutreach, analyzeAll, logResponse } from './app.mjs';

const db = open();
const [cmd] = process.argv.slice(2);

if (cmd === 'match') console.log(runMatching(db));
else if (cmd === 'analyze') console.log(analyzeAll(db));
else if (cmd === 'draft-prospects') {
  // One service-offer draft per uncontacted prospect. Drafts only: approval + manual send happen in the dashboard.
  const prospects = all(db, `SELECT b.* FROM buyers b WHERE b.do_not_contact=0 AND b.role IN ('investor','cash_buyer','wholesaler')
    AND NOT EXISTS (SELECT 1 FROM outreach m WHERE m.buyer_id=b.id AND m.status != 'REJECTED')`);
  for (const b of prospects) {
    const id = draftOutreach(db, { template: b.role === 'wholesaler' ? 'wholesaler_service_offer' : 'investor_service_offer', buyer_id: b.id });
    console.log(`draft #${id} → ${b.company ?? b.name}`);
  }
  if (!prospects.length) console.log('No uncontacted prospects.');
} else if (cmd === 'log-reply') {
  // node src/cli.mjs log-reply <domain> <interested|responded|not_interested|opt_out> "<reply text>"
  const [, domain, outcome, text] = process.argv.slice(2);
  const m = all(db, `SELECT o.id FROM outreach o JOIN buyers b ON b.id = o.buyer_id
    WHERE o.status = 'SENT' AND (b.website LIKE ? OR b.contact_value LIKE ?) ORDER BY o.id DESC LIMIT 1`, `%${domain}%`, `%${domain}%`)[0];
  if (!m) { console.log(`No SENT outreach for ${domain} (already logged, or not contacted).`); }
  else { logResponse(db, m.id, { outcome, text }, 'daily-task'); console.log(`logged ${outcome} on outreach #${m.id}`); }
} else {
  console.log('usage: node src/cli.mjs match|analyze|draft-prospects|log-reply');
  process.exitCode = 1;
}
db.close();
