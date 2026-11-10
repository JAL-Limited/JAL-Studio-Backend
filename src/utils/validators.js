const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(10).max(128);
const quantity = z.coerce.number().int().min(1).max(10);

module.exports = { email, objectId, password, quantity, z };
