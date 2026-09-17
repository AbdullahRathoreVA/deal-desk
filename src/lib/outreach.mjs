// Outreach drafting. Every sentence is built from stored facts; anything unknown becomes a visible
// {{MISSING:...}} marker that blocks approval. Nothing here sends anything.

const MISSING = key => `{{MISSING:${key}}}`;
export const hasMissing = text => /\{\{MISSING:[^}]+\}\}/.test(text ?? '');
export const missingKeys = text => [...(text ?? '').matchAll(/\{\{MISSING:([^}]+)\}\}/g)].map(m => m[1]);

const usd = n => (n == null ? null : '$' + Math.round(n).toLocaleString('en-US'));

function sender(s) {
  const f = k => s[k]?.trim() || MISSING(k);
  return { name: f('sender_name'), business: f('sender_business'), email: f('sender_email'), postal: f('sender_postal') };
}

function signature(s, withOptOut) {
  const x = sender(s);
  return `${x.name}\n${x.business} · ${x.email}\n${x.postal}` + (withOptOut ? '\n\nReply "no" and I will not contact you again.' : '');
}

const recipientName = b => b.name || b.company || MISSING('recipient_name');

export const TEMPLATES = {
  investor_service_offer: {
    audience: 'investor', channel: 'email', track: 'client',
    objective: 'Get a reply asking for the free 10-property sample (starts client pipeline).',
    render: ({ b, s, stats, example }) => ({
      subject: `Free sample: ${stats.qualified} scored distressed properties in ${s.market_city ?? 'Cleveland'} (public records)`,
      body: `Hi ${recipientName(b)},

${b.source_url ? `I found ${b.company || 'your company'} through your website (${b.source_url}), which says you buy houses in ${s.market_city ?? 'Cleveland'}.` : ''}

I run a small research desk that turns Cuyahoga County and City of Cleveland public records into a ranked list of distressed 1-3 family properties. Each property is scored on tax delinquency, foreclosure flags, recent code violations, vacancy and absentee ownership, with an ARV estimated from recent county sales. Estimates are labelled as estimates; county facts link to the county record.

This week's run: ${stats.qualified} properties scored ${stats.threshold}+ out of ${stats.scanned} residential parcels with a distress signal.
Example (address withheld): ${example}

Would a free sample of 10 for your target neighborhoods be useful? If it is, the weekly list is ${usd(Number(s.service_price_week)) ?? MISSING('service_price_week')}/week. If not, I won't follow up.

${signature(s, true)}`,
    }),
  },

  wholesaler_service_offer: {
    audience: 'wholesaler', channel: 'email', track: 'client',
    objective: 'Offer underwriting + distressed-list support to a wholesaler; get a sample request.',
    render: ({ b, s, stats, example }) => ({
      subject: `Cleveland distressed-property list + underwriting (free sample)`,
      body: `Hi ${recipientName(b)},

${b.source_url ? `Saw your post/site (${b.source_url}).` : ''} I help wholesalers working Cleveland with the research side: a weekly ranked list of distressed 1-3 family properties from county records (tax delinquency, foreclosure flag, code violations, vacancy, absentee owner), each with estimated ARV, repairs and a max-offer range you can check.

This week: ${stats.qualified} properties scored ${stats.threshold}+.
Example (address withheld): ${example}

Happy to send 10 for your zips free so you can judge the quality. Ongoing: ${usd(Number(s.service_price_week)) ?? MISSING('service_price_week')}/week.

${signature(s, true)}`,
    }),
  },

  cash_buyer_deal: {
    audience: 'cash_buyer', channel: 'email', track: 'deal',
    objective: 'Assign a signed purchase contract to a matched cash buyer.',
    requiresContract: true,
    render: ({ b, p, o, s }) => ({
      subject: `Assignable contract: ${p.units ?? 1}-family, ${p.neighborhood ?? p.city} (${p.zip})`,
      body: `Hi ${recipientName(b)},

This matches the criteria you stated. I have a signed purchase contract on ${p.address}, ${p.city} ${p.zip} and am assigning that contract. I am not the owner and not a licensed agent; I hold an equitable interest under the contract.

Facts (county records, verify at ${p.record_url ?? MISSING('record_url')}):
- ${p.units ?? 1}-family, ${p.living_sqft ?? MISSING('living_sqft')} sq ft, built ${p.year_built ?? MISSING('year_built')}
- City survey condition grade: ${p.condition_grade ?? 'UNKNOWN'}

Estimates (mine, not verified):
- ARV ${usd(p.est_arv) ?? MISSING('est_arv')} from ${p.arv_comps} county sales
- Repairs ${usd(p.est_repairs) ?? MISSING('est_repairs')}

Assignment price: ${usd(o?.contract_price != null && o?.expected_fee != null ? o.contract_price + o.expected_fee : null) ?? MISSING('assignment_price')} (contract ${usd(o?.contract_price) ?? MISSING('contract_price')} + assignment fee). Walk-through and proof of funds required.

${signature(s, true)}`,
    }),
  },

  owner_letter: {
    audience: 'owner', channel: 'mail', track: 'deal',
    objective: 'Invite the owner to call if they have considered selling. No pressure, no claims about their situation.',
    render: ({ p, s }) => ({
      subject: `About ${p.address}`,
      body: `Hello ${p.owner_name ?? MISSING('owner_name')},

I buy houses in ${p.neighborhood ?? p.city} and I'm writing about ${p.address}. If you have ever thought about selling, I buy as-is: no repairs or cleaning, and you choose the closing date.

To be upfront: if we agree on a price, I may assign my purchase contract to another buyer instead of closing myself. Ohio law requires me to give you that disclosure in writing, and I will, before you sign anything. You are always free to talk to an attorney or a real estate agent first.

If you're not interested, no reply is needed and you won't hear from me again.

${signature(s, false)}`,
    }),
  },

  agent_intro: {
    audience: 'agent', channel: 'email', track: 'client',
    objective: 'Build a relationship with a local licensed agent (retail-listing referrals go to them; no fee requested).',
    render: ({ b, s, stats }) => ({
      subject: `Cleveland distressed-inventory research: happy to share`,
      body: `Hi ${recipientName(b)},

I research distressed residential property in Cleveland from public records (${stats.qualified} scored properties this week). When owners I speak with want a retail listing rather than an as-is sale, I would like to point them to a good local agent. I'm not licensed and am not asking for a referral fee.

Would you be open to a short intro call?

${signature(s, true)}`,
    }),
  },

  contractor_bid: {
    audience: 'contractor', channel: 'email', track: 'deal',
    objective: 'Get a real repair estimate to replace the rule-of-thumb estimate.',
    render: ({ b, p, s }) => ({
      subject: `Repair estimate request: ${p.units ?? 1}-family in ${p.neighborhood ?? p.city}`,
      body: `Hi ${recipientName(b)},

Could you quote a walkthrough and repair estimate for ${p.address}, ${p.city} ${p.zip}? County records: ${p.living_sqft ?? MISSING('living_sqft')} sq ft, built ${p.year_built ?? MISSING('year_built')}, city survey condition grade ${p.condition_grade ?? 'UNKNOWN'}. Access would be arranged with the owner first.

${signature(s, true)}`,
    }),
  },

  referral_partner: {
    audience: 'referral_partner', channel: 'email', track: 'client',
    objective: 'Partner with a VA agency, REIA or coach who serves Cleveland investors and can resell/refer the list.',
    render: ({ b, s, stats }) => ({
      subject: `Partnership: Cleveland distressed-property data for your members/clients`,
      body: `Hi ${recipientName(b)},

I produce a weekly ranked list of distressed Cleveland properties from county records (${stats.qualified} scored this week) with estimated underwriting. If your members or clients invest in Cleveland, I'd like to offer them a free sample and a discounted rate.

Open to a quick conversation?

${signature(s, true)}`,
    }),
  },
};

export function riskFlags({ template, channel, b, p, o, s }) {
  const flags = [];
  const block = msg => flags.push({ level: 'BLOCK', msg });
  const warn = msg => flags.push({ level: 'WARN', msg });
  if (b?.do_not_contact) block('Recipient is marked do-not-contact.');
  if (TEMPLATES[template]?.requiresContract && !(o?.contract_signed && o?.seller_disclosure && o?.professional_review))
    block('No signed + disclosed + reviewed contract. Marketing a property you do not control risks unlicensed brokerage (Ohio ORC 4735) and misrepresentation.');
  if (template === 'owner_letter' && s.track_b_ready !== 'true')
    block('Track B not ready: no US entity / EMD funds / attorney-reviewed Ohio contract with SB 155 disclosure. Do not solicit owners yet.');
  if (template === 'owner_letter' && p?.foreclosure_flag === 1)
    warn('Owner is in a foreclosure-flagged situation: no promises to stop foreclosure; attorney review before any agreement.');
  if (channel === 'sms' || channel === 'call')
    block('Calls/texts: TCPA ($500-$1,500 per message) and National DNC rules. Not used by this system.');
  if (channel === 'email') warn('CAN-SPAM: real sender identity, physical postal address and a working opt-out (honor within 10 business days).');
  if (channel === 'facebook') warn('Meta terms: send manually from your own account, follow each group\'s rules, no automation or bulk DMs.');
  if (b && b.verification !== 'verified') warn('Recipient identity and criteria not verified yet; criteria come from their public page/post.');
  if (template === 'cash_buyer_deal') warn('FIRPTA: as a foreign person, an assignment fee on US property can trigger 15% withholding by the payer (IRC 1445). Get a US tax professional before closing.');
  return flags;
}
