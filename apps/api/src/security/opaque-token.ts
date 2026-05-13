import { createHmac, randomBytes } from 'node:crypto';

export function createOpaqueToken(byteLength = 48): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashOpaqueToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('base64url');
}

