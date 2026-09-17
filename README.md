# Deal Desk

A local system that turns Cleveland public records into a ranked list of distressed properties, then helps you sell that research to the investors and wholesalers who buy those houses. Every outreach message is approval-gated.

Why this rather than the auction.com → Facebook method from the video: see [docs/STRATEGY.md](docs/STRATEGY.md).

## Run it

You only need Node 22.13 or newer.

```bash
npm run seed      # defaults, research evidence, first 8 prospects, your tasks
npm run ingest    # pull live Cleveland data (~2 min), score + underwrite everything
npm start         # dashboard at http://127.0.0.1:4455
npm run daily     # today's brief → reports/daily-YYYY-MM-DD.md
npm test
```

Other commands: `npm run draft:prospects` (one draft per uncontacted prospect) and `npm run match` (property ↔ buyer matching).

## How it works

```
County API ─► normalize + dedupe (parcel id) ─► score (transparent signals) ─► underwrite (comps → ARV, repairs, max offer)
     │                                                                          │
     └─ comps (bulk sales removed)                                              ▼
Buyers (public sites, manual capture) ─► match score + reasons ─► draft outreach (facts only) ─► YOU approve ─► YOU send ─► log ─► follow-up task
                                                                                                                      │
                                                         pipeline stages + failure states ◄───────────────────────────┘ ─► money
```

- **Every property field** carries provenance: VERIFIED (county/city record, with date), ESTIMATED (with method) or UNKNOWN.
- **Drafts never invent facts.** A missing fact becomes `{{MISSING:…}}` and blocks approval.
- **Hard blocks** apply to:
  - Marketing a property without a signed, disclosed, reviewed contract
  - Contacting owners while Track B is not ready
  - Calls and texts (TCPA)
  - Anyone marked do-not-contact
- **Nothing is sent by the software.** You send from your own email or account, then click "Mark sent".
- **Audit trail:** every change is logged in the `audit` table.

## Where you are needed

| When | What | Why it can't be automated |
|---|---|---|
| Once | Settings: real name, business name, email, postal address | CAN-SPAM; no impersonation |
| Once | Set up Payoneer (or similar) | Identity verification |
| Per message | Approve, send from your account, mark sent | Your name goes on it |
| Weekly | Read Cleveland investor posts in groups you've joined; paste criteria into Buyers → Capture | Meta prohibits automated collection |
| Per prospect | Open their website, confirm they buy in Cleveland, mark verified | Criteria came from search snippets |
| Track B only | US entity, earnest money, Ohio attorney-reviewed contract, US tax pro (FIRPTA) | Legal and financial commitments |

Data: `data/dealdesk.db` (SQLite, git-ignored, contains owner names from public records; keep it local).
