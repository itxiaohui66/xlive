import { describe, expect, it } from 'vitest';
import { defaultPasswordPolicy, hashPassword, validatePassword, verifyPassword } from './password.js';

describe('password policy and hashing', () => {
  it('accepts a compliant password', () => expect(() => validatePassword('ValidPass123', defaultPasswordPolicy)).not.toThrow());
  it.each(['short', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumbersHere'])('rejects non-compliant password %s', value => expect(() => validatePassword(value, defaultPasswordPolicy)).toThrow());
  it('uses salted Argon2id hashes', async () => { const a=await hashPassword('ValidPass123'); const b=await hashPassword('ValidPass123'); expect(a).not.toBe(b); expect(a).toContain('argon2id'); expect(await verifyPassword(a,'ValidPass123')).toBe(true); });
});
