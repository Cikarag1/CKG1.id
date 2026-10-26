import { AppError } from './validation.js';

const SESSION_HOURS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      ...extraHeaders,
    },
  });
}

export function parseCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const segment of cookie.split(';')) {
    const index = segment.indexOf('=');
    if (index < 0) continue;
    if (segment.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(segment.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function readJson(request, maxBytes = 1_048_576) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new AppError('Ukuran permintaan terlalu besar.', 413, 'PAYLOAD_TOO_LARGE');
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new AppError('Permintaan harus memakai format JSON.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new AppError('Ukuran permintaan terlalu besar.', 413, 'PAYLOAD_TOO_LARGE');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('Isi JSON tidak valid.', 400, 'INVALID_JSON');
  }
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function checkPassword(password, encodedHash) {
  const parts = String(encodedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations !== PBKDF2_ITERATIONS) return false;
  let salt;
  let expected;
  try {
    salt = fromBase64Url(parts[2]);
    expected = parts[3];
  } catch {
    return false;
  }
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, 256);
  return constantTimeEqual(toBase64Url(new Uint8Array(bits)), expected);
}

function cookieValue(env, maxAge) {
  const secure = String(env.COOKIE_SECURE || 'true').toLowerCase() === 'true';
  const sameSite = secure ? 'None' : 'Lax';
  const secureFlag = secure ? '; Secure' : '';
  return `spm_session=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secureFlag}`;
}

function sessionCookie(token, env) {
  const secure = String(env.COOKIE_SECURE || 'true').toLowerCase() === 'true';
  const sameSite = secure ? 'None' : 'Lax';
  const secureFlag = secure ? '; Secure' : '';
  return `spm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_HOURS * 3600}${secureFlag}`;
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function checkRateLimit(request, env) {
  const key = await sha256Base64Url(clientIp(request));
  const now = Date.now();
  const row = await env.DB.prepare('SELECT failure_count, window_started_at, locked_until FROM login_attempts WHERE ip_hash = ?')
    .bind(key).first();
  if (row?.locked_until > now) {
    const seconds = Math.max(1, Math.ceil((row.locked_until - now) / 1000));
    throw new AppError(`Terlalu banyak percobaan login. Coba lagi dalam ${seconds} detik.`, 429, 'LOGIN_THROTTLED');
  }
  return { key, now, row };
}

async function recordFailedLogin(rate, env) {
  const inWindow = rate.row && rate.now - rate.row.window_started_at < LOGIN_WINDOW_MS;
  const count = inWindow ? rate.row.failure_count + 1 : 1;
  const windowStarted = inWindow ? rate.row.window_started_at : rate.now;
  const lockedUntil = count >= MAX_LOGIN_FAILURES ? rate.now + LOGIN_WINDOW_MS : 0;
  await env.DB.prepare(`INSERT INTO login_attempts (ip_hash, failure_count, window_started_at, locked_until)
    VALUES (?, ?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET
    failure_count = excluded.failure_count,
    window_started_at = excluded.window_started_at,
    locked_until = excluded.locked_until`)
    .bind(rate.key, count, windowStarted, lockedUntil).run();
}

export async function authenticate(request, env) {
  const body = await readJson(request, 4096);
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password || username.length > 120 || password.length > 1024) {
    throw new AppError('Nama pengguna dan kata sandi wajib diisi.', 400, 'INVALID_CREDENTIALS');
  }
  if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_USERNAME) {
    throw new AppError('Login belum dikonfigurasi. Ikuti langkah pengaturan operator di README.', 503, 'AUTH_NOT_CONFIGURED');
  }
  const rate = await checkRateLimit(request, env);
  const passwordMatches = await checkPassword(password, env.ADMIN_PASSWORD_HASH);
  const userMatches = constantTimeEqual(username, String(env.ADMIN_USERNAME));
  if (!(passwordMatches && userMatches)) {
    await recordFailedLogin(rate, env);
    throw new AppError('Nama pengguna atau kata sandi tidak sesuai.', 401, 'INVALID_CREDENTIALS');
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const csrfBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(tokenBytes);
  const csrfToken = toBase64Url(csrfBytes);
  const tokenHash = await sha256Base64Url(token);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(createdAt),
    env.DB.prepare('INSERT INTO auth_sessions (token_hash, username, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(tokenHash, username, csrfToken, createdAt, expiresAt, createdAt),
    env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(rate.key),
  ]);
  return json({ authenticated: true, username, csrfToken, expiresAt }, 200, { 'set-cookie': sessionCookie(token, env) });
}

export async function getSession(request, env) {
  const token = parseCookie(request, 'spm_session');
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare('SELECT token_hash, username, csrf_token, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, now).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  return row;
}

export function requireCsrf(request, session, env) {
  const supplied = request.headers.get('x-csrf-token') || '';
  const origin = request.headers.get('origin');
  if (!supplied || !constantTimeEqual(supplied, session.csrf_token)) {
    throw new AppError('Sesi keamanan tidak valid. Muat ulang aplikasi lalu coba lagi.', 403, 'CSRF_CHECK_FAILED');
  }
  const configuredOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== requestOrigin && !configuredOrigins.includes(origin))) {
    throw new AppError('Asal permintaan tidak diizinkan.', 403, 'ORIGIN_NOT_ALLOWED');
  }
}

export async function logout(request, env, session) {
  if (session) {
    requireCsrf(request, session, env);
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(session.token_hash).run();
  }
  return json({ authenticated: false }, 200, { 'set-cookie': cookieValue(env, 0) });
}

export async function sessionResponse(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false });
  return json({ authenticated: true, username: session.username, csrfToken: session.csrf_token, expiresAt: session.expires_at });
}
