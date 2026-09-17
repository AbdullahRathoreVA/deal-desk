import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { open, all, one, run, audit, getSettings, setSetting, parse, ROOT } from './db.mjs';
import * as app from './app.mjs';
import { TEMPLATES } from './lib/outreach.mjs';
import { parseBuyerText } from './lib/core.mjs';

const db = open();
const PORT = Number(process.env.PORT ?? 4455);
const HOST = '127.0.0.1'; // local only: this database holds owner records

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((ok, bad) => { let s = ''; req.on('data', c => (s += c)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(Object.assign(e, { status: 400 })); } }); });

const SORTS = { score: 'p.score DESC', arv: 'p.est_arv DESC', spread: 'p.offer_high DESC', delinquency: 'p.tax_delinquent_amount DESC', recent: 'p.updated_at DESC' };

const routes = [
  ['GET', /^\/api\/overview$/, () => app.overview(db)],
  ['GET', /^\/api\/today$/, () => app.dailyReport(db)],
  ['GET', /^\/api\/properties$/, (_, q) => {
    const where = ['1=1'], p = [];
    if (q.get('q')) { where.push('(p.address LIKE ? OR p.neighborhood LIKE ? OR p.zip = ? OR p.owner_name LIKE ?)'); const s = `%${q.get('q')}%`; p.push(s, s, q.get('q'), s); }
    if (q.get('min_score')) { where.push('p.score >= ?'); p.push(Number(q.get('min_score'))); }
    if (q.get('stage')) { where.push('o.stage = ?'); p.push(q.get('stage')); }
    if (q.get('flag')) { where.push('p.economics_flag = ?'); p.push(q.get('flag')); }
    const limit = Math.min(500, Number(q.get('limit') ?? 100)), offset = Number(q.get('offset') ?? 0);
    const sql = `FROM properties p LEFT JOIN opportunities o ON o.property_id=p.id AND o.track='deal' WHERE ${where.join(' AND ')}`;
    return {
      total: one(db, `SELECT COUNT(*) n ${sql}`, ...p).n,
      rows: all(db, `SELECT p.id, p.address, p.zip, p.neighborhood, p.units, p.living_sqft, p.year_built, p.condition_grade, p.survey_category, p.score,
        p.tax_delinquent_amount, p.foreclosure_flag, p.violations_6mo, p.owner_out_of_state, p.county_market_value, p.est_arv, p.arv_confidence,
        p.est_repairs, p.mao, p.offer_low, p.offer_high, p.economics_flag, o.id opp_id, o.stage, o.failure ${sql}
        ORDER BY ${SORTS[q.get('sort')] ?? SORTS.score} LIMIT ? OFFSET ?`, ...p, limit, offset),
    };
  }],
  ['GET', /^\/api\/properties\/(\d+)$/, ([id]) => {
    const p = one(db, 'SELECT * FROM properties WHERE id=?', id);
    if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
    return { ...p, score_breakdown: parse(p.score_breakdown, []), provenance: parse(p.provenance, {}),
      opportunity: one(db, `SELECT * FROM opportunities WHERE property_id=? AND track='deal'`, id),
      matches: all(db, 'SELECT m.*, b.company, b.name FROM matches m JOIN buyers b ON b.id=m.buyer_id WHERE property_id=? ORDER BY score DESC', id),
      outreach: all(db, 'SELECT id, template, status, recipient, created_at FROM outreach WHERE property_id=?', id) };
  }],
  ['GET', /^\/api\/opportunities$/, (_, q) => all(db, `SELECT o.*, p.address, p.neighborhood, p.score pscore, p.offer_high, b.company, b.name
    FROM opportunities o LEFT JOIN properties p ON p.id=o.property_id LEFT JOIN buyers b ON b.id=o.buyer_id
    WHERE (? IS NULL OR o.track=?) AND ${q.get('active') ? "(o.stage NOT IN ('LEAD','QUALIFIED') OR o.track='client')" : '1=1'}
    ORDER BY o.updated_at DESC LIMIT 300`, q.get('track'), q.get('track'))],
  ['POST', /^\/api\/opportunities\/(\d+)\/stage$/, async ([id], _, req) => (app.moveOpportunity(db, id, await body(req)), { ok: true })],
  ['PATCH', /^\/api\/opportunities\/(\d+)$/, async ([id], _, req) => (app.updateOpportunity(db, id, await body(req)), { ok: true })],
  ['GET', /^\/api\/buyers$/, () => all(db, 'SELECT * FROM buyers ORDER BY id DESC').map(app.hydrateBuyer)],
  ['POST', /^\/api\/buyers$/, async (_, __, req) => ({ id: app.saveBuyer(db, await body(req)) })],
  ['PATCH', /^\/api\/buyers\/(\d+)$/, async ([id], _, req) => { const b = await body(req); for (const k of ['verification', 'do_not_contact', 'role', 'notes']) if (k in b) run(db, `UPDATE buyers SET ${k}=? WHERE id=?`, b[k], id); audit(db, 'user', 'update_buyer', 'buyers', id, b); return { ok: true }; }],
  ['POST', /^\/api\/capture\/preview$/, async (_, __, req) => parseBuyerText((await body(req)).text)],
  ['POST', /^\/api\/match\/run$/, () => app.runMatching(db)],
  ['GET', /^\/api\/matches$/, () => all(db, `SELECT m.*, p.address, p.neighborhood, b.company, b.name FROM matches m JOIN properties p ON p.id=m.property_id JOIN buyers b ON b.id=m.buyer_id ORDER BY m.score DESC LIMIT 200`)],
  ['GET', /^\/api\/templates$/, () => Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, audience: t.audience, channel: t.channel, objective: t.objective }))],
  ['POST', /^\/api\/outreach\/draft$/, async (_, __, req) => ({ id: app.draftOutreach(db, await body(req)) })],
  ['GET', /^\/api\/outreach$/, (_, q) => all(db, `SELECT * FROM outreach WHERE (? IS NULL OR status=?) ORDER BY id DESC LIMIT 300`, q.get('status'), q.get('status'))
    .map(m => ({ ...m, risk_flags: parse(m.risk_flags, []), facts_used: parse(m.facts_used, {}) }))],
  ['POST', /^\/api\/outreach\/(\d+)\/review$/, async ([id], _, req) => (app.reviewOutreach(db, id, await body(req)), { ok: true })],
  ['POST', /^\/api\/outreach\/(\d+)\/sent$/, ([id]) => (app.markSent(db, id), { ok: true })],
  ['POST', /^\/api\/outreach\/(\d+)\/response$/, async ([id], _, req) => (app.logResponse(db, id, await body(req)), { ok: true })],
  ['GET', /^\/api\/tasks$/, () => all(db, `SELECT * FROM tasks ORDER BY status='OPEN' DESC, kind='human' DESC, due_at`)],
  ['POST', /^\/api\/tasks$/, async (_, __, req) => { const t = await body(req); return { id: Number(run(db, 'INSERT INTO tasks (kind, title, detail, due_at) VALUES (?,?,?,?)', t.kind ?? 'human', t.title, t.detail ?? null, t.due_at ?? null).lastInsertRowid) }; }],
  ['POST', /^\/api\/tasks\/(\d+)\/done$/, ([id]) => { run(db, `UPDATE tasks SET status='DONE', done_at=datetime('now') WHERE id=?`, id); audit(db, 'user', 'task_done', 'tasks', id); return { ok: true }; }],
  ['GET', /^\/api\/money$/, () => all(db, 'SELECT * FROM money ORDER BY date DESC')],
  ['POST', /^\/api\/money$/, async (_, __, req) => { const m = await body(req); const id = Number(run(db, 'INSERT INTO money (date, kind, category, amount, status, opportunity_id, note) VALUES (?,?,?,?,?,?,?)', m.date ?? app.today(), m.kind, m.category, Number(m.amount), m.status, m.opportunity_id ?? null, m.note ?? null).lastInsertRowid); audit(db, 'user', 'money', 'money', id, m); return { id }; }],
  ['GET', /^\/api\/evidence$/, () => all(db, 'SELECT * FROM evidence ORDER BY topic, label')],
  ['GET', /^\/api\/settings$/, () => getSettings(db)],
  ['PUT', /^\/api\/settings$/, async (_, __, req) => { const s = await body(req); for (const [k, v] of Object.entries(s)) setSetting(db, k, v); audit(db, 'user', 'settings', null, null, Object.keys(s)); return { ...getSettings(db), redrafted: app.redraftMissing(db) }; }],
  ['GET', /^\/api\/audit$/, () => all(db, 'SELECT * FROM audit ORDER BY id DESC LIMIT 200')],
];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, fn] of routes) {
        const m = req.method === method && url.pathname.match(re);
        if (m) return json(res, 200, await fn(m.slice(1), url.searchParams, req));
      }
      return json(res, 404, { error: 'No such route' });
    }
    const file = resolve(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (!file.startsWith(resolve(ROOT, 'public'))) return json(res, 403, { error: 'Forbidden' });
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    json(res, e.status ?? (e.code === 'ENOENT' ? 404 : 500), { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`Deal Desk on http://${HOST}:${PORT}`));
