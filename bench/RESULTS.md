# Policy test suite results

Run: 2026-11-08 · Planner: rule-based planner

| Metric | Result |
|---|---|
| Seller Protection status matches label | 30/30 (100%) |
| FIGHT / ACCEPT decision matches label | 30/30 (100%) |

Labels are hand-written from PayPal's published Seller Protection rules (see `bench/cases.js`).
They are a regression test of policy fidelity, not a measure of real-world dispute win rates.

| Case | Reason | Amount | Coverage (label / got) | Decision (label / got) |
|---|---|---:|---|---|
| inr-full-1 | merchandise or service not received | $64 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| inr-full-2 | merchandise or service not received | $12 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| inr-full-3 | merchandise or service not received | $980 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| inr-full-4 | merchandise or service not received | $140 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| inr-full-5 | merchandise or service not received | $33 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| inr-transit-big | merchandise or service not received | $210 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | FIGHT / FIGHT |
| inr-transit-mid | merchandise or service not received | $75 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | FIGHT / FIGHT |
| inr-transit-small | merchandise or service not received | $22 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | ACCEPT / ACCEPT |
| inr-transit-tiny | merchandise or service not received | $9 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | ACCEPT / ACCEPT |
| inr-notrack-1 | merchandise or service not received | $45 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | ACCEPT / ACCEPT |
| inr-notrack-2 | merchandise or service not received | $18 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | ACCEPT / ACCEPT |
| inr-noorder | merchandise or service not received | $60 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | ACCEPT / ACCEPT |
| inr-addr-1 | merchandise or service not received | $300 | NOT_COVERED / NOT_COVERED | FIGHT / FIGHT |
| inr-addr-2 | merchandise or service not received | $20 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| unauth-full | unauthorised | $150 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| unauth-full-small | unauthorised | $15 | LIKELY_COVERED / LIKELY_COVERED | FIGHT / FIGHT |
| unauth-notrack | unauthorised | $90 | NEEDS_EVIDENCE / NEEDS_EVIDENCE | ACCEPT / ACCEPT |
| snad-big-proof | merchandise or service not as described | $120 | NOT_COVERED / NOT_COVERED | FIGHT / FIGHT |
| snad-mid-proof | merchandise or service not as described | $60 | NOT_COVERED / NOT_COVERED | FIGHT / FIGHT |
| snad-small-1 | merchandise or service not as described | $18 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| snad-small-2 | merchandise or service not as described | $24 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| snad-notrack | merchandise or service not as described | $80 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| snad-big-nodeliv | merchandise or service not as described | $400 | NOT_COVERED / NOT_COVERED | FIGHT / FIGHT |
| late-inr | merchandise or service not received | $64 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| late-snad | merchandise or service not as described | $500 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| late-unauth | unauthorised | $200 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| other-1 | credit not processed | $70 | NOT_COVERED / NOT_COVERED | FIGHT / FIGHT |
| other-2 | duplicate transaction | $15 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| other-3 | incorrect amount | $11 | NOT_COVERED / NOT_COVERED | ACCEPT / ACCEPT |
| other-4 | payment by other means | $240 | NOT_COVERED / NOT_COVERED | FIGHT / FIGHT |
