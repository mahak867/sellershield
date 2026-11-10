// SellerShield dashboard: grids (AG Grid), charts (AG Charts), proposals, autopilot, chat, live feed.
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const api = (p, body) => fetch(p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const typeCell = (p) => {
  if (p.node.rowPinned) return p.value;
  const tag = p.data.demo ? '<span class="tag demo">demo</span>' : '<span class="tag FIGHT">live</span>';
  return `${esc(p.value)} ${tag}`;
};
const urgCell = (p) => {
  if (p.node.rowPinned || p.value == null) return '';
  const v = p.value, c = v >= 70 ? 'var(--bad)' : v >= 40 ? 'var(--warn)' : 'var(--good)';
  return `<div class="urg"><span class="bar"><i style="width:${v}%;background:${c}"></i></span><b>${v}</b></div>`;
};
const agentCell = (p) => {
  const pr = p.data?.proposal;
  if (!pr) return p.node.rowPinned ? '' : '<span class="mute">run agent</span>';
  return `<span class="tag ${esc(pr.decision)}">${esc(pr.decision)}</span> <span class="mute">${Math.round(pr.confidence * 100)}%</span>`;
};
const actionCell = (p) => {
  const pr = p.data?.proposal;
  if (!pr && p.data?.type === 'Dispute' && !p.data.demo && !p.node.rowPinned) {
    const b = document.createElement('button');
    b.className = 'cellbtn ghost'; b.textContent = 'PayPal decides'; b.title = 'Sandbox only: ask PayPal to settle this dispute';
    b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/disputes/${encodeURIComponent(p.data.id)}/sandbox-settle`, {}); toast(`PayPal: ${r.outcome || r.status}`); await refresh(); } catch (e) { toast(e.message); b.disabled = false; } };
    return b;
  }
  if (!pr) return '';
  const b = document.createElement('button');
  b.className = 'cellbtn'; b.textContent = 'Approve';
  const ed = gridEdits[pr.id];
  if (ed?.issues?.length) { b.disabled = true; b.title = 'Edited draft fails the citation check'; }
  b.onclick = async () => {
    b.disabled = true;
    try {
      await api('/api/agent/approve', ed ? { id: pr.id, draft: ed.draft, fingerprint: ed.fingerprint } : { id: pr.id, fingerprint: pr.fingerprint });
      delete gridEdits[pr.id]; toast(`Done: ${pr.target}`); await refresh();
    } catch (e) { toast(e.message); b.disabled = false; }
  };
  return b;
};
// Saved column layout (per browser; optional).
function saveLayout() { try { localStorage.setItem('ss.riskGrid', JSON.stringify(riskGrid.getColumnState())); } catch {} }
// Drafts edited inside the grid: { [proposalId]: { draft, fingerprint, issues } }
const gridEdits = {};
const riskGrid = agGrid.createGrid($('#riskGrid'), {
  columnDefs: [
    { field: 'type', width: 150, cellRenderer: typeCell },
    { field: 'urgency', width: 140, cellRenderer: urgCell, sort: 'desc', filter: 'agNumberColumnFilter', enableCellChangeFlash: true },
    { field: 'amount', valueFormatter: (p) => money(p.value), width: 120, type: 'rightAligned', filter: 'agNumberColumnFilter', enableCellChangeFlash: true },
    { headerName: 'Agent says', width: 140, cellRenderer: agentCell, valueGetter: (p) => p.data?.proposal?.decision ?? '', enableCellChangeFlash: true },
    { headerName: 'Draft (double-click to edit)', colId: 'draft', flex: 2, minWidth: 240, tooltipValueGetter: (p) => p.value,
      editable: (p) => !!p.data?.proposal && !p.node.rowPinned, cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true,
      cellEditorParams: { maxLength: 4000, rows: 8, cols: 70 },
      valueGetter: (p) => p.data?.proposal ? (gridEdits[p.data.proposal.id]?.draft ?? p.data.proposal.draft) : '',
      valueSetter: (p) => { if (!p.data?.proposal) return false; gridEdits[p.data.proposal.id] = { draft: String(p.newValue ?? '') }; return true; },
      cellClassRules: { 'cell-bad': (p) => !!gridEdits[p.data?.proposal?.id]?.issues?.length, 'cell-edited': (p) => !!gridEdits[p.data?.proposal?.id] } },
    { field: 'detail', flex: 2, minWidth: 220, tooltipField: 'detail' },
    { field: 'who', headerName: 'Buyer / client', flex: 1, minWidth: 170 },
    { field: 'id', headerName: 'PayPal ID', flex: 1, minWidth: 170 },
    { headerName: '', width: 130, cellRenderer: actionCell, sortable: false, filter: false, pinned: 'right' },
  ],
  defaultColDef: { sortable: true, filter: true, resizable: true },
  rowSelection: { mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false, isRowSelectable: (n) => !!n.data?.proposal },
  onSelectionChanged: () => { const n = riskGrid.getSelectedRows().length; $('#bulk').disabled = !n; $('#bulk').textContent = n ? `Approve selected (${n})` : 'Approve selected'; },
  getRowId: (p) => p.data.key, rowData: [], overlayNoRowsTemplate: 'Nothing at risk. Nice.', tooltipShowDelay: 300,
  undoRedoCellEditing: true, undoRedoCellEditingLimit: 20, // Ctrl+Z / Ctrl+Y on draft edits
  onColumnMoved: saveLayout, onColumnResized: (e) => e.finished && saveLayout(), onSortChanged: saveLayout, onColumnPinned: saveLayout,
  // Every grid edit is re-fingerprinted and citation-checked on the server before it can be approved.
  onCellValueChanged: async (e) => {
    if (e.colDef.colId !== 'draft' || !e.data?.proposal) return;
    const id = e.data.proposal.id, ed = gridEdits[id];
    const r = await api('/api/agent/check', { id, draft: ed.draft });
    Object.assign(ed, r);
    e.api.refreshCells({ rowNodes: [e.node], force: true });
    toast(r.issues.length ? `Citation check failed: ${r.issues.map((i) => i.code).join(', ')}` : `Draft updated (fingerprint ${r.fingerprint.slice(0, 12)})`);
  },
});
const logGrid = agGrid.createGrid($('#logGrid'), {
  columnDefs: [
    { field: 'at', headerName: 'Time', valueFormatter: (p) => p.value ? new Date(p.value).toLocaleTimeString() : '', width: 105 },
    { field: 'by', headerName: 'Triggered by', width: 130 },
    { field: 'kind', width: 95 }, { field: 'decision', width: 135 }, { field: 'target', flex: 1, minWidth: 150 },
    { field: 'amount', valueFormatter: (p) => money(p.value), width: 110, type: 'rightAligned' },
    { field: 'api', headerName: 'PayPal API', width: 190 },
    { headerName: 'PayPal call', width: 120, cellDataType: 'text', valueGetter: (p) => p.node.rowPinned ? '' : p.data.simulated ? 'simulated' : 'live',
      cellClassRules: { 'live-cell': (p) => p.value === 'live' } },
    { field: 'fingerprint', headerName: 'Approved fingerprint', width: 150, valueFormatter: (p) => p.value ? p.value.slice(0, 12) : '', tooltipField: 'fingerprint' },
    { field: 'text', headerName: 'Sent to PayPal', flex: 2, minWidth: 220, tooltipField: 'text' },
  ],
  defaultColDef: { sortable: true, filter: true, resizable: true }, rowData: [], overlayNoRowsTemplate: 'No actions yet.', tooltipShowDelay: 300,
});
const openProof = new Set(); // sales whose proof checklist is expanded
const canEditTracking = (p) => !!p.data && !p.data.detailFor && !p.data.sentToPayPal;
const READY = { READY: ['Ready', 'FIGHT'], AGENT_CAN_FIX: ['Agent can fix', ''], WAITING: ['Waiting on carrier', 'demo'], AT_RISK: ['Needs you', 'ACCEPT'] };
const readyGrid = agGrid.createGrid($('#readyGrid'), {
  columnDefs: [
    { headerName: '', width: 76, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
        const b = document.createElement('button'); b.className = 'cellbtn ghost'; b.textContent = openProof.has(p.data.transactionId) ? '▾' : '▸';
        b.title = 'Show the Seller Protection checklist for this sale'; b.setAttribute('aria-label', b.title);
        b.onclick = () => { const id = p.data.transactionId; openProof.has(id) ? openProof.delete(id) : openProof.add(id); drawReady(); };
        return b; } },
    { field: 'item', headerName: 'Sale', flex: 1, minWidth: 250, cellRenderer: (p) => typeCell(p) + (p.data.byAgent ? ' <span class="tag" title="Bought by the buyer\'s AI agent, under a mandate">buyer agent</span>' : '') },
    { field: 'amount', valueFormatter: (p) => money(p.value), width: 110, type: 'rightAligned' },
    { field: 'status', headerName: 'Seller Protection', width: 170, enableCellChangeFlash: true,
      cellRenderer: (p) => `<span class="tag ${READY[p.value]?.[1] ?? ''}">${esc(READY[p.value]?.[0] ?? p.value)}</span>` },
    { headerName: 'Proof', width: 110, valueGetter: (p) => { const req = p.data.checks.filter((c) => !c.optional); return `${req.filter((c) => c.pass).length} of ${req.length}`; } },
    { field: 'carrier', width: 120, editable: canEditTracking, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['USPS', 'UPS', 'FEDEX', 'DHL'] }, cellClassRules: { 'cell-edited': canEditTracking } },
    { field: 'trackingNumber', headerName: 'Tracking number', flex: 1, minWidth: 200, editable: canEditTracking, cellClassRules: { 'cell-edited': canEditTracking },
      valueFormatter: (p) => p.value || (canEditTracking(p) ? 'double-click to add' : '') },
    { field: 'delivered', headerName: 'Delivered on', width: 150, editable: (p) => !p.data.delivered && !!p.data.trackingNumber, cellClassRules: { 'cell-edited': (p) => !p.data.delivered && !!p.data.trackingNumber },
      valueFormatter: (p) => p.value || (p.data.trackingNumber ? 'YYYY-MM-DD' : '') },
    { field: 'transactionId', headerName: 'PayPal ID', flex: 1, minWidth: 170 },
  ],
  defaultColDef: { sortable: false, filter: true, resizable: true }, getRowId: (p) => (p.data.detailFor ? 'd:' : '') + p.data.transactionId,
  rowData: [], overlayNoRowsTemplate: 'No sales yet. Open the store and buy something.', tooltipShowDelay: 300,
  // Expandable proof checklist, built with full-width rows.
  isFullWidthRow: (p) => !!p.rowNode.data?.detailFor,
  getRowHeight: (p) => (p.data?.detailFor ? 26 + p.data.checks.length * 24 : undefined),
  fullWidthCellRenderer: (p) => `<div class="prot" style="margin:6px 12px;border:0"><ul>${p.data.checks.map((c) =>
    `<li class="${c.pass ? 'ok' : 'no'}" data-i="${c.pass ? '✓' : '✗'}">${esc(c.rule)} <span class="mute">(${esc(c.detail)}${c.pass || c.optional ? '' : ` · fixed by: ${esc(c.fix)}`}${c.optional ? ' · extra evidence, not a Seller Protection rule' : ''})</span></li>`).join('')}</ul></div>`,
  // Typing proof into the grid saves it; the server validates and the agent re-checks the sale.
  onCellValueChanged: async (e) => {
    const f = e.colDef.field;
    if (!['carrier', 'trackingNumber', 'delivered'].includes(f)) return;
    try { const r = await api(`/api/orders/${encodeURIComponent(e.data.transactionId)}/proof`, { [f]: e.newValue }); toast(`Saved. This sale is now: ${READY[r.readiness.status][0].toLowerCase()}`); }
    catch (err) { toast(err.message); }
    await refresh();
  },
});
let readyRows = [];
function drawReady() { readyGrid.setGridOption('rowData', readyRows.flatMap((r) => (openProof.has(r.transactionId) ? [r, { ...r, detailFor: true }] : [r]))); }
try { const st = JSON.parse(localStorage.getItem('ss.riskGrid') || 'null'); if (st) riskGrid.applyColumnState({ state: st, applyOrder: true }); } catch {}
$('#qf').oninput = () => riskGrid.setGridOption('quickFilterText', $('#qf').value);
$('#csv1').onclick = () => riskGrid.exportDataAsCsv({ fileName: 'sellershield-money-at-risk.csv', columnKeys: ['type', 'urgency', 'amount', 'detail', 'who', 'id'] });
$('#csv2').onclick = () => logGrid.exportDataAsCsv({ fileName: 'sellershield-audit-log.csv' });
$('#bulk').onclick = async () => {
  const rows = riskGrid.getSelectedRows(); $('#bulk').disabled = true;
  let done = 0;
  for (const r of rows) { try { const ed = gridEdits[r.proposal.id]; if (ed?.issues?.length) throw new Error(`${r.proposal.target}: fails citation check`); await api('/api/agent/approve', ed ? { id: r.proposal.id, draft: ed.draft, fingerprint: ed.fingerprint } : { id: r.proposal.id, fingerprint: r.proposal.fingerprint }); delete gridEdits[r.proposal.id]; done++; } catch (e) { toast(e.message); } }
  toast(`Approved ${done} action${done === 1 ? '' : 's'}`); await refresh();
};
// Urgency 0-100: bigger amounts and older/closer-to-deadline items rank higher.
const urgency = (base, amount) => Math.max(1, Math.min(100, Math.round(base + Math.sqrt(amount) * 1.2)));
const daysUntil = (d) => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : 30;

async function refresh() {
  const r = await api('/api/risk');
  const prop = Object.fromEntries(r.proposals.map((p) => [p.id, p]));
  const rows = [
    ...r.disputes.map((d) => ({ key: 'dispute:' + d.dispute_id, type: 'Dispute', demo: d.demo, id: d.dispute_id, who: d.transaction_id,
      detail: `${d.reason.replaceAll('_', ' ').toLowerCase()}${d.stage ? ' · ' + d.stage.toLowerCase() : ''}${d.status && !d.demo ? ' · ' + d.status.toLowerCase().replaceAll('_', ' ') : ''} · respond in ${daysUntil(d.seller_response_due_date)} days`, amount: d.amount,
      urgency: urgency(60 - daysUntil(d.seller_response_due_date) * 3, d.amount), proposal: prop['dispute:' + d.dispute_id] })),
    ...r.invoices.map((i) => ({ key: 'invoice:' + i.id, type: 'Invoice', demo: i.demo, id: i.id, who: i.recipient,
      detail: `${i.days_overdue} days overdue · ${i.memo}`, amount: i.amount,
      urgency: urgency(i.days_overdue * 1.5, i.amount), proposal: prop['invoice:' + i.id] })),
    ...r.holds.map((o) => ({ key: 'hold:' + o.transactionId, type: o.live ? 'Needs tracking' : 'Held funds', demo: o.demo, id: o.transactionId, who: o.buyer,
      detail: o.live ? `${o.item} · paid via PayPal Checkout, no tracking yet` : `${o.item} · held ${o.daysHeld} days`, amount: o.amount,
      urgency: urgency(25 + o.daysHeld * 2, o.amount), proposal: prop['hold:' + o.transactionId] })),
  ];
  window.__ssData = r; window.sellershieldTimeline?.(r);
  try { renderCharts(r); } catch (e) { console.warn('charts', e); }
  riskGrid.setGridOption('rowData', rows);
  riskGrid.setGridOption('pinnedBottomRowData', rows.length ? [{ key: 'total', type: 'Total', amount: rows.reduce((s, x) => s + x.amount, 0), detail: `${rows.length} items` }] : []);
  logGrid.setGridOption('rowData', r.actions);
  logGrid.setGridOption('pinnedBottomRowData', r.actions.length ? [{ by: 'Total', amount: r.actions.reduce((s, a) => s + a.amount, 0), text: `${r.actions.length} actions` }] : []);
  const rd = r.readiness;
  if (rd) {
    const order = { AT_RISK: 0, AGENT_CAN_FIX: 1, WAITING: 2, READY: 3 };
    readyRows = rd.rows.slice().sort((a, b) => order[a.status] - order[b.status]); drawReady();
    $('#fixAll').disabled = !rd.fixable;
    $('#fixAll').textContent = rd.fixable ? `Send tracking to PayPal for ${rd.fixable} sale${rd.fixable === 1 ? '' : 's'}` : 'Nothing for the agent to fix';
    $('#kReady').textContent = `${rd.ready} of ${rd.total}`;
    $('#kReadySub').textContent = (rd.fixable ? `agent can fix ${rd.fixable} more` : `${money(rd.amountReady)} of ${money(rd.amountTotal)}`) + ` · ${rd.avgDaysExposed} days without proof on average`;
  }
  const protectedAmt = r.actions.filter((a) => a.decision !== 'ACCEPT').reduce((s, a) => s + a.amount, 0);
  $('#kRisk').textContent = money(rows.reduce((s, x) => s + x.amount, 0));
  $('#kSaved').textContent = money(protectedAmt);
  $('#kTime').textContent = (r.actions.reduce((s, a) => s + (a.minutesSaved || 0), 0) / 60).toFixed(1);
  $('#kActs').textContent = r.actions.length;
  $('#kReview').textContent = r.proposals.length;
  renderProps(r.proposals, r.actions.length > 0);
}

function renderProps(list, scanned) {
  const box = $('#props');
  if (!list.length) { box.innerHTML = `<div class="empty">${scanned ? 'All clear. Nothing waiting for you.' : 'Click <b>Run agent</b> to review every dispute, invoice and held payment.'}</div>`; return; }
  box.innerHTML = '';
  for (const p of list) {
    const el = document.createElement('div');
    el.className = 'prop';
    const pct = Math.round((p.confidence || 0) * 100);
    el.innerHTML = `<div class="top"><div><span class="tag ${esc(p.decision)}">${esc(p.decision)}</span> <b>${esc(p.kind)}</b> <span class="mute">${esc(p.target)}</span> ${p.demo ? '<span class="tag demo">demo</span>' : ''} <span class="mute">· by ${p.source === 'claude' ? 'Claude' : 'rules'}</span></div>
      <div><b>${money(p.amount)}</b> <span class="mute">· ${pct}% confidence</span><span class="meter"><i style="width:${pct}%"></i></span></div></div>
      <div class="mute">${esc(p.reasoning)}</div>
      ${p.protection ? protBox(p.protection) : ''}
      ${p.records?.length ? recBox(p.records) : ''}
      <textarea aria-label="Draft sent to PayPal">${esc(p.draft)}</textarea>
      <div class="issues"></div>
      <div class="approve-row"><button class="approve">Approve &amp; send to PayPal</button> <button class="ghost skip">Skip</button>${p.kind === 'dispute' ? ' <button class="ghost pack" title="Response, Seller Protection check and cited records in one PDF">Evidence PDF</button>' : ''}
        <span class="fp mute" title="SHA-256 of exactly what will be sent. Editing the draft changes it.">fingerprint <code></code></span></div>`;
    const ok = el.querySelector(".approve"), skip = el.querySelector('.skip'), ta = el.querySelector('textarea');
    let fp = p.fingerprint;
    const show = (f, issues) => {
      fp = f; el.querySelector('.fp code').textContent = f.slice(0, 12);
      el.querySelector('.issues').innerHTML = issues.length
        ? `<div class="issuebox"><b>Citation check failed:</b> fix before sending<ul>${issues.map((i) => `<li><code>${esc(i.code)}</code> ${esc(i.detail)}</li>`).join('')}</ul></div>` : '';
      ok.disabled = issues.length > 0;
    };
    show(p.fingerprint, p.issues || []);
    let t; ta.oninput = () => { ok.disabled = true; clearTimeout(t); t = setTimeout(async () => { const r = await api('/api/agent/check', { id: p.id, draft: ta.value }); show(r.fingerprint, r.issues); }, 250); };
    ok.onclick = async () => {
      ok.disabled = true;
      try { await api('/api/agent/approve', { id: p.id, draft: ta.value, fingerprint: fp }); toast(`Done: ${p.decision.toLowerCase().replace('_', ' ')} on ${p.target}`); await refresh(); }
      catch (e) { toast(e.message); ok.disabled = false; }
    };
    skip.onclick = () => el.remove();
    const pack = el.querySelector('.pack');
    if (pack) pack.onclick = async () => {
      const r = await fetch('/api/agent/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, draft: ta.value }) });
      if (!r.ok) return toast('Could not build the PDF');
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `evidence-${p.target}.pdf`; a.click();
    };
    box.appendChild(el);
  }
}

async function loadStatus() {
  const s = await api('/api/status');
  $('#mode').innerHTML = `<span class="badge ${s.mockPaypal ? '' : 'live'}">PayPal ${s.mockPaypal ? 'mock' : 'sandbox'}</span><span class="badge ${s.mockAi || (s.ai.rules && !s.ai.claude) ? '' : 'live'}" title="${esc(s.ai.lastError ? 'Last Claude error: ' + s.ai.lastError : 'Plans written by Claude vs the rule-based fallback')}">${s.mockAi ? 'AI rules (no key)' : s.ai.rules && !s.ai.claude ? 'Claude failing, using rules' : `Claude live${s.ai.claude ? ` · ${s.ai.claude} plans` : ''}${s.ai.rules ? ` · ${s.ai.rules} fell back` : ''}`}</span>${s.persistence !== 'off' ? `<span class="badge live" title="Orders, proposals and the audit log survive a server restart">State saved (${esc(s.persistence)})</span>` : ''}<span class="badge ${s.channel3 ? 'live' : ''}" title="Product catalog facts for not-as-described disputes">Channel3 ${s.channel3 ? 'live' : 'demo'}</span>`;
  $('#seed').hidden = s.mockPaypal;
  $('#hookUrl').value = s.notifyUrl || '';
  $('#mcpUrl').value = `${location.origin}/api/mcp?ws=${s.workspace}`;
  setAp(s.autopilot);
}
function setAp(a) {
  $('#apOn').checked = a.enabled; $('#apMax').value = a.maxAmount; $('#apConf').value = a.minConfidence;
  $('#apMaxV').textContent = '$' + a.maxAmount; $('#apConfV').textContent = Math.round(a.minConfidence * 100) + '%';
}
$('#hookSave').onclick = async () => { try { const r = await api('/api/notify', { url: $('#hookUrl').value }); toast(r.url ? 'Alerts on' : 'Alerts off'); } catch (e) { toast(e.message); } };
$('#hookTest').onclick = async () => { try { await api('/api/notify/test', {}); toast('Test alert delivered'); } catch (e) { toast(e.message); } };
$('#mcpCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#mcpUrl').value); toast('MCP URL copied'); } catch { $('#mcpUrl').select(); } };
const saveAp = async () => setAp(await api('/api/autopilot', { enabled: $('#apOn').checked, maxAmount: $('#apMax').value, minConfidence: $('#apConf').value }));
$('#apOn').onchange = saveAp; $('#apMax').oninput = $('#apConf').oninput = saveAp;

$('#run').onclick = async () => {
  $('#run').disabled = true; $('#run').textContent = 'Reviewing...';
  $('#props').innerHTML = '<div class="empty">Agent is reading disputes, invoices and held payments...</div>';
  try {
    const r = await api('/api/agent/scan', {});
    if (r.auto.length) toast(`Autopilot handled ${r.auto.length} item${r.auto.length > 1 ? 's' : ''} worth ${money(r.auto.reduce((s, a) => s + a.amount, 0))}`);
    await refresh(); loadStatus();
  } catch (e) { $('#props').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  $('#run').disabled = false; $('#run').textContent = 'Run agent';
};

// One click: the agent proposes a tracking upload for each fixable sale, and this approves those
// exact proposals (each bound to its fingerprint, like any other approval).
$('#fixAll').onclick = async () => {
  $('#fixAll').disabled = true; $('#fixAll').textContent = 'Sending tracking...';
  let done = 0;
  try {
    const r = await api('/api/agent/scan', {});
    for (const p of r.proposals.filter((x) => x.kind === 'hold')) { try { await api('/api/agent/approve', { id: p.id, fingerprint: p.fingerprint }); done++; } catch (e) { toast(e.message); } }
    toast(done ? `Tracking sent to PayPal for ${done} sale${done === 1 ? '' : 's'}` : 'Nothing to send');
  } catch (e) { toast(e.message); }
  await refresh();
};

$('#reset').onclick = async () => { await api('/api/demo/reset', {}); $('#chatlog').innerHTML = ''; $('#feed').innerHTML = '<div class="mute">Waiting for events...</div>'; toast('Demo reset'); await refresh(); };

$('#seed').onclick = async () => {
  $('#seed').disabled = true;
  try { const r = await api('/api/demo/seed', {}); toast(`Created ${r.created.length} real overdue invoices in PayPal sandbox`); await refresh(); }
  catch (e) { toast(e.message); }
  $('#seed').disabled = false;
};

function addMsg(cls, text, steps) {
  const el = document.createElement('div');
  el.className = 'msg ' + cls; el.textContent = text;
  if (steps?.length) { const s = document.createElement('div'); s.className = 'steps'; s.textContent = 'Tools used: ' + steps.map((x) => x.tool + (x.input?.id ? `(${x.input.id})` : '')).join(', '); el.appendChild(s); }
  $('#chatlog').appendChild(el); $('#chatlog').scrollTop = 1e9;
  return el;
}
async function ask(q) {
  if (!q.trim()) return;
  addMsg('me', q); $('#q').value = '';
  const pending = addMsg('bot', 'Thinking...');
  try { const r = await api('/api/agent/chat', { message: q }); pending.remove(); addMsg('bot', r.reply, r.steps); await refresh(); }
  catch (e) { pending.textContent = e.message; }
}
$('#ask').onclick = () => ask($('#q').value);
$('#q').onkeydown = (e) => { if (e.key === 'Enter') ask($('#q').value); };
document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => ask(b.dataset.q)));

const PROT_LABEL = { LIKELY_COVERED: 'Likely covered by Seller Protection', NEEDS_EVIDENCE: 'Coverable, evidence missing', NOT_COVERED: 'Not covered by Seller Protection' };
function recBox(recs) {
  return `<details class="recs"><summary>Evidence records the draft may cite (${recs.length})</summary><ul>${recs.map((r) =>
    `<li><b>${esc(r.ref)}</b> ${esc(r.source)} <code>${esc(r.id)}</code> <span class="mute">${esc(Object.entries(r.fields).map(([k, v]) => `${k}: ${v}`).join(' · '))}</span></li>`).join('')}</ul></details>`;
}
function protBox(pr) {
  return `<div class="prot"><b class="${esc(pr.status)}">${esc(PROT_LABEL[pr.status] || pr.status)}</b> <span class="mute">· ${esc(pr.summary)}</span>
    <ul>${pr.checks.map((c) => `<li class="${c.pass ? 'ok' : 'no'}" data-i="${c.pass ? '✓' : '✗'}">${esc(c.rule)} <span class="mute">(${esc(c.detail)})</span></li>`).join('')}</ul></div>`;
}

// ---------- AG Charts ----------
// Colour is assigned by job. Series identity uses two categorical hues (blue, orange) that were
// checked for colour-blind separation and contrast on both card surfaces. Seller Protection
// status uses the reserved status colours and always ships with a text label and a value.
// Text, axes and grid use the page's text tokens, never a series colour.
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const VIZ = {
  protected: dark ? '#3987e5' : '#2a78d6', atRisk: dark ? '#d95926' : '#eb6834',
  good: '#0ca30c', warning: '#fab219', critical: '#d03b3b', neutral: dark ? '#5d6679' : '#aab2c0',
  surface: css('--card'), ink: css('--ink'), mute: css('--mute'), grid: css('--line'),
};
const usd = (v) => '$' + Math.round(v).toLocaleString();
const usd2 = (v) => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const axisText = { color: VIZ.mute, fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif' };
const quietAxis = { line: { enabled: false }, tick: { enabled: false }, label: axisText };
const moneyAxis = (position) => ({ type: 'number', position, nice: true, ...quietAxis, label: { ...axisText, formatter: ({ value }) => usd(value) },
  gridLine: { style: [{ stroke: VIZ.grid, lineDash: [3, 4] }] } });
const chartTheme = {
  baseTheme: dark ? 'ag-default-dark' : 'ag-default',
  overrides: { common: {
    background: { fill: 'transparent' }, padding: { top: 6, right: 28, bottom: 4, left: 4 },
    legend: { position: 'bottom', spacing: 14, item: { paddingX: 18, marker: { size: 9, shape: 'square' }, label: { color: VIZ.mute, fontSize: 12.5, fontFamily: 'Inter, system-ui, sans-serif' } } },
  } },
};
const tip = (title, rows) => ({ title, content: rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${k}</span><b>${v}</b></div>`).join('') });
let riskChart, coverChart, timeChart;
function renderCharts(r) {
  if (!window.agCharts) return;
  const sum = (xs) => xs.reduce((s, x) => s + x.amount, 0);
  const protectedBy = (k) => r.actions.filter((a) => a.kind === k && a.decision !== 'ACCEPT').reduce((s, a) => s + a.amount, 0);

  // 1. Where the money is stuck: one bar per category, still at risk vs protected by the agent.
  const data = [
    { category: 'Tracking / holds', risk: sum(r.holds), saved: protectedBy('hold') },
    { category: 'Overdue invoices', risk: sum(r.invoices), saved: protectedBy('invoice') },
    { category: 'Disputes', risk: sum(r.disputes), saved: protectedBy('dispute') },
  ];
  const peak = Math.max(1, ...data.map((d) => d.risk + d.saved));
  const bar = (yKey, yName, fill) => ({ type: 'bar', direction: 'horizontal', xKey: 'category', yKey, yName, stacked: true, fill,
    stroke: VIZ.surface, strokeWidth: 2, cornerRadius: 4,
    // Label only segments wide enough to hold the figure; the tooltip and axis carry the rest.
    label: { color: '#fff', fontSize: 12, fontWeight: 600, formatter: ({ value }) => (value / peak >= 0.16 ? usd(value) : '') },
    tooltip: { renderer: ({ datum }) => tip(datum.category, [['Still at risk', usd2(datum.risk)], ['Protected by agent', usd2(datum.saved)]]) } });
  const riskOpts = {
    container: $('#chartRisk'), data, theme: chartTheme,
    series: [bar('saved', 'Protected by agent', VIZ.protected), bar('risk', 'Still at risk', VIZ.atRisk)],
    axes: [{ type: 'category', position: 'left', ...quietAxis, label: { ...axisText, color: VIZ.ink, fontSize: 12.5 }, paddingInner: 0.45, paddingOuter: 0.25 }, moneyAxis('bottom')],
  };

  // 2. Protected over time: one series, so no legend; the title names it.
  const acts = r.actions.filter((a) => a.decision !== 'ACCEPT').slice().sort((a, b) => a.at.localeCompare(b.at));
  let run = 0;
  const timeData = acts.map((a) => { run += a.amount; return { t: new Date(a.at), total: run, amount: a.amount, by: a.by, what: `${a.decision.replaceAll('_', ' ').toLowerCase()} · ${a.kind}` }; });
  $('#timeHero').textContent = usd2(run);
  $('#timeHeroSub').textContent = acts.length ? `across ${acts.length} action${acts.length === 1 ? '' : 's'}` : 'no actions yet';
  const timeOpts = {
    container: $('#chartTime'), data: timeData, theme: chartTheme,
    series: [{ type: 'area', xKey: 't', yKey: 'total', yName: 'Protected (running total)', fill: VIZ.protected, fillOpacity: 0.12, stroke: VIZ.protected, strokeWidth: 2,
      marker: { enabled: true, size: 8, fill: VIZ.protected, stroke: VIZ.surface, strokeWidth: 2 },
      tooltip: { renderer: ({ datum }) => tip(datum.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), [['Added', '+' + usd2(datum.amount)], ['Action', datum.what], ['Triggered by', datum.by], ['Running total', usd2(datum.total)]]) } }],
    axes: [{ type: 'time', position: 'bottom', ...quietAxis, label: axisText, nice: false }, moneyAxis('left')],
    legend: { enabled: false },
    overlays: { noData: { text: 'Approve an action or turn on autopilot to see this grow.' } },
  };

  // 3. Disputes by Seller Protection: one whole split into parts, so a segmented bar, not a donut.
  const byStatus = { LIKELY_COVERED: 0, NEEDS_EVIDENCE: 0, NOT_COVERED: 0, UNCHECKED: 0 };
  const prop = Object.fromEntries(r.proposals.map((p) => [p.target, p]));
  for (const d of r.disputes) byStatus[prop[d.dispute_id]?.protection?.status || 'UNCHECKED'] += d.amount;
  const parts = [
    { key: 'LIKELY_COVERED', name: 'Likely covered', mark: '✓', color: VIZ.good },
    { key: 'NEEDS_EVIDENCE', name: 'Evidence missing', mark: '!', color: VIZ.warning },
    { key: 'NOT_COVERED', name: 'Not covered', mark: '✗', color: VIZ.critical },
    { key: 'UNCHECKED', name: 'Not checked yet', mark: '?', color: VIZ.neutral },
  ];
  const total = sum(r.disputes);
  $('#coverHero').textContent = usd2(total);
  // The legend is plain HTML: swatch, mark, label and amount, so status is never colour alone.
  $('#coverLegend').innerHTML = parts.filter((x) => byStatus[x.key] > 0 || x.key !== 'UNCHECKED').map((x) =>
    `<li><i style="background:${x.color}"></i><span>${x.mark} ${x.name}</span><b>${usd2(byStatus[x.key])}</b><em>${total ? Math.round((byStatus[x.key] / total) * 100) : 0}%</em></li>`).join('');
  const coverOpts = {
    container: $('#chartCover'), data: [{ whole: 'Disputes', ...byStatus }], theme: chartTheme,
    series: parts.map((x) => ({ type: 'bar', direction: 'horizontal', xKey: 'whole', yKey: x.key, yName: x.name, stacked: true, fill: x.color,
      stroke: VIZ.surface, strokeWidth: 2, cornerRadius: 4,
      tooltip: { renderer: ({ datum }) => tip(x.name, [['In dispute', usd2(datum[x.key])], ['Share', (total ? Math.round((datum[x.key] / total) * 100) : 0) + '%']]) } })),
    axes: [{ type: 'category', position: 'left', line: { enabled: false }, tick: { enabled: false }, label: { enabled: false }, paddingInner: 0, paddingOuter: 0 },
      { type: 'number', position: 'bottom', line: { enabled: false }, tick: { enabled: false }, label: { enabled: false }, gridLine: { enabled: false }, nice: false, max: total || 1 }],
    legend: { enabled: false }, padding: { top: 0, right: 0, bottom: 0, left: 0 },
    overlays: { noData: { text: 'No open disputes.' } },
  };
  if (timeChart) timeChart.update(timeOpts); else timeChart = agCharts.AgCharts.create(timeOpts);
  if (riskChart) riskChart.update(riskOpts); else riskChart = agCharts.AgCharts.create(riskOpts);
  if (coverChart) coverChart.update(coverOpts); else coverChart = agCharts.AgCharts.create(coverOpts);
}

function addEvent(e) {
  if (!e.text) return;
  const feed = $('#feed');
  if (feed.querySelector('.mute')) feed.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'ev ' + e.kind;
  el.innerHTML = `<time>${new Date(e.at).toLocaleTimeString()}</time>${esc(e.text)}`;
  feed.prepend(el);
}
api('/api/activity').then((list) => list.slice().reverse().forEach(addEvent)).catch(() => {});
let refreshTimer;
try {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    const e = JSON.parse(m.data); addEvent(e);
    if (e.kind !== 'hello') { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 300); }
  };
} catch { /* live feed is optional */ }
$('#simDispute').onclick = async () => {
  $('#simDispute').disabled = true;
  try { await api('/api/demo/simulate-dispute', {}); } catch (e) { toast(e.message); }
  $('#simDispute').disabled = false;
};

window.ssRefresh = refresh; window.ssToast = toast;
loadStatus().then(refresh);
