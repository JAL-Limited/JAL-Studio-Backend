const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, encodedHash) {
  const [algorithm, salt, savedHex] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !savedHex) return false;
  const saved = Buffer.from(savedHex, 'hex');
  const candidate = await scrypt(password, salt, saved.length);
  return saved.length === candidate.length && timingSafeEqual(saved, candidate);
}

module.exports = { hashPassword, verifyPassword };
