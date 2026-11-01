const path = require('path');
const { PORT, CAMPUS_NAME, ALLOWED_EMAIL_DOMAINS } = require('./config');
const db = require('./db');
const { createApp } = require('./utils/mini-app');

const app = createApp();

// API Routes
app.use('/api/auth', app._authLimiter, require('./routes/auth'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/checkouts', require('./routes/checkouts'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/stats', require('./routes/stats'));

app.get('/api/health', async (req, res) => {
  await db.connect();
  res.json({
    status: 'ok',
    campus: CAMPUS_NAME,
    allowed_email_domains: ALLOWED_EMAIL_DOMAINS,
    database: db.getHealth(),
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Static Frontend
app.serveStatic(path.join(__dirname, 'public'));

// Global Error Handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
});

async function bootstrap() {
  await db.connect();
  if (process.env.DATA_FILE !== ':memory:') {
    await db.seedDemoData();
  }
  app.listen(PORT, () => {
    console.log(`Campus Component Share (${CAMPUS_NAME}) running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
