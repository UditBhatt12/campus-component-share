const db = require('../db');
const { JWT_SECRET, JWT_EXPIRES_IN, CAMPUS_NAME, ALLOWED_EMAIL_DOMAINS } = require('../config');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword, signToken } = require('../utils/crypto-auth');
const { createRouter } = require('../utils/mini-app');
const v = require('../utils/validate');

const router = createRouter();

const publicUser = (u) => ({
  id: String(u.id),
  name: u.name,
  email: u.email,
  role: u.role,
  enrollment_no: u.enrollment_no || null,
  branch: u.branch || null,
  year: u.year ?? null,
  phone: u.phone || null,
  hostel: u.hostel || null,
  bio: u.bio || null,
  reputation: u.reputation || 0,
});

const sign = (user) => signToken({ id: String(user.id) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

router.post('/register', async (req, res) => {
  const b = req.body || {};
  const name = v.text(b.name, 'Name', { min: 2, max: 80 });
  const email = v.campusEmail(b.email, 'Email');
  const password = v.text(b.password, 'Password', { min: 8, max: 100 });
  const role = v.oneOf(b.role, 'Role', ['junior', 'senior']);
  const enrollment_no = v.text(b.enrollment_no, 'Enrollment number', { required: false, max: 20 });
  const branch = v.text(b.branch, 'Branch', { required: false, max: 60 });
  const year = v.int(b.year, 'Year', { min: 1, max: 6, required: false });
  const phone = v.text(b.phone, 'Phone', { required: false, max: 20 });
  const hostel = v.text(b.hostel, 'Hostel / room', { required: false, max: 80 });
  const bio = v.text(b.bio, 'Bio', { required: false, max: 300 });

  const existing = await db.users.findByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this campus email already exists' });
  }

  const password_hash = hashPassword(password);
  const user = await db.users.create({
    name,
    email,
    password_hash,
    role,
    enrollment_no,
    branch,
    year,
    phone,
    hostel,
    bio,
  });

  await db.notifications.create(
    user.id,
    `Welcome to ${CAMPUS_NAME} Component Share! ${role === 'junior' ? 'Post a component request or browse the Parts Catalog.' : 'Browse open requests or list your idle components in the Parts Catalog.'}`,
    '#/'
  );

  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const user = await db.users.findByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: publicUser(req.user),
    campus: { name: CAMPUS_NAME, allowed_domains: ALLOWED_EMAIL_DOMAINS, hostels: v.IITR_HOSTELS },
  });
});

router.put('/me', requireAuth, async (req, res) => {
  const b = req.body || {};
  const name = v.text(b.name, 'Name', { min: 2, max: 80 });
  const enrollment_no = v.text(b.enrollment_no, 'Enrollment number', { required: false, max: 20 });
  const branch = v.text(b.branch, 'Branch', { required: false, max: 60 });
  const year = v.int(b.year, 'Year', { min: 1, max: 6, required: false });
  const phone = v.text(b.phone, 'Phone', { required: false, max: 20 });
  const hostel = v.text(b.hostel, 'Hostel / room', { required: false, max: 80 });
  const bio = v.text(b.bio, 'Bio', { required: false, max: 300 });

  const updated = await db.users.update(req.user.id, {
    name,
    enrollment_no,
    branch,
    year,
    phone,
    hostel,
    bio,
  });
  res.json({ user: publicUser(updated) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const b = req.body || {};
  const current_password = String(b.current_password || '');
  const new_password = v.text(b.new_password, 'New password', { min: 8, max: 100 });

  const fullUser = await db.users.findById(req.user.id);
  if (!fullUser || !verifyPassword(current_password, fullUser.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const password_hash = hashPassword(new_password);
  await db.users.update(req.user.id, { password_hash });
  res.json({ ok: true, message: 'Password updated successfully' });
});

module.exports = router;
