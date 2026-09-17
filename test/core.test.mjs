import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, one, run, setSetting } from '../src/db.mjs';
import { scoreProperty, estimateArv, underwrite, matchScore, parseBuyerText, checkTransition, propertyKey, normalizeAddress } from '../src/lib/core.mjs';
import { upsertProperty, analyzeAll, saveBuyer, draftOutreach, reviewOutreach, markSent, logResponse, moveOpportunity, updateOpportunity, overview } from '../src/app.mjs';
import { mapParcel } from '../src/ingest/cleveland.mjs';

const subject = { parcel_id: '1', neighborhood: 'Slavic Village', zip: '44105', units: 1, living_sqft: 1200, condition_grade: 'D' };
const comp = (id, amount, grade = 'B', sqft = 1200) => ({ parcel_id: String(id), neighborhood: 'Slavic Village', zip: '44105', units: 1, living_sqft: sqft, sale_amount: amount, condition_grade: grade });

test('score is the sum of evidenced signals, capped at 100', () => {
  const { score, breakdown } = scoreProperty({ foreclosure_flag: 1, tax_delinquent_amount: 6000, violations_6mo: 5, violations_total: 9, survey_category: 'Vacant Structure', condition_grade: 'F', owner_out_of_state: 1, last_sale_date: '1990-01-01' }, new Date('2026-09-17'));
  assert.equal(score, 100);
  assert.ok(breakdown.every(b => b.evidence && b.points > 0));
  assert.equal(scoreProperty({ tax_delinquent_amount: 0, violations_6mo: 0 }).score, 0);
});

test('ARV refuses to guess with fewer than 3 comps and prefers A/B-grade sales', () => {
  assert.equal(estimateArv(subject, [comp(2, 90000), comp(3, 95000)]), null);
  const a = estimateArv(subject, [comp(2, 120000), comp(3, 132000), comp(4, 126000), comp(5, 30000, 'D'), comp(6, 25000, 'F')]);
  assert.equal(a.basis, 'A/B-grade sales');
  assert.equal(a.arv, 126000);
  assert.equal(a.confidence, 'LOW');
});

test('underwriting flags deals that cannot pay a fee', () => {
  const comps = [comp(2, 60000), comp(3, 62000), comp(4, 58000)];
  const u = underwrite(subject, comps, { feeLow: 5000, feeHigh: 15000 });
  assert.equal(u.est_repairs, 60000); // grade D: 50/sqft * 1200
  assert.equal(u.economics_flag, 'BAD_NUMBERS');
  assert.equal(underwrite({ ...subject, living_sqft: null }, comps).economics_flag, 'DATA_INSUFFICIENT');
  const rich = [comp(2, 150000), comp(3, 156000), comp(4, 144000)];
  assert.equal(underwrite({ ...subject, condition_grade: 'B', county_market_value: 40000 }, rich).economics_flag, 'VERIFY_ARV');
});

test('matching needs stated criteria and explains itself', () => {
  const p = { zip: '44105', neighborhood: 'Slavic Village', city: 'Cleveland', units: 1, offer_high: 40000, est_repairs: 30000, condition_grade: 'D' };
  const m = matchScore(p, { criteria: { zips: ['44105'], max_price: 60000, property_types: ['sfr'], max_repairs: 50000 }, criteria_status: 'STATED' });
  assert.equal(m.score, 100);
  assert.equal(m.blockers.length, 0);
  const none = matchScore(p, { criteria: {}, criteria_status: 'UNKNOWN' });
  assert.ok(none.score <= 30 && none.blockers.length);
});

test('capture parses public buyer posts without inventing criteria', () => {
  const r = parseBuyerText('Cash buyer looking for single family and duplexes in 44105, 44108, Slavic Village. Under $80k, any condition. Flips and rentals.');
  assert.deepEqual(r.criteria.zips, ['44105', '44108']);
  assert.equal(r.criteria.max_price, 80000);
  assert.deepEqual(r.criteria.property_types, ['sfr', 'duplex']);
  assert.equal(r.criteria.rehab_ok, true);
  assert.equal(r.role, 'cash_buyer');
  assert.equal(parseBuyerText('hello group').criteria_status, 'UNKNOWN');
});

test('pipeline refuses to market a property without a controlled, disclosed, reviewed contract', () => {
  const o = { track: 'deal', contract_signed: 0, seller_disclosure: 0, professional_review: 0 };
  assert.equal(checkTransition(o, 'BUYER_MATCH', { trackBReady: true }).ok, false);
  assert.equal(checkTransition(o, 'OFFER_DISCUSSION').ok, false);
  assert.equal(checkTransition({ ...o, contract_signed: 1, seller_disclosure: 1, professional_review: 1 }, 'BUYER_MATCH', { trackBReady: true }).ok, true);
  assert.equal(checkTransition({ track: 'client' }, 'REVENUE').ok, false);
  assert.equal(checkTransition(o, 'NOT_INTERESTED').ok, true);
});

test('dedupe keys normalise parcels and addresses', () => {
  assert.equal(propertyKey({ parcel_id: '126-04-011' }), 'parcel:12604011');
  assert.equal(normalizeAddress('1234 East 55th Street, #2'), '1234 E 55TH ST 2');
});

test('county parcel mapping labels provenance and leaves unknowns unknown', () => {
  const r = mapParcel({ parcelpin: '12604011', std_property_address: '1 MAIN ST CLEVELAND OH 44105', parcel_zip: '44105.0', tax_luc: '5100', total_res_liv_area: 1100, taxbill_update_date: Date.UTC(2026, 8, 11), foreclosure_flag: 1, taxDelinquencyAmount: 2500, Survey2022_Grade: 'N/A' });
  assert.equal(r.address, '1 MAIN ST');
  assert.equal(r.zip, '44105');
  assert.equal(r.units, 1);
  assert.equal(r.condition_grade, null);
  assert.equal(r.provenance.foreclosure_flag.status, 'VERIFIED');
  assert.equal(r.beds, undefined);
});

test('end to end: ingest → analyze → draft blocked → fill sender → approve → sent → response → revenue gate', () => {
  const db = open(':memory:');
  for (let i = 0; i < 4; i++) db.prepare(`INSERT INTO comps (parcel_id, neighborhood, zip, units, living_sqft, sale_amount, condition_grade) VALUES (?,?,?,?,?,?,?)`).run('c' + i, 'Slavic Village', '44105', 1, 1200, 150000, 'A');
  const rec = { parcel_id: '9', address: '1 MAIN ST', city: 'Cleveland', state: 'OH', zip: '44105', market: 'Cleveland, OH', units: 1, living_sqft: 1200, neighborhood: 'Slavic Village', condition_grade: 'C', tax_delinquent_amount: 7000, foreclosure_flag: 1, violations_6mo: 1, source: 'test' };
  const pid = upsertProperty(db, propertyKey(rec), rec);
  upsertProperty(db, propertyKey(rec), rec); // duplicate ingest is a no-op
  assert.equal(one(db, 'SELECT COUNT(*) n FROM properties').n, 1);
  const a = analyzeAll(db);
  assert.equal(a.qualified, 1);
  assert.equal(one(db, 'SELECT COUNT(*) n FROM opportunities').n, 1);
  analyzeAll(db);
  assert.equal(one(db, 'SELECT COUNT(*) n FROM opportunities').n, 1, 're-analysis must not duplicate opportunities');
  const p = one(db, 'SELECT * FROM properties WHERE id=?', pid);
  assert.equal(JSON.parse(p.provenance).est_arv.status, 'ESTIMATED');

  const bid = saveBuyer(db, { company: 'Acme Buyers', website: 'https://acme.example', text: 'We buy houses in Cleveland, as-is', source: 'test' });
  const d1 = draftOutreach(db, { template: 'investor_service_offer', buyer_id: bid });
  assert.throws(() => reviewOutreach(db, d1, { decision: 'approve' }), /missing facts/i);

  for (const [k, v] of Object.entries({ sender_name: 'A', sender_business: 'B', sender_email: 'a@b.c', sender_postal: 'Street 1', service_price_week: 49 })) setSetting(db, k, v);
  const d2 = draftOutreach(db, { template: 'investor_service_offer', buyer_id: bid });
  const body = one(db, 'SELECT body FROM outreach WHERE id=?', d2).body;
  assert.match(body, /1 properties scored 40\+/);
  assert.doesNotMatch(body, /1 MAIN ST/, 'address withheld in cold outreach');
  reviewOutreach(db, d2, { decision: 'approve' });
  markSent(db, d2);
  logResponse(db, d2, { text: 'send sample', outcome: 'interested' });
  const opp = one(db, `SELECT * FROM opportunities WHERE track='client' AND buyer_id=?`, bid);
  assert.equal(opp.stage, 'INTERESTED');
  assert.throws(() => moveOpportunity(db, opp.id, { stage: 'REVENUE' }), /actual amount/);
  updateOpportunity(db, opp.id, { actual_fee: 49 });
  moveOpportunity(db, opp.id, { stage: 'REVENUE' });
  assert.equal(overview(db).actual_revenue, 49);

  const deal = draftOutreach(db, { template: 'cash_buyer_deal', buyer_id: bid, property_id: pid });
  assert.throws(() => reviewOutreach(db, deal, { decision: 'approve' }), /signed \+ disclosed/);
  assert.ok(one(db, 'SELECT COUNT(*) n FROM audit').n > 5);
  db.close();
});
