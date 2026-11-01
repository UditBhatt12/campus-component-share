const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { createRouter } = require('../utils/mini-app');

const router = createRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await db.notifications.listForUser(req.user.id);
  res.json(result);
});

router.post('/read-all', async (req, res) => {
  await db.notifications.markAllRead(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
