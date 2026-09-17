import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  parcel_id TEXT, address TEXT NOT NULL, city TEXT, state TEXT, zip TEXT, market TEXT NOT NULL,
  property_type TEXT, units INTEGER, rooms INTEGER, beds INTEGER, baths REAL,
  living_sqft INTEGER, lot_sqft INTEGER, year_built INTEGER, neighborhood TEXT, lat REAL, lon REAL,
  owner_name TEXT, owner_mailing TEXT, owner_out_of_state INTEGER, owner_corporate INTEGER, owner_parcel_count INTEGER,
  last_sale_date TEXT, last_sale_amount REAL, county_market_value REAL,
  tax_delinquent_amount REAL, foreclosure_flag INTEGER, violations_total INTEGER, violations_6mo INTEGER,
  last_violation_date TEXT, survey_category TEXT, condition_grade TEXT, photo_url TEXT, record_url TEXT,
  listing_status TEXT, asking_price REAL,
  est_arv REAL, arv_comps INTEGER, arv_confidence TEXT, est_repairs REAL, mao REAL,
  offer_low REAL, offer_high REAL, spread_low REAL, spread_high REAL, economics_flag TEXT, buyer_profile TEXT,
  score INTEGER NOT NULL DEFAULT 0, score_breakdown TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL, source_url TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_verified TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_prop_score ON properties(score DESC);

CREATE TABLE IF NOT EXISTS comps (
  parcel_id TEXT PRIMARY KEY, neighborhood TEXT, zip TEXT, units INTEGER, living_sqft INTEGER,
  sale_date TEXT, sale_amount REAL, condition_grade TEXT, year_built INTEGER, fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_comps_hood ON comps(neighborhood);

CREATE TABLE IF NOT EXISTS buyers (
  id INTEGER PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE,
  name TEXT, company TEXT, role TEXT NOT NULL, market TEXT,
  contact_method TEXT, contact_value TEXT, website TEXT,
  criteria TEXT NOT NULL DEFAULT '{}', criteria_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  source TEXT NOT NULL, source_url TEXT, discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  verification TEXT NOT NULL DEFAULT 'unverified', do_not_contact INTEGER NOT NULL DEFAULT 0, notes TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY, opp_key TEXT NOT NULL UNIQUE, track TEXT NOT NULL,
  property_id INTEGER REFERENCES properties(id), buyer_id INTEGER REFERENCES buyers(id),
  stage TEXT NOT NULL DEFAULT 'LEAD', failure TEXT, score INTEGER NOT NULL DEFAULT 0,
  missing TEXT NOT NULL DEFAULT '[]', next_action TEXT, next_action_at TEXT,
  contract_signed INTEGER NOT NULL DEFAULT 0, seller_disclosure INTEGER NOT NULL DEFAULT 0,
  professional_review INTEGER NOT NULL DEFAULT 0,
  contract_price REAL, expected_fee REAL, actual_fee REAL, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id),
  buyer_id INTEGER NOT NULL REFERENCES buyers(id), score INTEGER NOT NULL,
  reasons TEXT NOT NULL, blockers TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(property_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY, template TEXT NOT NULL, audience TEXT NOT NULL, channel TEXT NOT NULL,
  buyer_id INTEGER REFERENCES buyers(id), property_id INTEGER REFERENCES properties(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  recipient TEXT NOT NULL, subject TEXT, body TEXT NOT NULL,
  why_selected TEXT NOT NULL, facts_used TEXT NOT NULL, objective TEXT NOT NULL,
  risk_flags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT, sent_at TEXT,
  responded_at TEXT, response TEXT, follow_up_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
  due_at TEXT, status TEXT NOT NULL DEFAULT 'OPEN', entity TEXT, entity_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT
);

CREATE TABLE IF NOT EXISTS money (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('revenue','expense')),
  category TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL CHECK (status IN ('expected','actual')),
  opportunity_id INTEGER REFERENCES opportunities(id), note TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY, topic TEXT NOT NULL, claim TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL CHECK (label IN ('FACT','SOURCE','ESTIMATE','ASSUMPTION','UNKNOWN')),
  source_title TEXT, url TEXT, accessed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  stats TEXT, error TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT
);
`;

export function open(file = process.env.DEALDESK_DB ?? resolve(ROOT, 'data/dealdesk.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export const all = (db, sql, ...p) => db.prepare(sql).all(...p);
export const one = (db, sql, ...p) => db.prepare(sql).get(...p);
export const run = (db, sql, ...p) => db.prepare(sql).run(...p);

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function audit(db, actor, action, entity = null, entityId = null, detail = null) {
  run(db, 'INSERT INTO audit (actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?)',
    actor, action, entity, entityId == null ? null : Number(entityId), detail == null ? null : JSON.stringify(detail));
}

export function getSettings(db) {
  return Object.fromEntries(all(db, 'SELECT key, value FROM settings').map(r => [r.key, r.value]));
}

export function setSetting(db, key, value) {
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value == null ? null : String(value));
}

export const parse = (s, fallback) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };
