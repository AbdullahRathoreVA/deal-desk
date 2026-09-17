// Pure business logic. No I/O here, so every rule is testable and auditable.

// ---------------------------------------------------------------- normalize

const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD', COURT: 'CT',
  PLACE: 'PL', LANE: 'LN', TERRACE: 'TER', PARKWAY: 'PKWY', CIRCLE: 'CIR', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };

export function normalizeAddress(raw) {
  return String(raw ?? '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(w => SUFFIX[w] ?? w).join(' ');
}

export function propertyKey({ parcel_id, address, zip }) {
  return parcel_id ? `parcel:${String(parcel_id).replace(/\D/g, '')}` : `addr:${normalizeAddress(address)}|${zip ?? ''}`;
}

export function buyerKey({ website, contact_value, company, name }) {
  if (website) return 'web:' + String(website).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
  if (contact_value) return 'contact:' + String(contact_value).toLowerCase().trim();
  return 'name:' + normalizeAddress(company || name);
}

// ------------------------------------------------------------------ scoring
// Transparent distress score. Every point carries the evidence that earned it.

export const SIGNALS = [
  { key: 'foreclosure', points: 25, test: p => p.foreclosure_flag === 1, evidence: () => 'County tax bill foreclosure flag is set' },
  { key: 'tax_delinquent', points: 20, test: p => p.tax_delinquent_amount > 0, evidence: p => `Tax delinquency $${Math.round(p.tax_delinquent_amount)}` },
  { key: 'tax_delinquent_large', points: 10, test: p => p.tax_delinquent_amount >= 5000, evidence: () => 'Delinquency is $5,000 or more' },
  { key: 'recent_violations', points: p => Math.min(15, 5 * p.violations_6mo), test: p => p.violations_6mo > 0, evidence: p => `${p.violations_6mo} building code violation(s) in last 6 months` },
  { key: 'violation_history', points: 5, test: p => p.violations_total >= 3, evidence: p => `${p.violations_total} code violations all-time` },
  { key: 'vacant', points: 15, test: p => p.survey_category === 'Vacant Structure', evidence: () => 'City 2022 survey: vacant structure' },
  { key: 'poor_condition', points: p => (p.condition_grade === 'F' ? 15 : 10), test: p => ['D', 'F'].includes(p.condition_grade), evidence: p => `City 2022 survey condition grade ${p.condition_grade}` },
  { key: 'absentee_out_of_state', points: 10, test: p => p.owner_out_of_state === 1, evidence: () => 'Owner mailing address is out of state' },
  { key: 'long_held', points: 5, test: (p, now) => p.last_sale_date && yearsBetween(p.last_sale_date, now) >= 20, evidence: p => `Last transfer ${p.last_sale_date}` },
];

export const QUALIFY_SCORE = 40;

const yearsBetween = (iso, now) => (now - new Date(iso)) / (365.25 * 864e5);

export function scoreProperty(p, now = new Date()) {
  const breakdown = [];
  for (const s of SIGNALS) {
    if (!s.test(p, now)) continue;
    const points = typeof s.points === 'function' ? s.points(p) : s.points;
    breakdown.push({ signal: s.key, points, evidence: s.evidence(p) });
  }
  return { score: Math.min(100, breakdown.reduce((a, b) => a + b.points, 0)), breakdown };
}

// ---------------------------------------------------------------- economics
// ASSUMPTION: rehab cost per sq ft by county condition grade. Rough, conservative, editable.
export const REPAIR_PER_SQFT = { A: 10, B: 20, C: 35, D: 50, F: 65 };
export const DEFAULT_REPAIR_PER_SQFT = 40;
export const BUYER_MAO_RATIO = 0.70; // ASSUMPTION: common cash-buyer rule of thumb

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round500 = n => Math.round(n / 500) * 500;

/** ARV from county sales: renovated-condition comps preferred. Returns null when evidence is too thin. */
export function estimateArv(subject, comps) {
  if (!subject.living_sqft) return null;
  const near = comps.filter(c => c.parcel_id !== subject.parcel_id && c.living_sqft > 0 && c.sale_amount >= 10000
    && c.sale_amount / c.living_sqft >= 10 && c.sale_amount / c.living_sqft <= 400 // outside this band is a data error or non-market sale
    && Math.abs(c.living_sqft - subject.living_sqft) / subject.living_sqft <= 0.3
    && (!subject.units || !c.units || c.units === subject.units));
  const pool = near.filter(c => c.neighborhood && c.neighborhood === subject.neighborhood);
  const scope = pool.length >= 3 ? pool : near.filter(c => c.zip === subject.zip);
  const good = scope.filter(c => c.condition_grade === 'A' || c.condition_grade === 'B');
  const used = good.length >= 3 ? good : scope;
  if (used.length < 3) return null;
  const ppsf = median(used.map(c => c.sale_amount / c.living_sqft));
  const confidence = good.length >= 6 && scope === pool ? 'MEDIUM' : 'LOW'; // never HIGH without a human-pulled comp set
  return { arv: round500(ppsf * subject.living_sqft), comps: used.length, basis: good.length >= 3 ? 'A/B-grade sales' : 'all sales', scope: scope === pool ? 'neighborhood' : 'zip', confidence };
}

export function underwrite(subject, comps, { feeLow = 5000, feeHigh = 15000 } = {}) {
  const a = estimateArv(subject, comps);
  const perSqft = REPAIR_PER_SQFT[subject.condition_grade] ?? DEFAULT_REPAIR_PER_SQFT;
  const repairs = subject.living_sqft ? round500(perSqft * subject.living_sqft) : null;
  if (!a || repairs == null) return { est_arv: a?.arv ?? null, arv_comps: a?.comps ?? 0, arv_confidence: a ? a.confidence : 'NONE', est_repairs: repairs, mao: null, offer_low: null, offer_high: null, spread_low: null, spread_high: null, economics_flag: 'DATA_INSUFFICIENT', arv_basis: a };
  const mao = round500(a.arv * BUYER_MAO_RATIO - repairs);
  const offerHigh = mao - feeLow, offerLow = mao - feeHigh;
  const stretched = subject.county_market_value > 0 && a.arv > 3 * subject.county_market_value; // county value lags, but 3x means check the comps by hand
  const flag = offerHigh <= 5000 ? 'BAD_NUMBERS' : stretched ? 'VERIFY_ARV' : offerLow <= 5000 ? 'THIN' : 'OK';
  return { est_arv: a.arv, arv_comps: a.comps, arv_confidence: a.confidence, est_repairs: repairs, mao,
    offer_low: Math.max(0, offerLow), offer_high: Math.max(0, offerHigh), spread_low: feeLow, spread_high: feeHigh, economics_flag: flag, arv_basis: a };
}

export function buyerProfile(p) {
  if (p.condition_grade === 'F' || p.survey_category === 'Vacant Structure') return 'Heavy-rehab flipper or builder';
  if (p.condition_grade === 'D') return 'Fix-and-flip or BRRRR investor';
  if (p.units >= 2) return 'Buy-and-hold landlord (multi-unit)';
  return 'Buy-and-hold landlord or light-rehab flipper';
}

// ----------------------------------------------------------------- matching

const TYPE_OF = p => (p.units >= 3 ? 'multi' : p.units === 2 ? 'duplex' : 'sfr');

export function matchScore(p, b) {
  const c = b.criteria ?? {}, reasons = [], blockers = [];
  if (b.do_not_contact) blockers.push('Buyer asked not to be contacted');
  if (b.criteria_status === 'UNKNOWN') blockers.push('Buyer has no stated criteria yet');
  let score = 0;
  const hood = (p.neighborhood ?? '').toLowerCase(), city = (p.city ?? '').toLowerCase();
  if (c.zips?.includes(p.zip)) { score += 35; reasons.push(`Zip ${p.zip} in stated zips`); }
  else if (c.areas?.some(a => a.toLowerCase() === hood)) { score += 35; reasons.push(`Neighborhood ${p.neighborhood} in stated areas`); }
  else if (c.areas?.some(a => a.toLowerCase() === city)) { score += 25; reasons.push(`City ${p.city} in stated areas`); }
  else if (c.zips?.length || c.areas?.length) blockers.push('Outside stated area');
  const price = p.offer_high ?? p.asking_price;
  if (price != null && (c.min_price != null || c.max_price != null)) {
    if ((c.min_price == null || price >= c.min_price) && (c.max_price == null || price <= c.max_price)) { score += 30; reasons.push(`Price ~$${price} within stated range`); }
    else blockers.push('Price outside stated range');
  } else if (price != null) { score += 10; reasons.push('No stated price range (price fit unknown)'); }
  const t = TYPE_OF(p);
  if (c.property_types?.length) {
    if (c.property_types.includes(t)) { score += 20; reasons.push(`Type ${t} matches`); } else blockers.push(`Type ${t} not in stated types`);
  }
  if (c.max_repairs != null && p.est_repairs != null) {
    if (p.est_repairs <= c.max_repairs) { score += 15; reasons.push('Estimated repairs within tolerance'); } else blockers.push('Estimated repairs exceed tolerance');
  } else if (c.rehab_ok && ['D', 'F'].includes(p.condition_grade)) { score += 15; reasons.push('Buyer states they take heavy rehab'); }
  return { score: blockers.length ? Math.min(score, 30) : score, reasons, blockers };
}

// ------------------------------------------------------------------ capture
// Parse text a human copied from a public post or website into stated buying criteria.

const CLEVELAND_AREAS = ['Cleveland', 'Lakewood', 'Parma', 'Euclid', 'East Cleveland', 'Garfield Heights', 'Maple Heights',
  'Cleveland Heights', 'Shaker Heights', 'South Euclid', 'Bedford', 'Warrensville Heights', 'Slavic Village', 'Collinwood',
  'Glenville', 'Old Brooklyn', 'West Park', 'Detroit Shoreway', 'Clark-Fulton', 'Stockyards', 'Mount Pleasant', 'Lee-Harvard', 'Union-Miles', 'Cuyahoga'];

const money = (n, k) => Number(n.replace(/,/g, '')) * (/k/i.test(k ?? '') ? 1000 : 1);

export function parseBuyerText(text) {
  const t = String(text ?? '');
  const criteria = {}, signals = [];
  const zips = [...new Set(t.match(/\b4[34]\d{3}\b/g) ?? [])];
  if (zips.length) criteria.zips = zips;
  const areas = CLEVELAND_AREAS.filter(a => new RegExp(`\\b${a}\\b`, 'i').test(t));
  if (areas.length) criteria.areas = areas;
  const range = t.match(/\$?\s?([\d,.]+)\s?(k)?\s?(?:-|to|and)\s?\$?\s?([\d,.]+)\s?(k)?/i);
  const under = t.match(/(?:under|below|max(?:imum)?|up to|less than)\s?\$\s?([\d,.]+)\s?(k)?/i);
  const over = t.match(/(?:over|above|min(?:imum)?|at least)\s?\$\s?([\d,.]+)\s?(k)?/i);
  if (range && /\$|k\b/i.test(range[0])) { criteria.min_price = money(range[1], range[2] ?? range[4]); criteria.max_price = money(range[3], range[4]); }
  if (under) criteria.max_price = money(under[1], under[2]);
  if (over) criteria.min_price = money(over[1], over[2]);
  const types = [];
  if (/single[- ]family|\bsfr\b|\bsfh\b/i.test(t)) types.push('sfr');
  if (/duplex|two[- ]family|2[- ]family|doubles?\b/i.test(t)) types.push('duplex');
  if (/triplex|multi[- ]?family|apartments?|3[- ]family|fourplex|quad/i.test(t)) types.push('multi');
  if (/\b(houses|homes)\b/i.test(t) && !types.length) types.push('sfr');
  if (types.length) criteria.property_types = types;
  if (/as[- ]is|any condition|heavy rehab|full gut|fixer|distressed|needs work/i.test(t)) criteria.rehab_ok = true;
  const strategies = [];
  if (/flip/i.test(t)) strategies.push('flip');
  if (/rental|buy[- ]and[- ]hold|brrrr|cash[- ]?flow/i.test(t)) strategies.push('rental');
  if (/novation/i.test(t)) strategies.push('novation');
  if (/sub[- ]?to|subject[- ]to|creative/i.test(t)) strategies.push('creative');
  if (strategies.length) criteria.strategies = strategies;
  let role = 'investor';
  if (/i have buyers|my buyers|buyers list|jv|assign|wholesal/i.test(t)) role = 'wholesaler';
  else if (/cash buyer|i buy|we buy|buying|looking for (deals|properties|houses)/i.test(t)) role = 'cash_buyer';
  if (/\bcash\b/i.test(t)) signals.push('mentions cash');
  const stated = Object.keys(criteria).length > 0;
  return { role, criteria, criteria_status: stated ? 'STATED' : 'UNKNOWN', signals };
}

// ----------------------------------------------------------------- pipeline

export const STAGES = {
  deal: ['LEAD', 'QUALIFIED', 'CONTACTED', 'RESPONDED', 'INTERESTED', 'PROPERTY_ANALYSIS', 'OFFER_DISCUSSION', 'CONTRACT_REVIEW', 'BUYER_MATCH', 'CLOSING', 'REVENUE'],
  client: ['LEAD', 'QUALIFIED', 'CONTACTED', 'RESPONDED', 'INTERESTED', 'SAMPLE_SENT', 'PRICING', 'AGREEMENT', 'INVOICED', 'REVENUE'],
};
export const FAILURES = ['INVALID', 'NO_RESPONSE', 'NOT_INTERESTED', 'BAD_NUMBERS', 'DUPLICATE', 'BUYER_UNAVAILABLE', 'LEGAL_ISSUE', 'DATA_INSUFFICIENT'];

export function checkTransition(opp, to, { trackBReady = false } = {}) {
  if (FAILURES.includes(to)) return { ok: true };
  const stages = STAGES[opp.track];
  if (!stages?.includes(to)) return { ok: false, reason: `Unknown stage ${to} for ${opp.track} track` };
  if (opp.track === 'deal') {
    const i = stages.indexOf(to);
    if (i >= stages.indexOf('OFFER_DISCUSSION') && !trackBReady)
      return { ok: false, reason: 'Track B prerequisites not met (US entity, EMD funds, attorney-reviewed Ohio contract). See Settings.' };
    if (i >= stages.indexOf('BUYER_MATCH') && !(opp.contract_signed && opp.seller_disclosure && opp.professional_review))
      return { ok: false, reason: 'Cannot market to buyers without a signed contract, Ohio SB 155 seller disclosure, and professional review. Marketing a property you do not control is unlicensed-brokerage risk.' };
  }
  if (to === 'REVENUE' && !(opp.actual_fee > 0)) return { ok: false, reason: 'Record the actual amount received before marking REVENUE.' };
  return { ok: true };
}
