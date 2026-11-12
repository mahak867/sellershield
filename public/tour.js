// Guided tour for judges: walks the real dashboard in about two minutes. Steps that say
// "Next does it" press the real button, so every result on screen is the app's own.
// Open with the "Guided tour" button or /?tour=1.
const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(150); } return false; };
const runIdle = () => $('#run').textContent === 'Run agent';

const STEPS = [
  { el: 'header', title: 'SellerShield in two minutes', text: 'An AI agent for small PayPal sellers. It makes every sale protection-ready the moment it lands, collects late invoices, answers disputes, and handles purchases made by buyers\' AI agents. The badges show which integrations are live.' },
  { el: 'section.card:has(#readyGrid)', title: 'Every sale, checked before any dispute', text: 'Each sale is checked against PayPal Seller Protection now, not after a buyer complains. Each row says what is missing and who has to fix it: the agent, the carrier or the seller.' },
  { el: '#fixAll', title: 'One click closes the gaps the agent can', text: 'Tracking that never reached PayPal is the proof an "item not received" claim needs, and the first step PayPal lists to avoid a hold. Next sends it.', act: async () => { if (!$('#fixAll').disabled) { $('#fixAll').click(); await until(() => !/Sending/.test($('#fixAll').textContent)); } } },
  { el: '.kpi:first-child', title: 'More sales protected', text: 'The headline number moved. Each upload was an agent proposal approved by a fingerprint of exactly what was sent, and it is in the audit log.' },
  { el: '#run', title: 'The agent reviews everything else', text: 'Next runs the agent: one proposal per dispute, overdue invoice and sale. Without an API key the plans come from rules; with one, from Claude. The header badge says which.', act: async () => { $('#run').click(); await wait(300); await until(runIdle, 90000); } },
  { el: '.prop:has(.prot)', title: 'Disputes: decided on PayPal\'s own rules', text: 'Each dispute shows the Seller Protection checklist. The response may only state facts it can cite from numbered records; type a made-up date into the draft and sending is blocked.' },
  { el: 'section.card:has(.ap)', title: 'Autopilot, inside limits the seller sets', text: 'Next turns autopilot on (up to $100, at least 80% confident) and simulates a new dispute. The agent acts alone only inside those limits.', act: async () => {
    if (!$('#apOn').checked) { $('#apOn').click(); await wait(400); }
    $('#simDispute').click(); await wait(2200);
  } },
  { el: '#feed', title: 'It acted, and said so', text: 'The live feed shows the dispute arriving and what autopilot did about it. Anything bigger waits for the seller.' },
  { el: '#timeline', title: 'Every deadline and every sale on one calendar', text: 'Bryntum Scheduler: dispute deadlines, overdue invoices, holds, and each sale\'s journey from no proof to protected. Drag a purple action onto a day to approve it for that day.' },
  { el: 'section.card:has(#readyGrid)', title: 'One sale, start to finish', text: 'Next opens one sale\'s story: paid, tracking sent, delivered, disputed, answered, with who acted and which PayPal API was used.', act: async () => { const b = document.querySelector('#readyGrid [col-id="story"] button'); if (b) { b.click(); await until(() => $('#story').open, 5000); } } },
  { el: '.actions a[href="/buyer.html"]', title: 'The other side of the sale', text: 'On the Buyer agent page an AI agent shops for a buyer inside a spending limit, and "Try to break it" runs eight attacks against it. If that buyer later disputes the purchase, the dispute card works out whose mistake it was.', before: () => { if ($('#story').open) $('#story').close(); }, last: true },
];

let i = -1, ring, card;
function build() {
  ring = document.createElement('div'); ring.className = 'tour-ring'; ring.setAttribute('aria-hidden', 'true');
  card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
  document.body.append(ring, card);
}
function place(el) {
  if (!el) { ring.style.opacity = 0; return; }
  const r = el.getBoundingClientRect(), pad = 6;
  Object.assign(ring.style, { opacity: 1, top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + 2 * pad}px`, height: `${Math.min(r.height + 2 * pad, innerHeight - 20)}px` });
}
async function show(n) {
  i = n;
  const s = STEPS[i];
  s.before?.();
  const el = document.querySelector(s.el);
  el?.scrollIntoView({ block: 'center', behavior: 'instant' });
  await wait(120);
  place(el);
  card.innerHTML = `<div class="tour-top"><small>Step ${i + 1} of ${STEPS.length}</small><button class="ghost tour-x" aria-label="End tour">End</button></div>
    <h3>${s.title}</h3><p>${s.text}</p>
    <div class="tour-nav">${i ? '<button class="ghost tour-back">Back</button>' : '<span></span>'}<button class="tour-next">${s.last ? 'Finish' : s.act ? 'Next: do it' : 'Next'}</button></div>`;
  card.querySelector('.tour-x').onclick = end;
  card.querySelector('.tour-back')?.addEventListener('click', () => show(i - 1));
  const next = card.querySelector('.tour-next');
  next.focus();
  next.onclick = async () => {
    if (s.last) return end();
    next.disabled = true; next.textContent = 'Working...';
    try { await s.act?.(); } catch (e) { window.ssToast?.(e.message); }
    show(i + 1);
  };
}
function end() { ring?.remove(); card?.remove(); ring = card = null; i = -1; if ($('#story')?.open) $('#story').close(); }
export function startTour() { end(); build(); show(0); }
addEventListener('scroll', () => { if (ring && i >= 0) place(document.querySelector(STEPS[i].el)); }, { passive: true });
addEventListener('resize', () => { if (ring && i >= 0) place(document.querySelector(STEPS[i].el)); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) end(); });
document.querySelector('#tourBtn')?.addEventListener('click', startTour);
if (new URLSearchParams(location.search).get('tour') === '1') setTimeout(startTour, 1200);
window.ssTour = { start: startTour, steps: STEPS.length };
