const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { createRouter } = require('../utils/mini-app');

const router = createRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const filter = req.query.status; // 'active' | 'returned' | undefined
  const list = await db.checkouts.listForUser(req.user.id, filter);
  res.json({ checkouts: list });
});

module.exports = router;
