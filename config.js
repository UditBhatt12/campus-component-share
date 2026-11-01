const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env via dotenv if installed, plus built-in parser so .env always loads
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  // Built-in fallback .env loader below
}

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set - using a temporary secret. Set JWT_SECRET in .env for production.');
}

const mongoUser = process.env.MONGO_USER || '';
const mongoPass = process.env.MONGO_PASS || '';
const mongoCluster = process.env.MONGO_CLUSTER || 'cluster0.n8svkhd.mongodb.net';
const mongoDbName = process.env.MONGO_DB_NAME || 'campus_component_share';

let mongoUri = process.env.MONGODB_URI || '';
if (!mongoUri && mongoUser && mongoPass) {
  mongoUri = `mongodb+srv://${encodeURIComponent(mongoUser)}:${encodeURIComponent(mongoPass)}@${mongoCluster}/${mongoDbName}?retryWrites=true&w=majority&appName=Cluster0`;
}

const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || 'iitr.ac.in')
  .split(',')
  .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: secret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  MONGO_USER: mongoUser,
  MONGO_PASS: mongoPass,
  MONGO_CLUSTER: mongoCluster,
  MONGO_DB_NAME: mongoDbName,
  MONGODB_URI: mongoUri,
  MONGODB_LOCAL_URI: process.env.MONGODB_LOCAL_URI || `mongodb://127.0.0.1:27017/${mongoDbName}`,
  DB_AUTO_FALLBACK: process.env.DB_AUTO_FALLBACK !== 'false',
  DATA_FILE: process.env.DATA_FILE || path.join(__dirname, 'data', 'campus-db.json'),
  ENFORCE_CAMPUS_EMAIL: process.env.ENFORCE_CAMPUS_EMAIL !== 'false',
  ALLOWED_EMAIL_DOMAINS: allowedDomains,
  CAMPUS_NAME: process.env.CAMPUS_NAME || 'IIT Roorkee',
};
