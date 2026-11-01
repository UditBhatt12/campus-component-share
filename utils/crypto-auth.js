const crypto = require('crypto');

let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch {
  bcrypt = null;
}

let jwtLib = null;
try {
  jwtLib = require('jsonwebtoken');
} catch {
  jwtLib = null;
}

function hashPassword(password) {
  if (bcrypt) {
    return bcrypt.hashSync(password, 10);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt$')) {
    const [, salt, key] = storedHash.split('$');
    if (!salt || !key) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(key, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  }
  if (bcrypt) {
    return bcrypt.compareSync(password, storedHash);
  }
  return false;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function parseExpiresIn(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn;
  const m = /^(\d+)([smhd])$/.exec(String(expiresIn || '7d'));
  if (!m) return 7 * 86400;
  const n = Number(m[1]);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return n * unit;
}

function signToken(payload, secret, { expiresIn = '7d' } = {}) {
  if (jwtLib) {
    return jwtLib.sign(payload, secret, { expiresIn });
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + parseExpiresIn(expiresIn) };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(body))}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${unsigned}.${sig}`;
}

function verifyToken(token, secret) {
  if (jwtLib) {
    return jwtLib.verify(token, secret);
  }
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [h, p, s] = parts;
  const unsigned = `${h}.${p}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (s !== expectedSig) throw new Error('Invalid signature');
  const payload = JSON.parse(base64UrlDecode(p));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('Token expired');
  return payload;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
};
