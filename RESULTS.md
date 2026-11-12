# Results

What SellerShield measures about itself, and how to reproduce each number. Everything here runs without keys, in demo mode, unless the row says otherwise.

| What | Result | How it is measured | Reproduce |
|---|---|---|---|
| Unit and API tests | 157 pass, in 12 files | One file per module, plus Node's test runner against a real server process: Seller Protection rules, citation checker, fingerprints, autopilot limits, buyer agent mandates, red team, sale story, MCP limits, restart persistence (JSON file and a real Redis), alerts, security headers | `npm test` |
| Code coverage | About 83% of lines and 84% of branches in the library modules | Node's built-in coverage; the server runs in a separate process during API tests and is not counted | `npm run coverage` |
| Randomised checks | 400 random amounts and dates, all refused unless they match the cited record | Part of the citation checker tests | `npm test` |
| Browser test | 30 steps pass, locally and in GitHub CI on every push | Playwright clicks through every main flow, runs the full guided tour, and audits accessibility | `npm start`, then `npm run smoke` |
| Buyer agent red team | 8 of 8 attacks blocked | Prompt injection, an over-limit pick, an invented item, bait and switch, capturing another order, reusing a mandate, a forged mandate, impossible limits; each runs through the same capture guard a real purchase uses | **Buyer agent** page, **Run all 8 attacks**, or `npm test` |
| Seller Protection policy suite | 30 of 30 coverage labels, 30 of 30 decisions (rule-based planner) | 30 hand-labelled disputes; labels written from PayPal's published Seller Protection rules | `npm run bench` (uses Claude when `ANTHROPIC_API_KEY` is set) |
| Accessibility | 0 issues on the store and buyer pages; 1 known issue on the dashboard, inside Bryntum Scheduler's own markup | axe-core, WCAG 2.1 AA, light and dark themes | `npm run smoke` |
| Citation checker | Refuses any amount, date or ID that does not match the record it cites, in full | Unit tests, including partial-match cases such as "$6" against "$64.00" | `npm test` |
| State across restarts | Orders, proposals, autopilot policy and the audit log survive | The test suite restarts the server against a JSON file and against Redis | `npm test` |

## Limits, stated plainly

- **The policy suite checks fidelity to PayPal's published rules, not real-world win rates.** Its labels were written from those rules, so 30 of 30 with the rule-based planner shows the rules are encoded correctly; it does not show that disputes are won. The number that matters for Claude is the same suite run with a key.
- **Demo disputes are simulated.** Sellers cannot create disputes through PayPal's API, so sample disputes fill in when the sandbox has none. They are tagged **demo** everywhere, and the audit log marks every PayPal call **live** or **simulated**. A real sandbox dispute (opened by a sandbox buyer) is handled live.
- **"Hours saved" is an estimate**: 45 minutes per dispute, 15 per tracking fix, 10 per reminder.
