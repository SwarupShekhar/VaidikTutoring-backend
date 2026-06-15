import * as crypto from 'crypto';

/**
 * Stateless, signed tokens for one-tap email links (MCQ answers + unsubscribe).
 * Format: base64url(payloadJson) + "." + base64url(hmacSha256).
 * No DB lookup needed to validate — the signature proves the link was issued by us.
 */

export type EngagementTokenPayload = {
  user_id: string;
  type: string; // email_events.type — 'mcq_academic' | 'mcq_friction' | 'welcome' | 'breakup' | 'unsubscribe'
  exp: number; // unix seconds
};

function getSecret(): string {
  const secret = process.env.MCQ_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('MCQ_SIGNING_SECRET (or JWT_SECRET) must be set for engagement tokens');
  }
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(data: string): Buffer {
  return crypto.createHmac('sha256', getSecret()).update(data).digest();
}

/** Sign a payload. `ttlDays` defaults to 30. */
export function signEngagementToken(
  payload: Omit<EngagementTokenPayload, 'exp'>,
  ttlDays = 30,
): string {
  const full: EngagementTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60,
  };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  const sig = b64url(hmac(body));
  return `${body}.${sig}`;
}

/**
 * Verify a token. Returns the payload if valid + unexpired, else null.
 * Uses constant-time comparison on the signature.
 */
export function verifyEngagementToken(token: string): EngagementTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = b64url(hmac(body));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: EngagementTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }

  if (!payload?.user_id || !payload?.type || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
