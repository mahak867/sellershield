// Policy test suite: runs every labelled case through the Seller Protection check and the
// dispute planner (Claude when ANTHROPIC_API_KEY is set, rules otherwise) and reports agreement.
// Usage: npm run bench            (writes bench/RESULTS.md)
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { CASES } from './cases.js';
import { assessProtection } from '../lib/protection.js';
import { ai, MOCK_AI } from '../lib/ai.js';

const rows = [];
for (const c of CASES) {
  const prot = assessProtection(c.dispute, c.o);
  const plan = await ai.planDispute(c.dispute, c.o, prot);
  rows.push({ id: c.id, reason: c.d.reason, amount: c.d.amount, expCov: c.coverage, gotCov: prot.status, expDec: c.decision, gotDec: plan.decision, source: plan.source });
}

const pct = (n) => `${Math.round((n / rows.length) * 1000) / 10}%`;
const covOk = rows.filter((r) => r.expCov === r.gotCov).length;
const decOk = rows.filter((r) => r.expDec === r.gotDec).length;
const claude = rows.filter((r) => r.source === 'claude').length;
const brain = MOCK_AI ? 'rule-based planner' : `Claude (${claude}/${rows.length} plans from Claude, rest fell back to rules)`;

const md = `# Policy test suite results

Run: ${new Date().toISOString().slice(0, 10)} · Planner: ${brain}

| Metric | Result |
|---|---|
| Seller Protection status matches label | ${covOk}/${rows.length} (${pct(covOk)}) |
| FIGHT / ACCEPT decision matches label | ${decOk}/${rows.length} (${pct(decOk)}) |

Labels are hand-written from PayPal's published Seller Protection rules (see \`bench/cases.js\`).
They are a regression test of policy fidelity, not a measure of real-world dispute win rates.

| Case | Reason | Amount | Coverage (label / got) | Decision (label / got) |
|---|---|---:|---|---|
${rows.map((r) => `| ${r.id} | ${r.reason.toLowerCase().replaceAll('_', ' ')} | $${r.amount} | ${r.expCov} / ${r.gotCov}${r.expCov === r.gotCov ? '' : ' ❌'} | ${r.expDec} / ${r.gotDec}${r.expDec === r.gotDec ? '' : ' ❌'} |`).join('\n')}
`;
writeFileSync(new URL('./RESULTS.md', import.meta.url), md);
console.log(`coverage ${covOk}/${rows.length}, decision ${decOk}/${rows.length} (${brain})`);
for (const r of rows.filter((x) => x.expCov !== x.gotCov || x.expDec !== x.gotDec)) console.log('MISMATCH', r);
