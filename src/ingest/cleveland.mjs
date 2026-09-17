// Pull distressed 1-3 family parcels and recent sales (comps) from the City of Cleveland
// "Property Insights" public dataset (county auditor + city code enforcement + survey data).
// Public ArcGIS REST API, no key, no scraping of any site that prohibits it.
import { open, run, tx, audit } from '../db.mjs';
import { propertyKey } from '../lib/core.mjs';
import { upsertProperty, analyzeAll } from '../app.mjs';

export const SOURCE = 'City of Cleveland Property Insights (Cuyahoga County auditor + city records), ArcGIS public API';
export const BASE = 'https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Parcel_Analytics_(PUBLIC_DRAFT_)/FeatureServer/0';

const RES = `tax_luc IN ('5100','5200','5300') AND isCityOwned=0 AND isCityLandBank=0 AND isCountyLandBank=0`;
const DISTRESS = `(isTaxDelinquent=1 OR foreclosure_flag=1 OR numBuildingCodeViolationsLast6Mo>0 OR Survey2022_Category='Vacant Structure' OR Survey2022_Grade IN ('D','F'))`;
const UNITS = { 5100: 1, 5200: 2, 5300: 3 };
const date = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

async function page(where, fields, offset, size = 2000) {
  const q = new URLSearchParams({ where, outFields: fields, returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: offset, resultRecordCount: size, f: 'json' });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${BASE}/query?${q}`, { headers: { 'User-Agent': 'deal-desk/0.1 (public records research)' } });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

async function* rows(where, fields, limit = Infinity) {
  let offset = 0, n = 0;
  while (n < limit) {
    const j = await page(where, fields, offset);
    for (const f of j.features ?? []) { if (n++ >= limit) return; yield f.attributes; }
    if (!j.exceededTransferLimit && (j.features?.length ?? 0) < 2000) return;
    offset += j.features.length;
  }
}

const PROP_FIELDS = ['parcelpin', 'parcelpinDashed', 'std_property_address', 'par_addr_all', 'parcel_city', 'parcel_zip', 'tax_luc', 'tax_luc_description',
  'total_res_rooms', 'total_res_liv_area', 'parcel_sqft', 'residentialYearBuilt', 'Neighborhood', 'Latitude', 'Longitude', 'effectiveOwner',
  'std_tax_mailing_address', 'isOutOfStateOwner', 'isCorporateOwner', 'ownersTotalParcels', 'last_transfer_date', 'last_sales_amount',
  'tax_market_total', 'taxDelinquencyAmount', 'isTaxDelinquent', 'foreclosure_flag', 'numBuildingCodeViolations', 'numBuildingCodeViolationsLast6Mo',
  'lastBuildingCodeViolationDate', 'Survey2022_Category', 'Survey2022_Grade', 'Survey2022_PhotoLink', 'myPlaceLink', 'taxbill_update_date'].join(',');

export function mapParcel(a) {
  const asOf = date(a.taxbill_update_date) ?? new Date().toISOString().slice(0, 10);
  const v = src => ({ status: 'VERIFIED', source: src, as_of: asOf });
  const county = v('Cuyahoga County auditor via City of Cleveland Property Insights');
  const city = v('City of Cleveland records via Property Insights');
  const zip = a.parcel_zip ? String(a.parcel_zip).replace(/\.0$/, '').slice(0, 5) : null;
  return {
    parcel_id: a.parcelpin, address: (a.std_property_address ?? a.par_addr_all ?? '').replace(/\s+(CLEVELAND|OH)\b.*$/i, '').trim() || a.par_addr_all || `PARCEL ${a.parcelpinDashed ?? a.parcelpin}`,
    city: 'Cleveland', state: 'OH', zip, market: 'Cleveland, OH',
    property_type: a.tax_luc_description, units: UNITS[a.tax_luc] ?? null, rooms: a.total_res_rooms || null,
    living_sqft: a.total_res_liv_area || null, lot_sqft: a.parcel_sqft ? Math.round(a.parcel_sqft) : null, year_built: a.residentialYearBuilt || null,
    neighborhood: a.Neighborhood, lat: a.Latitude, lon: a.Longitude,
    owner_name: a.effectiveOwner, owner_mailing: a.std_tax_mailing_address, owner_out_of_state: a.isOutOfStateOwner ? 1 : 0,
    owner_corporate: a.isCorporateOwner ? 1 : 0, owner_parcel_count: a.ownersTotalParcels,
    last_sale_date: date(a.last_transfer_date), last_sale_amount: a.last_sales_amount, county_market_value: a.tax_market_total,
    tax_delinquent_amount: a.taxDelinquencyAmount ?? 0, foreclosure_flag: a.foreclosure_flag === 1 ? 1 : 0,
    violations_total: a.numBuildingCodeViolations ?? 0, violations_6mo: a.numBuildingCodeViolationsLast6Mo ?? 0,
    last_violation_date: date(a.lastBuildingCodeViolationDate), survey_category: a.Survey2022_Category, condition_grade: a.Survey2022_Grade === 'N/A' ? null : a.Survey2022_Grade,
    photo_url: a.Survey2022_PhotoLink, record_url: a.myPlaceLink, listing_status: null, asking_price: null,
    source: SOURCE, source_url: BASE, last_verified: asOf,
    provenance: {
      address: county, zip: county, units: county, living_sqft: county, year_built: county, owner_name: county, owner_mailing: county,
      last_sale_date: county, last_sale_amount: county, county_market_value: county, tax_delinquent_amount: county, foreclosure_flag: county,
      violations_total: city, violations_6mo: city, survey_category: { ...city, source: 'City of Cleveland 2022 property survey (may be outdated)' },
      condition_grade: { ...city, source: 'City of Cleveland 2022 property survey (may be outdated)' },
    },
  };
}

export async function ingest(db, { limit = Infinity, log = console.log } = {}) {
  const started = new Date().toISOString();
  const runId = Number(run(db, `INSERT INTO runs (kind, started_at) VALUES ('ingest_cleveland', ?)`, started).lastInsertRowid);
  try {
    const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
    const compStmt = db.prepare(`INSERT INTO comps (parcel_id, neighborhood, zip, units, living_sqft, sale_date, sale_amount, condition_grade, year_built, fetched_at)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(parcel_id) DO UPDATE SET sale_date=excluded.sale_date, sale_amount=excluded.sale_amount, condition_grade=excluded.condition_grade, fetched_at=excluded.fetched_at`);
    let comps = 0, batch = [];
    const flushComps = () => { tx(db, () => { for (const a of batch) compStmt.run(a.parcelpin, a.Neighborhood, String(a.parcel_zip ?? '').replace(/\.0$/, '').slice(0, 5), UNITS[a.tax_luc] ?? null, a.total_res_liv_area || null, date(a.last_transfer_date), a.last_sales_amount, a.Survey2022_Grade, a.residentialYearBuilt || null); }); comps += batch.length; batch = []; };
    for await (const a of rows(`${RES} AND last_transfer_date > DATE '${since}' AND last_sales_amount > 10000`,
      'parcelpin,Neighborhood,parcel_zip,tax_luc,total_res_liv_area,last_transfer_date,last_sales_amount,Survey2022_Grade,residentialYearBuilt', limit)) {
      batch.push(a); if (batch.length >= 2000) flushComps();
    }
    flushComps();
    // Portfolio deeds record the whole portfolio's price on every parcel. Same date + same amount on 2+ parcels = not a comp.
    const bulk = run(db, `DELETE FROM comps WHERE (sale_date, sale_amount) IN (SELECT sale_date, sale_amount FROM comps GROUP BY 1,2 HAVING COUNT(*) > 1)`).changes;
    log(`comps: ${comps} (${bulk} bulk-sale rows removed)`);
    let props = 0; batch = [];
    const flushProps = () => { tx(db, () => { for (const a of batch) { const r = mapParcel(a); upsertProperty(db, propertyKey(r), r); } }); props += batch.length; batch = []; };
    for await (const a of rows(`${RES} AND ${DISTRESS}`, PROP_FIELDS, limit)) { batch.push(a); if (batch.length >= 2000) flushProps(); }
    flushProps();
    log(`distressed properties: ${props}`);
    const analysis = analyzeAll(db);
    log(`analyzed: ${analysis.properties}, qualified: ${analysis.qualified}`);
    const stats = { comps, properties: props, ...analysis };
    run(db, `UPDATE runs SET finished_at=?, stats=? WHERE id=?`, new Date().toISOString(), JSON.stringify(stats), runId);
    audit(db, 'system', 'ingest_cleveland', 'runs', runId, stats);
    return stats;
  } catch (e) {
    run(db, `UPDATE runs SET finished_at=?, error=? WHERE id=?`, new Date().toISOString(), String(e.stack ?? e), runId);
    throw e;
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('cleveland.mjs')) {
  const limitArg = process.argv.find(x => x.startsWith('--limit='));
  const db = open();
  ingest(db, { limit: limitArg ? Number(limitArg.split('=')[1]) : Infinity })
    .then(s => { console.log(JSON.stringify(s)); db.close(); })
    .catch(e => { console.error(e); process.exitCode = 1; });
}
