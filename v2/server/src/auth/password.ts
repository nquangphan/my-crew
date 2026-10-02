import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const params = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, params, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  if (typeof password !== 'string' || password.length < 12) throw new Error('PASSWORD_TOO_SHORT');
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{64}$/.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
