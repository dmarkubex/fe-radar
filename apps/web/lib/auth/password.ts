import bcrypt from "bcryptjs";

export const BCRYPT_WORK_FACTOR = 12;

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_WORK_FACTOR);
}
