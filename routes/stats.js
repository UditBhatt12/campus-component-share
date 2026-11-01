const db = require('../db');
const { createRouter } = require('../utils/mini-app');

const router = createRouter();

router.get('/', async (req, res) => {
  const s = await db.stats.getPublicStats();
  res.json(s);
});

module.exports = router;
