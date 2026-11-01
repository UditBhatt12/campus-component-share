const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRouter } = require('../utils/mini-app');
const v = require('../utils/validate');

const router = createRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const q = req.query.q || '';
  const category = req.query.category || 'all';
  const mine = req.query.mine === '1';
  const availableOnly = req.query.all !== '1';
  const items = await db.inventory.list({ q, category, mine, availableOnly }, req.user);
  res.json({ items, categories: v.CATEGORIES });
});

router.post('/', requireRole('senior'), async (req, res) => {
  const b = req.body || {};
  const component = v.text(b.component, 'Component name', { min: 2, max: 100 });
  const category = b.category ? v.oneOf(b.category, 'Category', v.CATEGORIES) : 'Microcontrollers';
  const quantity = v.int(b.quantity ?? 1, 'Quantity', { min: 1, max: 50 });
  const condition = b.condition ? v.oneOf(b.condition, 'Condition', ['New', 'Good', 'Fair']) : 'Good';
  const share_type = b.share_type ? v.oneOf(b.share_type, 'Share type', ['lend', 'rent', 'both']) : 'lend';
  const rent_amount =
    share_type === 'rent' || share_type === 'both'
      ? v.int(b.rent_amount, 'Rent amount', { min: 1, max: 100000 })
      : null;
  const description = v.text(b.description, 'Description / specs', { required: false, max: 500 });

  const item = await db.inventory.create(req.user, {
    component,
    category,
    quantity,
    condition,
    share_type,
    rent_amount,
    description,
  });
  res.status(201).json({ item });
});

router.patch('/:id/toggle', requireRole('senior'), async (req, res) => {
  const updated = await db.inventory.toggleAvailable(req.params.id, req.user);
  if (!updated) return res.status(404).json({ error: 'Inventory item not found' });
  res.json({ item: updated });
});

router.delete('/:id', requireRole('senior'), async (req, res) => {
  const ok = await db.inventory.remove(req.params.id, req.user);
  if (!ok) return res.status(404).json({ error: 'Inventory item not found' });
  res.json({ ok: true });
});

module.exports = router;
