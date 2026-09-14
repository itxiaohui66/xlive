import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, sha256 } from './crypto.js';
describe('secret protection',()=>{it('uses authenticated encryption',()=>{const secret='unit-test-key-that-is-long-enough',plain='smtp-password';const cipher=encrypt(plain,secret);expect(cipher).not.toContain(plain);expect(decrypt(cipher,secret)).toBe(plain)});it('hashes deterministically',()=>expect(sha256('a')).toBe(sha256('a')))});
