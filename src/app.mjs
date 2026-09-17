// Application services shared by the HTTP server, CLI, ingest and daily report.
import { all, one, run, tx, audit, getSettings, parse } from './db.mjs';
import { scoreProperty, underwrite, buyerProfile, matchScore, checkTransition, QUALIFY_SCORE, STAGES, FAILURES, buyerKey, parseBuyerText } from './lib/core.mjs';
import { TEMPLATES, riskFlags, hasMissing, missingKeys } from './lib/outreach.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const usd = n => (n == null ? 'UNKNOWN' : '$' + Math.round(n).toLocaleString('en-US'));

export const hydrateBuyer = b => b && { ...b, criteria: parse(b.criteria, {}) };

// ------------------------------------------------------------- properties

const PROP_COLS = ['parcel_id', 'address', 'city', 'state', 'zip', 'market', 'property_type', 'units', 'rooms', 'beds', 'baths',
  'living_sqft', 'lot_sqft', 'year_built', 'neighborhood', 'lat', 'lon', 'owner_name', 'owner_mailing', 'owner_out_of_state',
  'owner_corporate', 'owner_parcel_count', 'last_sale_date', 'last_sale_amount', 'county_market_value', 'tax_delinquent_amount',
  'foreclosure_flag', 'violations_total', 'violations_6mo', 'last_violation_date', 'survey_category', 'condition_grade',
  'photo_url', 'record_url', 'listing_status', 'asking_price', 'provenance', 'source', 'source_url', 'last_verified'];

export function upsertProperty(db, key, rec) {
  const vals = PROP_COLS.map(c => (c === 'provenance' ? JSON.stringify(rec.provenance ?? {}) : rec[c] ?? null));
  run(db, `INSERT INTO properties (dedupe_key, ${PROP_COLS.join(',')}, updated_at) VALUES (?, ${PROP_COLS.map(() => '?').join(',')}, datetime('now'))
    ON CONFLICT(dedupe_key) DO UPDATE SET ${PROP_COLS.map(c => `${c}=excluded.${c}`).join(',')}, updated_at=datetime('now')`, key, ...vals);
  return one(db, 'SELECT id FROM properties WHERE dedupe_key = ?', key).id;
}

/** Re-score and re-underwrite every property; open/refresh a deal-track opportunity for each. */
export function analyzeAll(db, { now = new Date() } = {}) {
  const s = getSettings(db);
  const fees = { feeLow: Number(s.fee_target_low ?? 5000), feeHigh: Number(s.fee_target_high ?? 15000) };
  const byHood = new Map(), byZip = new Map();
  for (const c of all(db, 'SELECT * FROM comps')) {
    (byHood.get(c.neighborhood) ?? byHood.set(c.neighborhood, []).get(c.neighborhood)).push(c);
    (byZip.get(c.zip) ?? byZip.set(c.zip, []).get(c.zip)).push(c);
  }
  const props = all(db, 'SELECT * FROM properties');
  const upd = db.prepare(`UPDATE properties SET score=?, score_breakdown=?, est_arv=?, arv_comps=?, arv_confidence=?, est_repairs=?, mao=?,
    offer_low=?, offer_high=?, spread_low=?, spread_high=?, economics_flag=?, buyer_profile=?, provenance=? WHERE id=?`);
  const opp = db.prepare(`INSERT INTO opportunities (opp_key, track, property_id, stage, score, missing, failure) VALUES ('deal:p:' || ?, 'deal', ?, ?, ?, ?, ?)
    ON CONFLICT(opp_key) DO UPDATE SET score=excluded.score, missing=excluded.missing,
      stage=CASE WHEN opportunities.stage IN ('LEAD','QUALIFIED') THEN excluded.stage ELSE opportunities.stage END,
      failure=CASE WHEN opportunities.stage IN ('LEAD','QUALIFIED') THEN excluded.failure ELSE opportunities.failure END,
      updated_at=datetime('now')`);
  let qualified = 0;
  tx(db, () => {
    for (const p of props) {
      const { score, breakdown } = scoreProperty(p, now);
      const comps = [...(byHood.get(p.neighborhood) ?? []), ...(byZip.get(p.zip) ?? [])];
      const u = underwrite(p, [...new Map(comps.map(c => [c.parcel_id, c])).values()], fees);
      const prov = parse(p.provenance, {});
      const asOf = today();
      for (const f of ['est_arv', 'est_repairs', 'mao', 'offer_low', 'offer_high'])
        prov[f] = u[f] == null ? { status: 'UNKNOWN', source: 'insufficient comps or sq ft', as_of: asOf }
          : { status: 'ESTIMATED', source: f === 'est_arv' ? `median $/sqft of ${u.arv_comps} ${u.arv_basis?.basis} (${u.arv_basis?.scope}), county sales last 24 mo` : f === 'est_repairs' ? `rule of thumb by condition grade ${p.condition_grade ?? '?'}` : '70% rule minus repairs minus target fee', as_of: asOf };
      for (const f of ['beds', 'baths', 'asking_price', 'listing_status']) if (p[f] == null) prov[f] ??= { status: 'UNKNOWN', source: 'not in county dataset', as_of: asOf };
      upd.run(score, JSON.stringify(breakdown), u.est_arv, u.arv_comps, u.arv_confidence, u.est_repairs, u.mao, u.offer_low, u.offer_high,
        u.spread_low, u.spread_high, u.economics_flag, buyerProfile(p), JSON.stringify(prov), p.id);
      const missing = Object.entries(prov).filter(([, v]) => v.status === 'UNKNOWN').map(([k]) => k);
      const q = score >= QUALIFY_SCORE && ['OK', 'THIN'].includes(u.economics_flag);
      if (q) qualified++;
      const failure = score >= QUALIFY_SCORE && !q ? u.economics_flag : null;
      opp.run(p.id, p.id, q ? 'QUALIFIED' : 'LEAD', score, JSON.stringify(missing), failure);
    }
  });
  audit(db, 'system', 'analyze_all', 'properties', null, { properties: props.length, qualified });
  return { properties: props.length, qualified };
}

// ----------------------------------------------------------------- buyers

export function saveBuyer(db, input, actor = 'user') {
  let { criteria, criteria_status, role } = input;
  if (input.text) {
    const parsed = parseBuyerText(input.text);
    criteria = { ...parsed.criteria, ...(criteria ?? {}) };
    criteria_status = parsed.criteria_status;
    role = role || parsed.role;
  }
  const b = { ...input, role: role || 'investor', criteria: criteria ?? {}, criteria_status: criteria_status ?? 'UNKNOWN' };
  const key = buyerKey(b);
  run(db, `INSERT INTO buyers (dedupe_key, name, company, role, market, contact_method, contact_value, website, criteria, criteria_status, source, source_url, verification, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET
    name=COALESCE(excluded.name, buyers.name), company=COALESCE(excluded.company, buyers.company), role=excluded.role,
    criteria=excluded.criteria, criteria_status=excluded.criteria_status, notes=COALESCE(excluded.notes, buyers.notes)`,
    key, b.name ?? null, b.company ?? null, b.role, b.market ?? 'Cleveland, OH', b.contact_method ?? null, b.contact_value ?? null,
    b.website ?? null, JSON.stringify(b.criteria), b.criteria_status, b.source ?? 'manual', b.source_url ?? null, b.verification ?? 'unverified', b.notes ?? null);
  const id = one(db, 'SELECT id FROM buyers WHERE dedupe_key = ?', key).id;
  audit(db, actor, 'save_buyer', 'buyers', id, { key, criteria_status: b.criteria_status });
  return id;
}

// 60+ requires more than city + type: a stated zip/neighborhood, price range or rehab tolerance.
export function runMatching(db, { minScore = 60 } = {}) {
  run(db, `DELETE FROM matches WHERE status = 'PENDING_REVIEW'`);
  const buyers = all(db, `SELECT * FROM buyers WHERE do_not_contact = 0 AND criteria_status != 'UNKNOWN'`).map(hydrateBuyer);
  const props = all(db, `SELECT p.* FROM properties p JOIN opportunities o ON o.property_id = p.id AND o.track = 'deal' WHERE o.stage != 'LEAD' AND o.failure IS NULL`);
  const ins = db.prepare(`INSERT INTO matches (property_id, buyer_id, score, reasons, blockers) VALUES (?,?,?,?,?)
    ON CONFLICT(property_id, buyer_id) DO UPDATE SET score=excluded.score, reasons=excluded.reasons, blockers=excluded.blockers`);
  let n = 0;
  tx(db, () => {
    for (const p of props) for (const b of buyers) {
      const m = matchScore(p, b);
      if (m.score >= minScore) { ins.run(p.id, b.id, m.score, JSON.stringify(m.reasons), JSON.stringify(m.blockers)); n++; }
    }
  });
  audit(db, 'system', 'run_matching', 'matches', null, { buyers: buyers.length, properties: props.length, matches: n });
  return { buyers: buyers.length, properties: props.length, matches: n };
}

// --------------------------------------------------------------- outreach

export function weeklyStats(db) {
  return {
    scanned: one(db, 'SELECT COUNT(*) n FROM properties').n,
    qualified: one(db, `SELECT COUNT(*) n FROM opportunities WHERE track='deal' AND stage != 'LEAD' AND failure IS NULL`).n,
    threshold: QUALIFY_SCORE,
  };
}

export function exampleLine(p) {
  if (!p) return 'none this week';
  const bits = [`${p.units ?? 1}-family in ${p.neighborhood ?? p.city}`];
  if (p.year_built) bits.push(`built ${p.year_built}`);
  const b = parse(p.score_breakdown, []).map(x => x.evidence.toLowerCase());
  return `${bits.join(', ')}; score ${p.score} (${b.join('; ')}). County market value ${usd(p.county_market_value)}; estimated ARV ${usd(p.est_arv)} from ${p.arv_comps} county sales [ESTIMATE].`;
}

export function draftOutreach(db, { template, buyer_id, property_id, opportunity_id, channel, why }) {
  const t = TEMPLATES[template];
  if (!t) throw Object.assign(new Error(`Unknown template ${template}`), { status: 400 });
  const s = getSettings(db);
  const b = buyer_id ? hydrateBuyer(one(db, 'SELECT * FROM buyers WHERE id = ?', buyer_id)) : null;
  const p = property_id ? one(db, 'SELECT * FROM properties WHERE id = ?', property_id) : null;
  const o = opportunity_id ? one(db, 'SELECT * FROM opportunities WHERE id = ?', opportunity_id)
    : p ? one(db, `SELECT * FROM opportunities WHERE track='deal' AND property_id = ?`, p.id) ?? null : null;
  if (['investor', 'wholesaler', 'cash_buyer', 'agent', 'contractor', 'referral_partner'].includes(t.audience) && !b)
    throw Object.assign(new Error('This template needs a buyer/contact'), { status: 400 });
  if (['owner', 'cash_buyer', 'contractor'].includes(t.audience) && !p)
    throw Object.assign(new Error('This template needs a property'), { status: 400 });
  const stats = weeklyStats(db);
  const top = one(db, `SELECT p.* FROM properties p JOIN opportunities o ON o.property_id=p.id AND o.track='deal'
    WHERE o.stage != 'LEAD' AND o.failure IS NULL ORDER BY p.score DESC, p.est_arv DESC LIMIT 1`);
  const example = exampleLine(top);
  const ch = channel ?? (['facebook', 'contact_form'].includes(b?.contact_method) ? b.contact_method : t.channel);
  const { subject, body } = t.render({ b, p, o, s, stats, example, channel: ch });
  const flags = riskFlags({ template, channel: ch, b, p, o, s });
  if (hasMissing(body)) flags.push({ level: 'BLOCK', msg: `Missing facts: ${missingKeys(body).join(', ')}. Fill them in (Settings or record), then re-draft.` });
  const recipient = t.audience === 'owner' ? `${p.owner_name ?? 'Owner'} — ${p.owner_mailing ?? 'mailing address UNKNOWN'}`
    : `${b.company || b.name} — ${b.contact_value ?? b.website ?? 'no contact on file'}`;
  const facts = { stats, example_property_id: top?.id ?? null, buyer: b && { id: b.id, source_url: b.source_url, criteria: b.criteria, criteria_status: b.criteria_status }, property: p && { id: p.id, record_url: p.record_url, score: p.score } };
  const whySel = why ?? (b ? `${b.role} discovered via ${b.source}${b.source_url ? ` (${b.source_url})` : ''}; criteria ${b.criteria_status}.` : `Property score ${p.score}: ${parse(p.score_breakdown, []).map(x => x.evidence).join('; ')}`);
  const r = run(db, `INSERT INTO outreach (template, audience, channel, buyer_id, property_id, opportunity_id, recipient, subject, body, why_selected, facts_used, objective, risk_flags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, template, t.audience, ch, b?.id ?? null, p?.id ?? null, o?.id ?? null, recipient, subject, body, whySel, JSON.stringify(facts), t.objective, JSON.stringify(flags));
  const id = Number(r.lastInsertRowid);
  audit(db, 'system', 'draft_outreach', 'outreach', id, { template, blocks: flags.filter(f => f.level === 'BLOCK').length });
  return id;
}

/** After the sender profile changes, replace drafts that were blocked only by missing facts. */
export function redraftMissing(db) {
  const stale = all(db, `SELECT * FROM outreach WHERE status='DRAFT' AND body LIKE '%{{MISSING:%'`);
  for (const m of stale) {
    run(db, `UPDATE outreach SET status='REJECTED', reviewed_at=datetime('now'), response='superseded by redraft' WHERE id=?`, m.id);
    draftOutreach(db, { template: m.template, buyer_id: m.buyer_id, property_id: m.property_id, opportunity_id: m.opportunity_id, channel: m.channel, why: m.why_selected });
  }
  return stale.length;
}

export function reviewOutreach(db, id, { decision, body, subject }, actor = 'user') {
  const m = one(db, 'SELECT * FROM outreach WHERE id = ?', id);
  if (!m) throw Object.assign(new Error('Not found'), { status: 404 });
  if (m.status !== 'DRAFT') throw Object.assign(new Error(`Already ${m.status}`), { status: 409 });
  const newBody = body ?? m.body;
  if (decision === 'approve') {
    const flags = parse(m.risk_flags, []).filter(f => f.level === 'BLOCK' && !f.msg.startsWith('Missing facts'));
    if (flags.length) throw Object.assign(new Error('Blocked: ' + flags.map(f => f.msg).join(' | ')), { status: 422 });
    if (hasMissing(newBody)) throw Object.assign(new Error('Blocked: message still has missing facts: ' + missingKeys(newBody).join(', ')), { status: 422 });
  }
  run(db, `UPDATE outreach SET status=?, body=?, subject=COALESCE(?, subject), reviewed_at=datetime('now') WHERE id=?`,
    decision === 'approve' ? 'APPROVED' : 'REJECTED', newBody, subject ?? null, id);
  audit(db, actor, `outreach_${decision}`, 'outreach', id, body ? { edited: true } : null);
}

export function markSent(db, id, actor = 'user') {
  const m = one(db, 'SELECT * FROM outreach WHERE id = ?', id);
  if (m?.status !== 'APPROVED') throw Object.assign(new Error('Only APPROVED messages can be marked sent'), { status: 409 });
  const followUp = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  tx(db, () => {
    run(db, `UPDATE outreach SET status='SENT', sent_at=datetime('now'), follow_up_at=? WHERE id=?`, followUp, id);
    if (m.buyer_id && TEMPLATES[m.template].track === 'client') {
      run(db, `INSERT INTO opportunities (opp_key, track, buyer_id, stage) VALUES ('client:b:' || ?, 'client', ?, 'CONTACTED')
        ON CONFLICT(opp_key) DO NOTHING`, m.buyer_id, m.buyer_id);
      run(db, `UPDATE opportunities SET stage='CONTACTED', updated_at=datetime('now') WHERE track='client' AND buyer_id=? AND stage IN ('LEAD','QUALIFIED')`, m.buyer_id);
    }
    run(db, `INSERT INTO tasks (kind, title, detail, due_at, entity, entity_id) VALUES ('follow_up', ?, ?, ?, 'outreach', ?)`,
      `Check reply: ${m.recipient}`, 'If no reply, log NO_RESPONSE. At most one polite follow-up.', followUp, id);
  });
  audit(db, actor, 'outreach_sent', 'outreach', id);
}

export function logResponse(db, id, { text, outcome }, actor = 'user') {
  const m = one(db, 'SELECT * FROM outreach WHERE id = ?', id);
  if (!m) throw Object.assign(new Error('Not found'), { status: 404 });
  const status = outcome === 'no_response' ? 'NO_RESPONSE' : 'RESPONDED';
  run(db, `UPDATE outreach SET status=?, response=?, responded_at=datetime('now') WHERE id=?`, status, text ?? null, id);
  if (m.buyer_id) {
    if (outcome === 'opt_out') run(db, 'UPDATE buyers SET do_not_contact=1 WHERE id=?', m.buyer_id);
    const stage = { interested: 'INTERESTED', responded: 'RESPONDED', not_interested: 'NOT_INTERESTED', opt_out: 'NOT_INTERESTED', no_response: 'NO_RESPONSE' }[outcome] ?? 'RESPONDED';
    run(db, `UPDATE opportunities SET ${FAILURES.includes(stage) ? 'failure' : 'stage'}=?, updated_at=datetime('now') WHERE track='client' AND buyer_id=?`, stage, m.buyer_id);
  }
  run(db, `UPDATE tasks SET status='DONE', done_at=datetime('now') WHERE entity='outreach' AND entity_id=? AND status='OPEN'`, id);
  audit(db, actor, 'outreach_response', 'outreach', id, { outcome });
}

// ----------------------------------------------------------- opportunities

export function moveOpportunity(db, id, { stage, note }, actor = 'user') {
  const o = one(db, 'SELECT * FROM opportunities WHERE id = ?', id);
  if (!o) throw Object.assign(new Error('Not found'), { status: 404 });
  const chk = checkTransition(o, stage, { trackBReady: getSettings(db).track_b_ready === 'true' });
  if (!chk.ok) throw Object.assign(new Error(chk.reason), { status: 422 });
  const isFail = FAILURES.includes(stage);
  tx(db, () => {
    run(db, `UPDATE opportunities SET ${isFail ? 'failure=?' : 'stage=?, failure=NULL'}, notes=COALESCE(?, notes), updated_at=datetime('now') WHERE id=?`, stage, note ?? null, id);
    if (stage === 'REVENUE') run(db, `INSERT INTO money (date, kind, category, amount, status, opportunity_id, note) VALUES (?, 'revenue', ?, ?, 'actual', ?, ?)`,
      today(), o.track === 'deal' ? 'assignment_fee' : 'service_fee', o.actual_fee, id, 'Recorded on REVENUE stage');
  });
  audit(db, actor, 'move_opportunity', 'opportunities', id, { from: o.stage, to: stage, note });
}

export function updateOpportunity(db, id, patch, actor = 'user') {
  const allowed = ['contract_signed', 'seller_disclosure', 'professional_review', 'contract_price', 'expected_fee', 'actual_fee', 'notes', 'next_action', 'next_action_at'];
  const keys = Object.keys(patch).filter(k => allowed.includes(k));
  if (!keys.length) return;
  run(db, `UPDATE opportunities SET ${keys.map(k => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`, ...keys.map(k => patch[k]), id);
  audit(db, actor, 'update_opportunity', 'opportunities', id, patch);
}

// ------------------------------------------------------------------ metrics

export function overview(db) {
  const n = sql => one(db, sql).n ?? 0;
  const revenue = n(`SELECT SUM(amount) n FROM money WHERE kind='revenue' AND status='actual'`);
  const expenses = n(`SELECT SUM(amount) n FROM money WHERE kind='expense' AND status='actual'`);
  const sent = n(`SELECT COUNT(*) n FROM outreach WHERE sent_at IS NOT NULL`);
  const responded = n(`SELECT COUNT(*) n FROM outreach WHERE status='RESPONDED'`);
  const leads = n(`SELECT COUNT(*) n FROM opportunities`);
  const won = n(`SELECT COUNT(*) n FROM opportunities WHERE stage='REVENUE'`);
  return {
    total_leads: leads,
    properties: n('SELECT COUNT(*) n FROM properties'),
    qualified_leads: n(`SELECT COUNT(*) n FROM opportunities WHERE stage != 'LEAD' AND failure IS NULL`),
    buyers: n('SELECT COUNT(*) n FROM buyers'),
    active_conversations: n(`SELECT COUNT(*) n FROM opportunities WHERE failure IS NULL AND stage IN ('RESPONDED','INTERESTED','PROPERTY_ANALYSIS','OFFER_DISCUSSION','SAMPLE_SENT','PRICING','AGREEMENT')`),
    potential_deals: n(`SELECT COUNT(*) n FROM opportunities WHERE failure IS NULL AND stage IN ('CONTRACT_REVIEW','BUYER_MATCH','CLOSING','INVOICED')`),
    estimated_pipeline_value: n(`SELECT SUM(expected_fee) n FROM opportunities WHERE failure IS NULL AND stage NOT IN ('LEAD','QUALIFIED','REVENUE')`),
    theoretical_spread_qualified: n(`SELECT SUM(p.spread_low) n FROM properties p JOIN opportunities o ON o.property_id=p.id WHERE o.stage='QUALIFIED' AND o.failure IS NULL`),
    expected_revenue: n(`SELECT SUM(amount) n FROM money WHERE kind='revenue' AND status='expected'`),
    actual_revenue: revenue, expenses, net_profit: revenue - expenses,
    messages_sent: sent, response_rate: sent ? responded / sent : null,
    conversion_rate: leads ? won / leads : null,
    cost_per_lead: leads ? expenses / leads : null,
    pending_approvals: n(`SELECT COUNT(*) n FROM outreach WHERE status='DRAFT'`),
    open_tasks: n(`SELECT COUNT(*) n FROM tasks WHERE status='OPEN'`),
    last_ingest: one(db, `SELECT finished_at, stats FROM runs WHERE kind='ingest_cleveland' AND error IS NULL ORDER BY id DESC LIMIT 1`) ?? null,
  };
}

export function dailyReport(db) {
  const o = overview(db), s = getSettings(db);
  const opps = all(db, `SELECT p.id, p.address, p.neighborhood, p.score, p.est_arv, p.mao, p.offer_high, p.arv_confidence, p.economics_flag, p.record_url, p.score_breakdown
    FROM properties p JOIN opportunities op ON op.property_id=p.id AND op.track='deal' WHERE op.stage='QUALIFIED' AND op.failure IS NULL
    ORDER BY p.score DESC, p.est_arv DESC LIMIT 5`).map(p => ({ ...p, score_breakdown: parse(p.score_breakdown, []) }));
  const prospects = all(db, `SELECT b.id, b.company, b.name, b.role, b.source_url FROM buyers b WHERE b.do_not_contact=0
    AND NOT EXISTS (SELECT 1 FROM outreach m WHERE m.buyer_id=b.id AND m.status IN ('SENT','RESPONDED','NO_RESPONSE','APPROVED')) LIMIT 10`);
  const approvals = all(db, `SELECT id, recipient, template, risk_flags FROM outreach WHERE status='DRAFT' ORDER BY id`).map(m => ({ ...m, risk_flags: parse(m.risk_flags, []) }));
  const approved = all(db, `SELECT id, recipient, channel FROM outreach WHERE status='APPROVED'`);
  const tasks = all(db, `SELECT id, kind, title, detail, due_at FROM tasks WHERE status='OPEN' AND (due_at IS NULL OR due_at <= date('now','+1 day')) ORDER BY kind='human' DESC, due_at`);
  const deals = all(db, `SELECT id, track, stage, property_id, buyer_id, next_action, updated_at FROM opportunities WHERE failure IS NULL AND stage NOT IN ('LEAD','QUALIFIED','REVENUE')
    AND (next_action_at <= date('now') OR updated_at <= datetime('now','-7 days') OR stage IN ('RESPONDED','INTERESTED'))`);
  const blockers = [];
  const missingSender = ['sender_name', 'sender_business', 'sender_email', 'sender_postal'].filter(k => !s[k]);
  if (missingSender.length) blockers.push(`Sender profile incomplete (${missingSender.join(', ')}): every draft is blocked until filled (Settings).`);
  if (!o.last_ingest) blockers.push('No successful data ingest yet: run `npm run ingest`.');
  if (!all(db, `SELECT 1 FROM buyers WHERE criteria_status='STATED' LIMIT 1`).length) blockers.push('No buyer has stated criteria yet, so deal matching has nothing to match against.');
  if (s.payment_ready !== 'true') blockers.push('No way to receive payment set up yet (Payoneer or similar). Needed before the first paid week.');
  if (s.track_b_ready !== 'true') blockers.push('Track B (own wholesale deals) locked: needs US entity, EMD funds, attorney-reviewed Ohio contract. Track A (selling the research service) is the active revenue path.');
  let next;
  if (missingSender.length) next = 'Open Settings and fill in your sender name, business name, business email and postal address (CAN-SPAM needs a real one).';
  else if (approvals.length) next = `Review and approve/reject ${approvals.length} outreach draft(s) in Approvals.`;
  else if (approved.length) next = `Send ${approved.length} approved message(s) from your own email, then click "Mark sent".`;
  else if (deals.length) next = `Reply to / advance ${deals.length} active conversation(s) in Deals.`;
  else if (prospects.length) next = 'Draft service offers for uncontacted prospects (`npm run draft:prospects`).';
  else next = 'Add 5 new prospects: copy buying criteria from public Cleveland investor posts into Buyers → Capture.';
  return { date: today(), overview: o, opportunities: opps, prospects, approvals, approved, tasks, deals, blockers, next_action: next };
}

export { STAGES, FAILURES, usd, today };
