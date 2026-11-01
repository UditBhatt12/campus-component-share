const { ENFORCE_CAMPUS_EMAIL, ALLOWED_EMAIL_DOMAINS, CAMPUS_NAME } = require('../config');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function text(value, field, { min = 1, max = 200, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  const v = value.trim();
  if (required && v.length < min) throw new ValidationError(`${field} must be at least ${min} characters`);
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v || null;
}

function int(value, field, { min = 0, max = 1e6, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}

function oneOf(value, field, options) {
  if (!options.includes(value)) throw new ValidationError(`${field} must be one of: ${options.join(', ')}`);
  return value;
}

function isAllowedCampusEmail(email) {
  if (!ENFORCE_CAMPUS_EMAIL || !ALLOWED_EMAIL_DOMAINS.length) return true;
  const parts = String(email).toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  return ALLOWED_EMAIL_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function campusEmail(value, field = 'Email') {
  const raw = text(value, field, { max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    throw new ValidationError('Enter a valid email address');
  }
  if (!isAllowedCampusEmail(raw)) {
    const exampleDomains = ALLOWED_EMAIL_DOMAINS.map((d) => `@${d} or @branch.${d}`).join(', ');
    throw new ValidationError(`Only ${CAMPUS_NAME} campus emails (${exampleDomains}) are allowed`);
  }
  return raw;
}

const today = () => new Date().toISOString().slice(0, 10);

const CATEGORIES = [
  'Microcontrollers',
  'Sensors',
  'Single-Board Computers',
  'Power & Motors',
  'Communication & RF',
  'Tools & Prototyping',
  'Displays & Audio',
  'Other',
];

const IITR_HOSTELS = [
  'Cautley Bhawan',
  'Govind Bhawan',
  'Rajendra Bhawan',
  'Radhakrishnan Bhawan',
  'Ranjit Singh Bhawan',
  'Ravindra Bhawan',
  'Jawahar Bhawan',
  'Azad Bhawan',
  'Kasturba Bhawan',
  'Sarojini Bhawan',
  'Himalaya Bhawan',
  'Vigyan Kunj',
  'Day Scholar / Off-Campus',
];

module.exports = {
  ValidationError,
  text,
  int,
  date,
  oneOf,
  campusEmail,
  isAllowedCampusEmail,
  today,
  CATEGORIES,
  IITR_HOSTELS,
};
