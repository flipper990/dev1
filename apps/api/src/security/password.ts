import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);

const PASSWORD_HASH_ALGO = 'scrypt';
const SCRYPT_KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, SCRYPT_KEY_LEN) as Buffer;
  return `${PASSWORD_HASH_ALGO}$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const parts = passwordHash.split('$');
  if (parts.length !== 3) return false;
  const [algorithm, salt, digest] = parts;
  if (algorithm !== PASSWORD_HASH_ALGO || !salt || !digest) return false;
  const derived = await scrypt(password, salt, SCRYPT_KEY_LEN) as Buffer;
  const expected = Buffer.from(digest, 'base64url');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

