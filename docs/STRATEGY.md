# Strategy: what the video shows, what fails, what we run instead

Labels: **FACT** (checked this session, with source) · **SOURCE** (secondary source, not independently checked) · **ESTIMATE** · **ASSUMPTION** · **UNKNOWN**. Sources and dates are also stored in the app's Research tab (`evidence` table).

## 1. The video

**Demonstrated (FACT, from frames):**
- Instagram reel by @maximiliandier, hook "AI Should Be Illegal…", captioned "We need to ban AI…".
- Claude.ai prompt: "Write me an offer contract on [blurred address] and include assignment language".
- auction.com home page, then a **foreclosure** listing at 15060 SW 80th Ave, Palmetto Bay (Miami-Dade), status "Scheduled", button "Bid at County Site", with Est. Credit Bid / Est. Market Value / Opening Bid.
- Facebook → Groups search → a Texas investor group post: "Anyone need help moving deals? I have buyers for cash, and can also help with novations".
- Generated document: "Residential Purchase and Sale Agreement (Assignable – As-Is – Cash / Wholesale Transaction)", buyer "and/or its assigns", same Miami address.
- Final screen: "Wholesailors (Wholesale Skool)", a paid community (3.9k members) with an "Assigns.com is releasing next week" post.
- The audio could not be transcribed (Whisper returned only a repeated filler line), so the spoken pitch is **UNKNOWN**.

**Inferred business model (ASSUMPTION):**

| Question | Answer |
|---|---|
| Opportunity | Get a purchase contract on a discounted property, then sell the contract to a cash investor |
| Who pays | The end buyer pays the assignment fee at closing |
| What creates value | Finding a seller who will accept a below-market price, and a buyer who will pay more |
| Lead source (video) | auction.com listings + Facebook investor groups |
| How a deal happens | Seller signs → wholesaler markets the contract → buyer signs assignment → title company closes |
| How money is made | Assignment fee ($10k–$30k claimed in your pasted prompt; **UNKNOWN** as a typical figure) |
| **The creator's visible revenue** | The paid Skool community and the software launch, not a shown closed deal |
| Automatable | Research, scoring, underwriting, matching, drafting, tracking. Signing, negotiating, and sending as you are not. |

## 2. Why the literal method fails (and is not built)

1. **There is no seller to sign.** The listing is a county foreclosure auction. Miami-Dade sells it to the highest bidder, who forfeits a 5% deposit unless the balance is paid by noon the next business day (FACT, Miami-Dade Clerk). A wholesale contract "on" that address binds nobody.
2. **Marketing a property you don't control is unlicensed brokerage.** Florida Chapter 475 allows assigning a contract you hold; advertising the property itself is brokerage (SOURCE). Several states now go further: PA Act 52 (license + registration), NC H797 (license, since 2025-10-01), SC HB 4754 (license), OK SB 1072 (license to market), and disclosure laws in OH, TN, MD, TX, IN (FACT/SOURCE, see Research tab).
3. **Homeowners in foreclosure are protected.** In Florida, acquiring an interest in a home in foreclosure is a regulated rescue transaction; violations are deceptive trade practices up to $15,000 each (FACT, Fla. Stat. 501.1377).
4. **From Pakistan specifically:**
   - A foreign person assigning a US property contract faces 15% FIRPTA withholding on the fee (FACT, IRS).
   - Earnest money, a US title company, and attorney review cost money you don't have yet.
   - Cold calls and texts to US owners carry $500–$1,500 per message TCPA exposure (FACT).
5. **Facebook automation is prohibited.** Meta's Automated Data Collection Terms ban automated collection without permission, logged in or not (FACT).
6. **Saturation (ASSUMPTION, from the video itself):** the group post shown is a wholesaler looking for deals, not a buyer. The groups are full of middlemen.

**Still valuable:** finding distressed properties from public data, underwriting them, knowing who buys what, and running disciplined outreach. That is the infrastructure. It's aimed at a customer who can pay now.

## 3. What we run

**Track A (active): sell the research to the people who already do the deals.**
A weekly, scored list of distressed Cleveland 1–3 family properties with estimated ARV, repairs and max offer. Sold to local investors and wholesalers.
- Costs $0 to produce: public API, local software.
- Needs no license, contract, or earnest money.
- Payment isn't contingent on a closing, so it avoids brokerage-compensation issues. That's a design choice, not legal advice.
- Price $49/week is an **ASSUMPTION** to test. Demand is **UNKNOWN** until outreach runs.
- Adjacent upsells: hourly underwriting or VA work. Market rate for offshore real-estate VAs is $8–$20/hr (SOURCE).

**Track B (locked in the app): your own wholesale deals.** It unlocks only when all of these exist:
- A US entity
- Earnest-money funds
- An Ohio attorney-reviewed contract with the SB 155 disclosure
- A US tax professional for FIRPTA and foreign-owner filings

The pipeline refuses to market any property without a signed, disclosed, professionally reviewed contract.

## 4. Market selection

**Rule, in order:**
1. The state requires no license or registration to wholesale.
2. A free, parcel-level API was tested, updated within 30 days, and carries at least 3 distress signals.
3. Among those, pick the highest ATTOM H1-2026 foreclosure rate.

| Market | 1. Legal gate | 2. Data tested 2026-09-17 | ATTOM H1 2026 rate | Result |
|---|---|---|---|---|
| **Cleveland, OH** | Pass (disclosure only, SB 155) | **Pass**: 162,869 parcels with tax delinquency, foreclosure flag, violations, vacancy, absentee owner, condition grade; violations updated 2026-09-11 | 1 in 303 (200k+ metros) | **Selected** |
| Detroit, MI | Pass (no statute; 5-deal/yr limit per SOURCE) | Partial: blight tickets, 904,619 rows, updated same day. Only one signal tested | Not in top list | Backup |
| Jacksonville, FL | Pass | Fail: no open distress dataset found | 1 in 323 | — |
| Lakeland / Punta Gorda / Cape Coral, FL | Pass | Not tested | 1 in 208 / 200 / 286 | Candidate for a 2nd connector |
| Indianapolis, IN | Pass (disclosure, HEA 1068) | Fail: latest record 2024-02-27 | IN 1 in 402 | — |
| Baltimore, MD / Memphis, TN | Pass (disclosure) | Fail: no dataset found by catalog search | not listed | — |
| Macon, GA | Pass (attorney closings) | Not tested | 1 in 278 | Candidate |
| Columbia, SC | **Fail** (license) | — | 1 in 233 | Excluded |
| Fayetteville, NC | **Fail** (license) | — | 1 in 278 | Excluded |
| Philadelphia / Pittsburgh, PA | **Fail** (Act 52) | — | — | Excluded |

Cleveland run results (FACT, 2026-09-17):
- 11,937 recent sales loaded as comps, with 1,681 bulk-portfolio rows removed.
- 23,417 distressed 1–3 family parcels scored.
- 1,824 qualified: score ≥ 40 with numbers flagged OK or THIN.

ARV is **ESTIMATED**: the median $/sqft of A/B-grade sales nearby. Any ARV above 3× county value is flagged VERIFY_ARV and excluded.

## 5. Money needed, and when

| Item | Why | Cost | Free alternative | Postpone? |
|---|---|---|---|---|
| Data, software, hosting | — | $0 (public API, local Node + SQLite) | — | — |
| Email | Sending the offers | $0 (your own address) | — | — |
| Payment receiving | Getting paid in Pakistan | Payoneer or similar; fees **UNKNOWN**, check at signup | Freelance platforms (they take a cut) | Until the first customer says yes |
| Paid lists or skip tracing | Owner phone numbers | **Not needed** for Track A | County records already include mailing addresses | Indefinitely |
| US entity, EMD, attorney, tax pro | Track B only | **UNKNOWN**, quote before committing | None | Until Track A revenue pays for it |
| Wholesaling courses or communities | — | Skip | Free public material | — |
