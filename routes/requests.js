const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRouter } = require('../utils/mini-app');
const v = require('../utils/validate');

const router = createRouter();
router.use(requireAuth);

// List / search the feed
router.get('/', async (req, res) => {
  const status = req.query.status || 'open';
  if (status !== 'all') {
    v.oneOf(status, 'status', ['open', 'claimed', 'checked_out', 'returned', 'cancelled']);
  }
  const category = req.query.category || 'all';
  const mine = req.query.mine === '1';
  const q = req.query.q || '';

  const list = await db.requests.list({ status, category, mine, q }, req.user);
  res.json({ requests: list, categories: v.CATEGORIES });
});

// Create a request (juniors)
router.post('/', requireRole('junior'), async (req, res) => {
  const b = req.body || {};
  const title = v.text(b.title, 'Title', { min: 4, max: 120 });
  const component = v.text(b.component, 'Component', { min: 2, max: 100 });
  const category = b.category ? v.oneOf(b.category, 'Category', v.CATEGORIES) : 'Microcontrollers';
  const quantity = v.int(b.quantity ?? 1, 'Quantity', { min: 1, max: 50 });
  const project_scope = v.text(b.project_scope, 'Project scope', { min: 10, max: 1000 });
  const needed_from = v.date(b.needed_from, 'Needed from');
  const needed_until = v.date(b.needed_until, 'Needed until');
  if (needed_until < needed_from) throw new v.ValidationError('"Needed until" cannot be before "needed from"');
  if (needed_until < v.today()) throw new v.ValidationError('"Needed until" is already in the past');

  const created = await db.requests.create(
    {
      title,
      component,
      category,
      quantity,
      project_scope,
      needed_from,
      needed_until,
      inventory_id: b.inventory_id || null,
    },
    req.user
  );
  res.status(201).json({ request: created });
});

router.get('/:id', async (req, res) => {
  const request = await db.requests.findById(req.params.id, req.user);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const comments = await db.comments.listForRequest(req.params.id);
  res.json({ request, comments });
});

// Senior claims an open request
router.post('/:id/claim', requireRole('senior'), async (req, res) => {
  const b = req.body || {};
  const claim_type = v.oneOf(b.claim_type || 'lend', 'Claim type', ['lend', 'rent']);
  const rent_amount = claim_type === 'rent' ? v.int(b.rent_amount, 'Rent amount', { min: 1, max: 100000 }) : null;
  const claim_note = v.text(b.claim_note, 'Note', { required: false, max: 500 });

  const updated = await db.requests.claim(req.params.id, req.user, {
    claim_type,
    rent_amount,
    claim_note,
  });
  if (!updated) return res.status(409).json({ error: 'This request is no longer open' });
  res.json({ request: updated });
});

// Senior backs out before handing over
router.post('/:id/unclaim', requireRole('senior'), async (req, res) => {
  const updated = await db.requests.unclaim(req.params.id, req.user);
  if (!updated) return res.status(409).json({ error: 'You cannot release this request' });
  res.json({ request: updated });
});

// Junior cancels their own request (before handover)
router.post('/:id/cancel', async (req, res) => {
  const updated = await db.requests.cancel(req.params.id, req.user);
  if (!updated) return res.status(409).json({ error: 'This request cannot be cancelled' });
  res.json({ request: updated });
});

// Lender records the handover -> creates a checkout
router.post('/:id/handover', requireRole('senior'), async (req, res) => {
  const b = req.body || {};
  const expected_return = v.date(b.expected_return, 'Expected return date');
  if (expected_return < v.today()) throw new v.ValidationError('Expected return date cannot be in the past');
  const condition_note = v.text(b.condition_note, 'Condition note', { required: false, max: 300 });

  const updated = await db.requests.handover(req.params.id, req.user, {
    expected_return,
    condition_note,
  });
  if (!updated) return res.status(409).json({ error: 'Only the claiming senior can hand over a claimed request' });
  res.json({ request: updated });
});

// Junior confirms receiving the hardware
router.post('/:id/confirm-receipt', requireRole('junior'), async (req, res) => {
  const updated = await db.requests.confirmReceipt(req.params.id, req.user);
  if (!updated) return res.status(409).json({ error: 'Only the borrowing junior can confirm receipt' });
  res.json({ request: updated });
});

// Lender confirms the hardware came back
router.post('/:id/return', requireRole('senior'), async (req, res) => {
  const b = req.body || {};
  const condition_note = v.text(b.condition_note, 'Return condition note', { required: false, max: 300 });
  const updated = await db.requests.returnHardware(req.params.id, req.user, { condition_note });
  if (!updated) return res.status(409).json({ error: 'Only the lender can mark an active checkout as returned' });
  res.json({ request: updated });
});

// Comments / Discussion on a request
router.get('/:id/comments', async (req, res) => {
  const comments = await db.comments.listForRequest(req.params.id);
  res.json({ comments });
});

router.post('/:id/comments', async (req, res) => {
  const reqDoc = await db.requests.findById(req.params.id, req.user);
  if (!reqDoc) return res.status(404).json({ error: 'Request not found' });
  const body = v.text((req.body || {}).body, 'Comment', { min: 1, max: 500 });
  const comment = await db.comments.create(req.params.id, req.user, body);
  res.status(201).json({ comment });
});

module.exports = router;
