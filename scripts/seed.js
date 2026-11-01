// Seeds IIT Roorkee demo users, hardware requests, checkouts, senior inventory, and comments.
// Safe to re-run: skips if users already exist (pass --force to re-seed).
const db = require('../db');

(async () => {
  try {
    const force = process.argv.includes('--force');
    const res = await db.seedDemoData({ force });
    if (!res.seeded) {
      console.log(`Database already has ${res.users} users - skipping seed (use --force to add demo records).`);
      process.exit(0);
    }
    console.log('Seeded IIT Roorkee Campus Component Share demo data.');
    console.log('Demo logins (password: demo1234):');
    console.log('  Junior : riya@ece.iitr.ac.in  (or junior@iitr.ac.in)');
    console.log('  Senior : karan@ece.iitr.ac.in (or senior@iitr.ac.in)');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
})();
