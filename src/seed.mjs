// Idempotent seed: defaults, research evidence, first public prospects, and the human tasks the system cannot do.
import { open, run, one, getSettings, setSetting, audit } from './db.mjs';
import { saveBuyer } from './app.mjs';

const db = open();
const ACCESSED = '2026-09-17';

const DEFAULTS = {
  market_city: 'Cleveland', market: 'Cleveland, OH',
  fee_target_low: 5000, fee_target_high: 15000,
  service_price_week: 49, // ASSUMPTION: test price for the weekly list; adjust after first 10 conversations
  sender_name: '', sender_business: '', sender_email: '', sender_postal: '',
  track_b_ready: 'false', payment_ready: 'false',
};
const s = getSettings(db);
for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) setSetting(db, k, v);

const E = (topic, label, claim, source_title, url) => ({ topic, label, claim, source_title, url });
const EVIDENCE = [
  E('video', 'FACT', 'Video is an Instagram reel by @maximiliandier ("AI Should Be Illegal..."): Claude.ai prompt "Write me an offer contract on [address] and include assignment language", auction.com foreclosure listing (15060 SW 80th Ave, Palmetto Bay, Miami-Dade, "Scheduled", "Bid at County Site"), Facebook Groups search and an investor group post offering cash buyers/novations, a generated "Residential Purchase and Sale Agreement (Assignable, As-Is, Cash/Wholesale)", then the "Wholesailors (Wholesale Skool)" paid community.', 'Frames extracted from the uploaded video', null),
  E('video', 'ASSUMPTION', 'The creator\'s own revenue shown is the paid Skool community and the assigns.com software announcement, not a closed deal.', 'Inference from on-screen Skool page', null),
  E('law', 'FACT', 'Pennsylvania Act 52 of 2024 (effective 2025-01-08) requires wholesalers to register/obtain a license, give written notice, and gives sellers a 30-day cancellation right.', 'Barley Snyder: Act 52', 'https://www.barley.com/act-52-imposes-new-regulations-on-real-estate-wholesaling-in-pennsylvania/'),
  E('law', 'FACT', 'North Carolina requires a real estate license to wholesale residential property from 2025-10-01 (H797), with a non-waivable 30-day seller cancellation right.', 'NC General Assembly H797', 'https://lrs.sog.unc.edu/billsum/h-797-2025-2026'),
  E('law', 'FACT', 'Ohio SB 155 (signed 2025-12-01, effective 2026-03-02) requires wholesalers to give a bold, 12pt+ disclosure of intent when contracting with an owner; without it the owner can cancel before closing.', 'Ohio REALTORS', 'https://www.ohiorealtors.org/blog/2263/breaking-news-wholesaling-reform-becomes-law-in-ohio/'),
  E('law', 'FACT', 'Tennessee SB 909 (effective 2025-03-25) requires wholesalers to disclose their equitable interest to seller and buyer, and intent to assign at least 3 business days before assignment.', 'Tennessee SB 909', 'https://legiscan.com/TN/bill/SB0909/2025'),
  E('law', 'FACT', 'Maryland HB 124 (effective 2025-10-01) creates seller and end-buyer disclosure duties for wholesale assignments, with rescission rights.', 'Maryland General Assembly HB0124', 'https://mgaleg.maryland.gov/mgawebsite/Legislation/Details/hb0124?ys=2025RS'),
  E('law', 'FACT', 'Texas Occ. Code 1101.0045: assigning a contract without a license requires written disclosure of the equitable interest to seller and buyer (since 2024-01-01); otherwise it is brokerage.', 'Texas Occupations Code 1101.0045', 'https://texas.public.law/statutes/tex._occ._code_section_1101.0045'),
  E('law', 'SOURCE', 'South Carolina (HB 4754, 2024) treats wholesaling as brokerage requiring a license; Oklahoma (SB 1072) requires a license to market property you do not own; Illinois requires a license beyond one deal per 12 months.', 'Deal Run / REsimpli summaries (secondary)', 'https://dealrun.ai/blog/states-requiring-license-wholesale'),
  E('law', 'SOURCE', 'Florida has no wholesaling statute, but Chapter 475 requires marketing the contract, not the property; unlicensed brokerage penalties apply.', 'Deal Run Florida guide (secondary)', 'https://dealrun.ai/compliance/florida'),
  E('law', 'FACT', 'Florida 501.1377: acquiring an interest in a home in foreclosure is a regulated foreclosure-rescue transaction; violations are deceptive trade practices up to $15,000 each.', 'Florida Statutes 501.1377', 'https://law.justia.com/codes/florida/title-xxxiii/chapter-501/part-i/section-501-1377/'),
  E('law', 'FACT', 'Miami-Dade foreclosure sales run on the clerk\'s realforeclose site; the winner forfeits the 5% deposit if the balance is not paid by noon the next business day. There is no owner to sign a wholesale contract.', 'Miami-Dade Clerk / county foreclosure guide', 'https://www.miamidadeclerk.gov/clerk/mortgage-foreclosures.page'),
  E('tax', 'FACT', 'FIRPTA: when a foreign person assigns a contract to buy US real property, the payer must generally withhold 15% of the amount realized (e.g. 15% of a $30,000 assignment fee).', 'IRS FIRPTA withholding; Abitos analysis', 'https://www.irs.gov/individuals/international-taxpayers/firpta-withholding'),
  E('marketing', 'FACT', 'TCPA statutory damages are $500 per unsolicited call/text, $1,500 if willful; marketing texts to cell phones need prior express written consent. 2,588 TCPA suits were filed Jan-Nov 2025.', 'Deal Run SMS guide; Goodwin TCPA review', 'https://www.goodwinlaw.com/en/insights/publications/2026/03/insights-finance-cfs-yir-telephone-consumer-protection-act'),
  E('platform', 'FACT', 'Meta\'s Automated Data Collection Terms prohibit collecting data from Meta products by automated means without permission, logged in or not.', 'Facebook Automated Data Collection Terms', 'https://www.facebook.com/legal/automated_data_collection_terms'),
  E('market', 'FACT', 'ATTOM H1 2026: foreclosure filings up 21% YoY (227,548 properties); Florida has the highest state rate (1 in 373 units), then SC, IN, DE, IL, NV, NJ, OH (1 in 495), MD.', 'ATTOM Mid-Year 2026 Foreclosure Market Report', 'https://www.attomdata.com/news/market-trends/foreclosures/2026-mid-year-foreclosure-market-report/'),
  E('market', 'FACT', 'ATTOM H1 2026 highest metro rates (200k+ pop): Punta Gorda FL 1/200, Lakeland FL 1/208, Columbia SC 1/233, Macon GA 1/278, Fayetteville NC 1/278, Cape Coral FL 1/286, Cleveland OH 1/303, Jacksonville FL 1/323.', 'ATTOM Mid-Year 2026', 'https://www.attomdata.com/news/market-trends/foreclosures/2026-mid-year-foreclosure-market-report/'),
  E('market', 'FACT', 'Tested 2026-09-17: Cleveland Property Insights public API has 162,869 parcels with tax delinquency, foreclosure flag, code-violation counts, absentee-owner and 2022 condition-grade fields; 104,108 are 1-3 family, 15,679 of those carry a distress signal, 11,937 sold for >$10k in the last 24 months.', 'City of Cleveland Property Insights (ArcGIS)', 'https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Parcel_Analytics_(PUBLIC_DRAFT_)/FeatureServer/0'),
  E('market', 'FACT', 'Tested 2026-09-17: Detroit blight-ticket API has 904,619 records updated the same day; Indianapolis code-enforcement API latest record is 2024-02-27 (stale); no Baltimore, Memphis or Jacksonville distress dataset was found via ArcGIS Hub or Socrata catalog search.', 'ArcGIS Hub / Socrata catalog probes', 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/blight_tickets/FeatureServer/0'),
  E('market', 'SOURCE', 'Offshore real-estate VAs price roughly $8-$20/hour; cold-calling VAs $400-$900/month on freelance platforms.', 'CallingAgency guide (secondary)', 'https://callingagency.com/blog/how-to-use-virtual-assistants-for-real-estate-cold-calling/'),
  E('market', 'FACT', 'Redfin: investors bought 19% of homes sold in its analyzed metros (Q4 2025), down from 20% a year earlier.', 'Redfin investor report', 'https://www.redfin.com/news/investors/'),
  E('pricing', 'ASSUMPTION', 'Weekly list priced at $49 as a test price. Not benchmarked against a verified competitor price this session.', 'Operator decision', null),
  E('pricing', 'UNKNOWN', 'How many Cleveland investors will pay for a public-records distress list, and at what price. Only outreach results can answer this.', null, null),
];
const ins = db.prepare('INSERT INTO evidence (topic, label, claim, source_title, url, accessed_at) VALUES (?,?,?,?,?,?) ON CONFLICT(claim) DO NOTHING');
for (const e of EVIDENCE) ins.run(e.topic, e.label, e.claim, e.source_title, e.url, ACCESSED);

// First prospects: Cleveland "we buy houses" businesses found by web search. Businesses advertising publicly;
// only company-level info is stored. Criteria come from search-result text and are marked unverified.
const P = (company, website, text) => ({ company, website, source_url: website, contact_method: 'website_form', contact_value: website,
  source: 'web search "we buy houses Cleveland" 2026-09-17', role: 'investor', text, notes: 'Criteria from search snippet; read their site before sending.' });
const PROSPECTS = [
  P('Cleveland House Buyers', 'https://www.clevelandhousebuyers.com/', 'We buy houses in Cleveland: single-family, multi-family, duplexes, condos, as-is'),
  P('Sesa Properties', 'https://sesabuyshouses.com/', 'We buy houses in Cleveland: houses, multi-family, apartments, rentals, vacant land, as-is'),
  P('Cleveland Cash Offers', 'https://www.clecashoffers.com/', 'Cash home buyer in Cleveland; we buy houses'),
  P('House Buyers Ohio', 'https://housebuyersohio.com/we-buy-houses-cleveland/', 'We buy houses in Cleveland Ohio for cash, as-is'),
  P('Lorain County Home Buyers', 'https://www.loraincountyhomebuyers.com/sell-my-house-fast-cleveland-oh/', 'We buy houses in Cleveland for cash'),
  P('Cash Buyers Depot', 'https://cashbuyersdepot.com/', 'We buy houses for cash across Cleveland and Ohio'),
  P('Skymount Buys Houses', 'https://skymountbuyshouses.com/', 'We buy houses in Cleveland for cash, as-is, no repairs'),
  P('LP Property Group', 'https://lppropertygroup.com/sell-your-house-fast-cleveland-oh', 'We buy houses in Cleveland as-is: homes needing repairs, inherited, vacant, rentals with tenants'),
];
for (const p of PROSPECTS) saveBuyer(db, p, 'seed');

const TASKS = [
  ['human', 'Fill your sender profile (Settings)', 'Real name, business name, business email, postal address. CAN-SPAM requires a real sender and postal address; drafts stay blocked until done.'],
  ['human', 'Set up a way to get paid (Payoneer or similar)', 'Needs your identity verification, so you do it. Then set payment_ready=true in Settings.'],
  ['human', 'Join 2-3 Cleveland real-estate investor Facebook groups from your own account', 'Read each group\'s rules. Copy public "I\'m buying in..." posts into Buyers → Capture by hand. No scraping, no bulk DMs.'],
  ['human', 'Before sending: open each prospect\'s website and confirm they buy in Cleveland', 'Mark verified in Buyers, or reject the draft.'],
];
for (const [kind, title, detail] of TASKS)
  if (!one(db, 'SELECT 1 FROM tasks WHERE title = ?', title)) run(db, 'INSERT INTO tasks (kind, title, detail) VALUES (?,?,?)', kind, title, detail);

audit(db, 'seed', 'seed', null, null, { evidence: EVIDENCE.length, prospects: PROSPECTS.length });
console.log(`seeded: ${EVIDENCE.length} evidence, ${PROSPECTS.length} prospects, ${TASKS.length} tasks`);
db.close();
