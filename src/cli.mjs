import { open, all } from './db.mjs';
import { runMatching, draftOutreach, analyzeAll } from './app.mjs';

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
} else {
  console.log('usage: node src/cli.mjs match|analyze|draft-prospects');
  process.exitCode = 1;
}
db.close();
