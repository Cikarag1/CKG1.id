import { AppError } from './validation.js';
import { authenticate, getSession, json, logout, requireCsrf, sessionResponse } from './auth.js';
import { handleItems } from './items.js';
import { handleTransfers } from './transfers.js';

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
};

function errorResponse(error) {
  if (error instanceof AppError) {
    return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
  }
  console.error('Kesalahan Worker:', error?.stack || error);
  return json({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server. Coba lagi; bila berulang, hubungi administrator.' } }, 500);
}

async function handleApi(request, env) {
  const path = new URL(request.url).pathname;
  const segments = path.split('/').filter(Boolean).slice(1).map((part) => decodeURIComponent(part));
  if (path === '/api/health' && request.method === 'GET') {
    try {
      await env.DB.prepare('SELECT 1 AS ok').first();
      return json({ ok: true, database: 'terhubung' });
    } catch {
      return json({ ok: false, database: 'belum siap' }, 503);
    }
  }
  if (path === '/api/auth/login' && request.method === 'POST') return authenticate(request, env);
  if (path === '/api/auth/session' && request.method === 'GET') return sessionResponse(request, env);
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const session = await getSession(request, env);
    return logout(request, env, session);
  }

  const session = await getSession(request, env);
  if (!session) return json({ error: { code: 'UNAUTHORIZED', message: 'Sesi telah berakhir. Silakan masuk kembali.' } }, 401);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) requireCsrf(request, session, env);

  if (segments[0] === 'items' || ['filters', 'stats', 'compare', 'history'].includes(segments[0])) {
    return handleItems(request, env, segments);
  }
  if (['import', 'export.csv', 'backup.json', 'backup'].includes(segments[0])) {
    return handleTransfers(request, env, segments);
  }
  return json({ error: { code: 'NOT_FOUND', message: 'Endpoint API tidak ditemukan.' } }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        return errorResponse(error);
      }
    }
    try {
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        headers.set(key, value);
      }
      if (url.pathname === '/' || url.pathname.endsWith('.html')) headers.set('cache-control', 'no-cache');
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    } catch (error) {
      console.error('Gagal mengambil aset:', error?.stack || error);
      return new Response('Aset aplikasi tidak tersedia.', { status: 503, headers: SECURITY_HEADERS });
    }
  },
};
