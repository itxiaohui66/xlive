import argon2 from 'argon2';
import { AppError } from './errors.js';

export type PasswordPolicy = {
  minLength: number; maxLength: number; uppercase: boolean; lowercase: boolean; number: boolean; special: boolean;
};

export const defaultPasswordPolicy: PasswordPolicy = { minLength: 8, maxLength: 64, uppercase: true, lowercase: true, number: true, special: false };

export function validatePassword(password: string, policy: PasswordPolicy): void {
  const failures: string[] = [];
  if (password.length < policy.minLength) failures.push(`至少 ${policy.minLength} 位`);
  if (password.length > policy.maxLength) failures.push(`最多 ${policy.maxLength} 位`);
  if (policy.uppercase && !/[A-Z]/.test(password)) failures.push('包含大写字母');
  if (policy.lowercase && !/[a-z]/.test(password)) failures.push('包含小写字母');
  if (policy.number && !/\d/.test(password)) failures.push('包含数字');
  if (policy.special && !/[^A-Za-z0-9]/.test(password)) failures.push('包含特殊字符');
  if (failures.length) throw new AppError('PASSWORD_POLICY_VIOLATION', `密码必须${failures.join('、')}`);
}

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
