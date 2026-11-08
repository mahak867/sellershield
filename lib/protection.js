// PayPal Seller Protection eligibility check.
// Deterministic, so the agent's advice rests on PayPal's published rules, not on model guesses.
// Sources: PayPal Seller Protection policy (paypal.com/legalhub/seller-protection).
// - "Item not received" and "unauthorized" claims can be covered when the seller ships to the
//   address on the Transaction Details page and has online, verifiable proof of delivery
//   (tracking number, delivered status and date, matching address).
// - "Significantly not as described" claims are NOT covered by Seller Protection.
// - Missing PayPal's response deadline can make a seller ineligible.
// Rules vary by country; this models the general case and says so in its output.

const INR = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
const UNAUTH = 'UNAUTHORISED'; // PayPal spells it this way in the Disputes API
const SNAD = 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';

const daysUntil = (d) => (d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null);

const CATEGORY = { [INR]: 'ITEM_NOT_RECEIVED' };

// paypalFlag: PayPal's own seller_protection from the capture ({ status, disputeCategories }).
// It is a snapshot of the data PayPal has, not a ruling, so it can only lower our verdict.
export function assessProtection(dispute, order, paypalFlag) {
  const checks = [];
  const add = (rule, pass, detail) => checks.push({ rule, pass, detail });
  const reason = dispute?.reason || '';
  const left = daysUntil(dispute?.seller_response_due_date);

  add('Respond before PayPal deadline', left === null || left > 0,
    left === null ? 'No deadline returned' : left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'Deadline passed');

  if (left !== null && left <= 0) {
    return finish('NOT_COVERED', checks, 'The response deadline has passed, so PayPal can rule against the seller.');
  }

  if (reason === SNAD) {
    add('Claim type covered by Seller Protection', false, '"Not as described" claims are excluded from Seller Protection');
    return finish('NOT_COVERED', checks, 'Seller Protection does not cover "not as described". Winning depends on listing accuracy and your evidence.');
  }

  const typeOk = reason === INR || reason.startsWith('UNAUTHORI');
  add('Claim type covered by Seller Protection', typeOk, typeOk ? (reason === INR ? 'Item not received is coverable' : 'Unauthorized payment is coverable') : `Reason ${reason || 'unknown'} is not a covered type`);
  if (!typeOk) return finish('NOT_COVERED', checks, 'This claim type is outside Seller Protection.');

  add('Verifiable online tracking number', !!order?.trackingNumber, order?.trackingNumber ? `${order.carrier} ${order.trackingNumber}` : 'No tracking on file');
  add('Carrier shows "delivered" with a date', !!order?.delivered, order?.delivered ? `Delivered ${order.delivered}` : 'Not marked delivered yet');
  add('Shipped to address on the PayPal transaction', order?.addressMatches !== false,
    order?.addressMatches === false ? 'Shipping address differs from the PayPal transaction address' : 'Matches transaction address');
  if (order?.signature) add('Signature confirmation (strengthens proof)', true, 'Recipient signed');

  if (paypalFlag?.status) {
    const cat = reason.startsWith('UNAUTHORI') ? 'UNAUTHORIZED_TRANSACTION' : CATEGORY[reason];
    const cats = paypalFlag.disputeCategories || paypalFlag.dispute_categories || [];
    const ok = paypalFlag.status !== 'NOT_ELIGIBLE' && (!cats.length || cats.includes(cat));
    add("PayPal's own eligibility flag on the capture", ok,
      `${paypalFlag.status}${cats.length ? ` for ${cats.join(', ').toLowerCase().replaceAll('_', ' ')}` : ''} (PayPal's snapshot of declared data)`);
  }

  const required = checks.filter((c) => !c.rule.startsWith('Signature'));
  const failed = required.filter((c) => !c.pass);
  if (!failed.length) return finish('LIKELY_COVERED', checks, 'Meets the Seller Protection proof requirements. Submit the proof of delivery.');
  const fixable = failed.every((c) => /tracking|delivered/i.test(c.rule));
  // (A failed PayPal flag is not fixable by the seller, so it makes the case NOT_COVERED.)
  return finish(fixable ? 'NEEDS_EVIDENCE' : 'NOT_COVERED', checks,
    fixable ? `Missing: ${failed.map((c) => c.rule.toLowerCase()).join('; ')}. Get it from the carrier before the deadline.`
      : `Fails: ${failed.map((c) => c.rule.toLowerCase()).join('; ')}.`);
}

function finish(status, checks, summary) {
  return { status, checks, summary, note: 'General PayPal Seller Protection rules; eligibility varies by country.' };
}

export const REASONS = { INR, UNAUTH, SNAD };
