// Money timeline: Bryntum Scheduler. One row per item at risk; bars for response windows,
// overdue periods and holds; draggable reminder events the agent respects.
import { Scheduler, StringHelper } from '/vendor/bryntum/scheduler.module.js';

const DAY = 864e5;
const today = new Date(); today.setHours(0, 0, 0, 0);
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const at = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const plus = (d, n) => new Date(+at(d) + n * DAY);
const COVER = { LIKELY_COVERED: 'green', NEEDS_EVIDENCE: 'orange', NOT_COVERED: 'red' };

const sched = new Scheduler({
  appendTo: 'timeline',
  startDate: plus(today, -21),
  endDate: plus(today, 21),
  viewPreset: 'weekAndDay',
  tickSize: 84,
  visibleDate: { date: today, block: 'center' },
  rowHeight: 42,
  barMargin: 7,
  eventStyle: 'rounded',
  features: {
    timeRanges: { showCurrentTimeLine: true },
    dependencies: { allowCreate: false, showTooltip: false, radius: 6 },
    eventEdit: false, eventResize: false, eventDragCreate: false, eventMenu: false, scheduleMenu: false, cellEdit: false,
    eventDrag: { constrainDragToResource: true },
    eventTooltip: { template: ({ eventRecord }) => StringHelper.encodeHtml(eventRecord.get('tip') || eventRecord.name) },
  },
  columns: [
    { text: 'Money at risk', field: 'name', width: 240 },
    { text: 'Amount', field: 'amount', width: 110, align: 'right', renderer: ({ value }) => `$${Number(value || 0).toFixed(2)}` },
  ],
  eventRenderer: ({ eventRecord }) => StringHelper.encodeHtml(eventRecord.name),
  listeners: {
    // Seller evidence task: record the carrier's delivery date; the agent re-checks coverage.
    async eventClick({ eventRecord }) {
      const tx = eventRecord.get('orderTx');
      if (!eventRecord.get('isTask') || !tx) return;
      const date = prompt(`Carrier delivery date for ${eventRecord.get('item') || 'this order'} (YYYY-MM-DD):`, iso(today));
      if (!date) return;
      const r = await fetch(`/api/orders/${encodeURIComponent(tx)}/delivered`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
      window.ssToast?.(r.ok ? 'Delivery recorded. Seller Protection re-checked.' : (await r.json()).error);
      window.ssRefresh?.();
    },
    async eventDrop({ eventRecords }) {
      for (const e of eventRecords) {
        const proposalId = e.get('proposalId');
        if (proposalId) {
          const r = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: proposalId, at: iso(e.startDate), fingerprint: e.get('fingerprint') }) });
          if (!r.ok) { window.ssToast?.((await r.json()).error); }
          window.ssRefresh?.();
          continue;
        }
        const invoiceId = e.get('invoiceId');
        if (!invoiceId) continue;
        const r = await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId, at: iso(e.startDate) }) });
        if (!r.ok) alert((await r.json()).error);
      }
    },
  },
});

window.sellershieldTimeline = (r) => {
  const prop = Object.fromEntries((r.proposals || []).map((p) => [p.id, p]));
  const resources = [], events = [];
  for (const d of r.disputes) {
    const id = 'dispute:' + d.dispute_id, p = prop[id];
    resources.push({ id, name: `Dispute ${d.dispute_id}${d.demo ? ' (demo)' : ''}`, amount: d.amount });
    const due = d.seller_response_due_date ? at(d.seller_response_due_date) : plus(today, 10);
    events.push({ id: id + ':win', resourceId: id, startDate: today, endDate: due > today ? due : plus(today, 1), draggable: false,
      name: `Respond by ${iso(due)}`, eventColor: COVER[p?.protection?.status] || 'blue',
      tip: p?.protection ? `${p.protection.status.replaceAll('_', ' ').toLowerCase()}: ${p.protection.summary}` : 'Run the agent to check Seller Protection' });
  }
  for (const i of r.invoices) {
    const id = 'invoice:' + i.id;
    resources.push({ id, name: `Invoice ${i.id.slice(0, 14)}${i.demo ? ' (demo)' : ''}`, amount: i.amount });
    const due = at(i.due_date || today);
    events.push({ id: id + ':late', resourceId: id, startDate: due, endDate: due < today ? today : plus(due, 1), draggable: false, eventColor: 'red',
      name: `Overdue ${i.days_overdue}d`, tip: `${i.recipient}: ${i.memo}` });
    if (prop[id]) continue; // the agent's own action event (below) replaces the plain reminder
    const rem = at(r.reminders?.[i.id] || today);
    events.push({ id: id + ':rem', resourceId: id, startDate: rem, endDate: plus(rem, 1), draggable: true, eventColor: 'violet', invoiceId: i.id,
      name: 'Remind', tip: 'Drag to reschedule. The agent waits until this day.' });
  }
  for (const o of r.holds) {
    const id = 'hold:' + o.transactionId;
    resources.push({ id, name: `${o.live ? 'Needs tracking' : 'Held funds'}: ${o.item}${o.demo ? ' (demo)' : ''}`, amount: o.amount });
    const since = plus(today, -(o.daysHeld || 0));
    events.push({ id: id + ':held', resourceId: id, startDate: since, endDate: plus(today, 1), draggable: false, eventColor: 'orange',
      name: o.live ? 'No tracking on PayPal' : `Held ${o.daysHeld}d`, tip: 'Adding tracking can release funds early and protects against "item not received".' });
    if (!o.live) events.push({ id: id + ':est', resourceId: id, startDate: plus(today, 1), endDate: plus(since, 21), draggable: false, eventColor: 'gray', eventStyle: 'dashed',
      name: 'Est. release (typical 21-day hold)', tip: 'Estimate only: PayPal sets the actual release date.' });
  }
  // Sale journeys: paid -> tracking on PayPal -> delivered -> protection-ready, linked by arrows.
  // The red bar is the time a sale spent with no proof on PayPal: the window the agent closes.
  const journeyDeps = [];
  for (const s of r.readiness?.rows || []) {
    if (!s.soldAt || resources.some((x) => x.id === 'hold:' + s.transactionId)) continue; // held sales already have a row
    const id = 'sale:' + s.transactionId, sold = at(s.soldAt), tomorrow = plus(today, 1);
    resources.push({ id, name: `Sale: ${s.item}${s.demo ? ' (demo)' : ''}`, amount: s.amount });
    const sent = s.trackingSentAt ? at(s.trackingSentAt) : null, deliv = s.delivered ? at(s.delivered) : null;
    const span = (a, b) => (b > a ? b : plus(a, 1));
    events.push({ id: id + ':exposed', resourceId: id, startDate: sold, endDate: span(sold, sent || tomorrow), draggable: false, eventColor: 'red', cls: 'ss-journey',
      name: sent ? 'No proof' : 'No proof on PayPal yet', tip: sent ? `Paid ${s.soldAt}. PayPal had no tracking until ${s.trackingSentAt}.` : `Paid ${s.soldAt}. PayPal still has no tracking for this sale.` });
    if (sent) {
      events.push({ id: id + ':transit', resourceId: id, startDate: sent, endDate: span(sent, deliv || tomorrow), draggable: false, eventColor: 'orange', cls: 'ss-journey',
        name: deliv ? 'In transit' : 'In transit, not delivered yet', tip: `Tracking ${s.carrier} ${s.trackingNumber} on PayPal since ${s.trackingSentAt}.` });
      journeyDeps.push({ id: 'jd1:' + id, from: id + ':exposed', to: id + ':transit' });
    }
    if (sent && deliv) {
      events.push({ id: id + ':ready', resourceId: id, startDate: deliv, endDate: span(deliv, tomorrow), draggable: false, eventColor: s.status === 'READY' ? 'green' : 'gray', cls: 'ss-journey',
        name: s.status === 'READY' ? 'Protection-ready' : 'Delivered', tip: s.status === 'READY' ? `Delivered ${s.delivered}. Meets the Seller Protection proof requirements.` : `Delivered ${s.delivered}, but another check fails. Open the sale in the readiness grid.` });
      journeyDeps.push({ id: 'jd2:' + id, from: id + ':transit', to: id + ':ready' });
    }
  }
  // Agent calendar: every proposed action sits on its row. Drag it onto a day to approve it for that day.
  // Disputes missing proof get a two-step plan: seller task (get delivery confirmation) -> agent action.
  const deps = [];
  const dueOf = Object.fromEntries((r.disputes || []).map((d) => [d.dispute_id, d.seller_response_due_date]));
  for (const p of r.proposals || []) {
    if (!resources.some((x) => x.id === p.id)) continue;
    const missingDelivery = p.kind === 'dispute' && p.protection?.status === 'NEEDS_EVIDENCE' && p.orderTx
      && p.protection.checks.some((c) => !c.pass && /delivered/i.test(c.rule));
    let taskDay = null;
    if (missingDelivery) {
      const due = dueOf[p.target] ? at(dueOf[p.target]) : plus(today, 7);
      const latest = plus(due, -2) < today ? today : plus(due, -2);
      taskDay = today;
      events.push({ id: 'task:' + p.id, resourceId: p.id, startDate: taskDay, endDate: plus(taskDay, 1), draggable: false,
        eventColor: 'orange', cls: 'ss-task', isTask: true, orderTx: p.orderTx, name: '📦 proof',
        tip: `Seller task: get the carrier's delivery confirmation (latest ${iso(latest)}, 2 days before PayPal's deadline). Click to record the delivery date; the agent re-checks Seller Protection.` });
      deps.push({ id: 'dep:' + p.id, from: 'task:' + p.id, to: 'plan:' + p.id });
    }
    const on = at(p.scheduledAt || (taskDay ? plus(taskDay, 2) : today));
    const verb = { FIGHT: 'fight', ACCEPT: 'accept', REMIND: 'remind', ADD_TRACKING: 'tracking' }[p.decision] || p.decision.toLowerCase();
    events.push({ id: 'plan:' + p.id, resourceId: p.id, startDate: on, endDate: plus(on, 1), draggable: true,
      eventColor: p.scheduledAt ? 'green' : 'indigo', proposalId: p.id, fingerprint: p.fingerprint, cls: p.scheduledAt ? 'ss-plan ss-approved' : 'ss-plan',
      name: p.scheduledAt ? `✓ ${verb}` : `${verb} ⇢`,
      tip: p.scheduledAt ? `Approved to run on ${p.scheduledAt}. Fingerprint ${p.fingerprint.slice(0, 12)}.` : `Drag onto a day to approve this action for that day (fingerprint ${p.fingerprint.slice(0, 12)}). Today = runs within seconds.` });
  }
  const known = new Set(resources.map((x) => x.id));
  for (const [n, a] of (r.actions || []).entries()) {
    const id = `${a.kind}:${a.target}`;
    if (!known.has(id)) { resources.push({ id, name: `${a.kind[0].toUpperCase() + a.kind.slice(1)} ${String(a.target).slice(0, 14)} (handled)`, amount: a.amount }); known.add(id); }
    events.push({ id: `act:${n}`, resourceId: id, startDate: at(a.at), endDate: plus(a.at, 1), draggable: false, eventColor: 'green',
      name: `✓ ${a.decision.replaceAll('_', ' ').toLowerCase()}`, tip: `${a.by} · ${a.simulated ? 'simulated' : 'live PayPal call'}` });
  }
  sched.resourceStore.data = resources;
  sched.eventStore.data = events;
  sched.dependencyStore.data = [...deps, ...journeyDeps];
};
if (window.__ssData) window.sellershieldTimeline(window.__ssData);
