// Dependency-free PDF writer for the dispute evidence pack (A4, Helvetica, vector shapes).
// One document a seller can keep or attach: a summary of the case, the response PayPal receives,
// the Seller Protection checklist, and every record the response cites.

// ---------- text helpers ----------
// Helvetica advance widths for ASCII 32..126 (1/1000 em), so text can be wrapped and right-aligned.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const clean = (t) => String(t ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
  .replace(/[^\x20-\x7E\n]/g, '?');
const esc = (t) => clean(t).replace(/([\\()])/g, '\\$1');
const width = (t, size, bold) => [...clean(t)].reduce((s, ch) => s + (W[ch.charCodeAt(0) - 32] ?? 556), 0) / 1000 * size * (bold ? 1.07 : 1);

function wrap(text, maxWidth, size, bold = false) {
  const out = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (width(word, size, bold) > maxWidth) { // a single token wider than the column (long ids): hard-break it
        let n = word.length;
        while (n > 1 && width(word.slice(0, n), size, bold) > maxWidth) n--;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, n)); word = word.slice(n);
      }
      const next = line ? `${line} ${word}` : word;
      if (width(next, size, bold) > maxWidth) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

// ---------- palette ----------
const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const C = { ink: hex('#0d1321'), mute: hex('#566074'), line: hex('#dfe4ec'), soft: hex('#f4f6fa'), white: hex('#ffffff'), accent: hex('#2f5bea'),
  good: hex('#0f7a3d'), goodSoft: hex('#e4f5ea'), warn: hex('#9a5200'), warnSoft: hex('#fff2df'), bad: hex('#b3261e'), badSoft: hex('#fdecea') };
const STATUS = {
  LIKELY_COVERED: { label: 'Likely covered by Seller Protection', fg: C.good, bg: C.goodSoft },
  NEEDS_EVIDENCE: { label: 'Coverable, evidence missing', fg: C.warn, bg: C.warnSoft },
  NOT_COVERED: { label: 'Not covered by Seller Protection', fg: C.bad, bg: C.badSoft },
};

// ---------- page model ----------
const PW = 595, PH = 842, M = 48, CW = PW - 2 * M, BOTTOM = 64;

class Doc {
  constructor() { this.pages = [[]]; this.y = PH - M; }
  get ops() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push([]); this.y = PH - M; }
  need(h) { if (this.y - h < BOTTOM) this.newPage(); }
  rect(x, y, w, h, fill) { this.ops.push(`${fill} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); }
  rule(x1, y, x2, color = C.line, w = 0.7) { this.ops.push(`${color} RG ${w} w ${x1.toFixed(1)} ${y.toFixed(1)} m ${x2.toFixed(1)} ${y.toFixed(1)} l S`); }
  dot(cx, cy, r, fill) { const k = r * 0.5523; this.ops.push(`${fill} rg ${cx - r} ${cy} m ${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r} c ${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy} c ${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r} c ${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy} c f`); }
  // A tick or a cross, drawn as strokes so no symbol font is needed.
  mark(cx, cy, pass) {
    this.dot(cx, cy, 6, pass ? C.good : C.bad);
    this.ops.push(`${C.white} RG 1.4 w 1 J ${pass ? `${cx - 2.8} ${cy} m ${cx - 0.8} ${cy - 2.2} l ${cx + 3} ${cy + 2.4} l` : `${cx - 2.3} ${cy - 2.3} m ${cx + 2.3} ${cy + 2.3} l ${cx - 2.3} ${cy + 2.3} m ${cx + 2.3} ${cy - 2.3} l`} S`);
  }
  text(x, y, t, { size = 10, bold = false, color = C.ink, align = 'left' } = {}) {
    const tx = align === 'right' ? x - width(t, size, bold) : x;
    this.ops.push(`BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td (${esc(t)}) Tj ET`);
  }
  // Wrapped paragraph at the cursor; returns nothing, advances y, breaks pages as needed.
  para(t, { x = M, w = CW, size = 10, bold = false, color = C.ink, lead = 1.45 } = {}) {
    for (const line of wrap(t, w, size, bold)) { this.need(size * lead); this.y -= size * lead; this.text(x, this.y + size * 0.28, line, { size, bold, color }); }
  }
  heading(n, title) {
    this.need(46); this.y -= 26;
    this.rect(M, this.y - 3, 18, 18, C.accent);
    this.text(M + 9 - width(String(n), 10, true) / 2, this.y + 2.5, String(n), { size: 10, bold: true, color: C.white });
    this.text(M + 26, this.y + 1.5, title, { size: 13, bold: true });
    this.y -= 10; this.rule(M, this.y, PW - M); this.y -= 4;
  }
  build(footer) {
    const objs = []; const add = (b) => { objs.push(b); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((ops, i) => {
      const foot = [`${C.line} RG 0.7 w ${M} 46 m ${PW - M} 46 l S`,
        `BT ${C.mute} rg /F1 8 Tf ${M} 33 Td (${esc(footer)}) Tj ET`,
        `BT ${C.mute} rg /F1 8 Tf ${(PW - M - width(`Page ${i + 1} of ${this.pages.length}`, 8)).toFixed(1)} 33 Td (Page ${i + 1} of ${this.pages.length}) Tj ET`];
      const stream = [...ops, ...foot].join('\n');
      const c = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
  }
}

const CLAIMS = { MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received', MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described', UNAUTHORISED: 'Unauthorised payment' };
const words = (s) => String(s ?? '').replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// Evidence pack for one dispute proposal. `text` is the response exactly as it will be sent.
export function disputePack(p, text) {
  const d = new Doc();
  const prot = p.protection;
  const first = (p.records || [])[0]?.fields || {};
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  // Header band
  d.rect(0, PH - 104, PW, 104, C.ink);
  d.rect(0, PH - 107, PW, 3, C.accent);
  d.text(M, PH - 38, 'SELLERSHIELD', { size: 9, bold: true, color: hex('#9db4ff') });
  d.text(M, PH - 64, 'Dispute evidence pack', { size: 22, bold: true, color: C.white });
  d.text(M, PH - 84, `Prepared for PayPal dispute ${p.target}`, { size: 10, color: hex('#c9d2e3') });
  d.text(PW - M, PH - 38, generated, { size: 9, color: hex('#c9d2e3'), align: 'right' });
  d.text(PW - M, PH - 64, p.decision === 'ACCEPT' ? 'Seller accepts the claim' : 'Seller contests the claim', { size: 11, bold: true, color: C.white, align: 'right' });
  d.y = PH - 107;

  // Case summary: four facts in a row
  const facts = [['DISPUTE', p.target], ['AMOUNT', first.amount || `$${Number(p.amount || 0).toFixed(2)}`], ['CLAIM', CLAIMS[first.reason] || words(first.reason || 'Unknown')], ['RESPOND BY', first.due || 'Not given']];
  const colW = CW / 4;
  d.y -= 30;
  facts.forEach(([k, v], i) => {
    const x = M + i * colW;
    d.text(x, d.y, k, { size: 7.5, bold: true, color: C.mute });
    const lines = wrap(v, colW - 12, 11, true).slice(0, 2);
    lines.forEach((l, j) => d.text(x, d.y - 15 - j * 13, l, { size: 11, bold: true }));
  });
  d.y -= 46;

  // Seller Protection verdict
  if (prot) {
    const st = STATUS[prot.status] || { label: words(prot.status), fg: C.mute, bg: C.soft };
    const lines = wrap(prot.summary, CW - 34, 9.5);
    const h = 30 + lines.length * 13.5;
    d.rect(M, d.y - h, CW, h, st.bg); d.rect(M, d.y - h, 4, h, st.fg);
    d.text(M + 18, d.y - 19, st.label, { size: 11.5, bold: true, color: st.fg });
    lines.forEach((l, i) => d.text(M + 18, d.y - 35 - i * 13.5, l, { size: 9.5, color: C.ink }));
    d.y -= h + 4;
  }

  // 1. Response
  d.heading(1, p.decision === 'ACCEPT' ? 'Message to the buyer' : 'Response submitted to PayPal');
  d.y -= 4;
  d.para(text, { size: 10.5, lead: 1.5 });
  d.y -= 6;
  d.para('Bracketed references such as [R2] point to the numbered records in section 3. Every amount, date and ID in this response was checked against the record it cites before sending.', { size: 8.5, color: C.mute });

  // 2. Checklist
  if (prot) {
    d.heading(2, 'Seller Protection checklist');
    for (const c of prot.checks) {
      const detail = wrap(c.detail, CW - 30, 9);
      const h = 20 + detail.length * 12;
      d.need(h + 4); d.y -= h;
      d.mark(M + 8, d.y + h - 12, c.pass);
      d.text(M + 24, d.y + h - 15.5, c.rule, { size: 10.5, bold: true });
      detail.forEach((l, i) => d.text(M + 24, d.y + h - 29 - i * 12, l, { size: 9, color: C.mute }));
      d.rule(M, d.y, PW - M, C.line, 0.5);
    }
    d.y -= 8;
    d.para(prot.note, { size: 8.5, color: C.mute });
  }

  // 3. Records
  d.heading(prot ? 3 : 2, 'Records cited');
  const recs = p.records || [];
  if (!recs.length) { d.y -= 6; d.para('No records were cited.', { color: C.mute }); }
  for (const r of recs) {
    const rows = Object.entries(r.fields).map(([k, v]) => [words(k), wrap(String(v), CW - 170, 9.5)]);
    const bodyH = rows.reduce((s, [, ls]) => s + 8 + ls.length * 12.5, 0);
    d.need(Math.min(bodyH + 40, 220)); d.y -= 30;
    const chipW = width(r.ref, 9, true) + 14;
    d.rect(M, d.y - 3, chipW, 17, C.ink);
    d.text(M + 7, d.y + 2, r.ref, { size: 9, bold: true, color: C.white });
    d.text(M + chipW + 9, d.y + 1.5, r.source, { size: 11, bold: true });
    d.text(PW - M, d.y + 2, r.id || '', { size: 9, color: C.mute, align: 'right' });
    d.y -= 8;
    for (const [k, ls] of rows) {
      const h = 8 + ls.length * 12.5;
      d.need(h); d.y -= h;
      d.rule(M, d.y + h, PW - M, C.line, 0.5);
      d.text(M + 8, d.y + h - 14, k, { size: 9, color: C.mute });
      ls.forEach((l, i) => d.text(M + 160, d.y + h - 14 - i * 12.5, l, { size: 9.5 }));
    }
    d.rule(M, d.y, PW - M, C.line, 0.5);
  }

  return d.build(`Generated by SellerShield  |  Dispute ${p.target}${p.fingerprint ? `  |  Approval fingerprint ${p.fingerprint.slice(0, 16)}` : ''}`);
}
