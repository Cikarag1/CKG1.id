const base = 'http://127.0.0.1:3000';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const req = (path, options = {}) => fetch(new URL(path, base), options);
import { execFileSync } from 'node:child_process';
const check = async (path, options, status) => {
  const response = await req(path, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  assert(response.status === status, `${options?.method || 'GET'} ${path}: status ${response.status}, expected ${status}; ${JSON.stringify(data).slice(0, 500)}`);
  return { response, data };
};
const jsonOptions = (method, body, csrf, origin = base) => ({
  method,
  headers: { 'content-type': 'application/json', ...(csrf ? { cookie: csrf.cookie, 'x-csrf-token': csrf.token, origin } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const health = await check('/api/health', {}, 200);
assert(health.data.database === 'terhubung', 'Health check should connect to local D1');
const unauth = await check('/api/items', {}, 401);
assert(unauth.data.error.code === 'UNAUTHORIZED', 'Private API must reject anonymous request');
const login = await check('/api/auth/login', jsonOptions('POST', { username: 'admin', password: 'PreviewOnly-4826' }), 200);
const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
assert(cookie?.startsWith('spm_session='), 'Login must issue a session cookie');
const session = { cookie, token: login.data.csrfToken };
const cookieAttrs = login.response.headers.get('set-cookie');
assert(cookieAttrs.includes('SameSite=None') && /;\s*Secure(?:;|$)/.test(cookieAttrs), 'HTTPS Preview session cookie should use SameSite=None and Secure');
const sessionCheck = await check('/api/auth/session', { headers: { cookie } }, 200);
assert(sessionCheck.data.authenticated && sessionCheck.data.username === 'admin', 'Session endpoint should recognize the logged-in operator');

const mk = (code, supplier, price, unit = 'kg', stockUnit = unit) => ({ itemCode: code, name: 'Tepung Smoke', supplier, category: 'Bahan kering', unitPriceRupiah: String(price), purchaseQuantity: '2.5', purchaseUnit: unit, stockQuantity: '4', stockUnit, notes: 'smoke, "uji"' });
const createdA = await check('/api/items', jsonOptions('POST', mk('SMOKE-001', 'Supplier A', 15000), session), 201);
assert(createdA.data.item.purchaseTotalMilli === 37500000, 'Purchase total should equal unit price multiplied by purchase quantity');
assert(createdA.data.item.inventoryValueMilli === 60000000, 'Inventory value should equal unit price multiplied by stock');
const createdB = await check('/api/items', jsonOptions('POST', mk('SMOKE-002', 'Supplier B', 17000), session), 201);
const createdGram = await check('/api/items', jsonOptions('POST', mk('SMOKE-004', 'Supplier C', 9000, 'gram'), session), 201);
const convertedStock = await check('/api/items', jsonOptions('POST', { ...mk('SMOKE-005', 'Supplier D', 20000, 'kg', 'gram'), stockQuantity: '500' }, session), 201);
assert(convertedStock.data.item.inventoryValueMilli === 10000000, '500 g stock at Rp20,000/kg should be valued at Rp10,000');
const incompatibleUnits = await check('/api/items', jsonOptions('POST', mk('SMOKE-UNIT', 'Invalid Unit', 5000, 'kg', 'liter'), session), 400);
assert(incompatibleUnits.data.error.code === 'INCOMPATIBLE_UNITS', 'Incompatible dimensions must be rejected instead of generating a false inventory value');

const query = await check('/api/items?q=Supplier+A&sort=price_asc', { headers: { cookie } }, 200);
assert(query.data.pagination.total === 1 && query.data.items[0].itemCode === 'SMOKE-001', 'Server-side search should match supplier names');
const bounds = await check('/api/items?minPrice=16000&maxPrice=18000', { headers: { cookie } }, 200);
assert(bounds.data.pagination.total === 1 && bounds.data.items[0].itemCode === 'SMOKE-002', 'Price range filters should be applied server-side');
const compare = await check('/api/compare?q=Tepung+Smoke', { headers: { cookie } }, 200);
assert(compare.data.comparisons.length === 1, 'Only same-name, same-unit supplier options should compare');
assert(compare.data.comparisons[0].unit === 'kg' && compare.data.comparisons[0].suppliers[0].supplier === 'Supplier A', 'Cheapest same-unit supplier should sort first; gram must stay separate');

const changedA = await check(`/api/items/${createdA.data.item.id}`, jsonOptions('PUT', { ...mk('SMOKE-001', 'Supplier A', 14000), expectedUpdatedAt: createdA.data.item.updatedAt }, session), 200);
assert(changedA.data.item.unitPriceRupiah === 14000, 'Price edit should persist');
const racingUpdates = await Promise.all([
  req(`/api/items/${createdA.data.item.id}`, jsonOptions('PUT', { ...mk('SMOKE-001', 'Supplier A', 13000), expectedUpdatedAt: changedA.data.item.updatedAt }, session)),
  req(`/api/items/${createdA.data.item.id}`, jsonOptions('PUT', { ...mk('SMOKE-001', 'Supplier A', 12000), expectedUpdatedAt: changedA.data.item.updatedAt }, session)),
]);
assert(racingUpdates.map((response) => response.status).sort().join(',') === '200,409', 'Exactly one concurrent update may win; the other must receive a version conflict');
const history = await check('/api/history?page=1&pageSize=25', { headers: { cookie } }, 200);
assert(history.data.priceHistory.length === 2 && history.data.priceHistory.some((row) => row.old_price_rupiah === 15000 && row.new_price_rupiah === 14000), 'Price history should record successful edits and exclude the racing loser');
await check('/api/items', jsonOptions('POST', mk('SMOKE-CSRF', 'Bad Origin', 1000), session, 'https://evil.invalid'), 403);
await check('/api/items', jsonOptions('POST', { ...mk('SMOKE-NEG', 'Bad Price', '-1') }, session), 400);

const previewRows = [
  { ...mk('SMOKE-003', 'Supplier D', 11000), _line: 2 },
  { ...mk('SMOKE-001', 'Supplier A', 16000), _line: 3 },
  { ...mk('SMOKE-DUP', 'Supplier E', 12000), _line: 4 },
  { ...mk('SMOKE-DUP', 'Supplier E', 12000), _line: 5 },
  { ...mk('SMOKE-BAD', 'Supplier F', -5), _line: 6 },
];
const preview = await check('/api/import/preview', jsonOptions('POST', { rows: previewRows }, session), 200);
assert(preview.data.valid === 1 && preview.data.existing === 1 && preview.data.duplicatesInFile === 2 && preview.data.invalid === 1, 'Import preview should count new, existing, duplicate-file, and invalid rows');
const imported = await check('/api/import', jsonOptions('POST', { mode: 'add', confirmed: true, rows: [previewRows[0]] }, session), 200);
assert(imported.data.added === 1 && imported.data.updated === 0, 'Confirmed CSV import should add a new row');
const csv = await req('/api/export.csv', { headers: { cookie } });
assert(csv.ok && (await csv.text()).includes('kode_barang,nama_barang,supplier'), 'CSV export should contain the Indonesian headers');
const backup = await check('/api/backup.json', { headers: { cookie } }, 200);
assert(backup.data.schemaVersion === 1 && backup.data.items.length === 5 && backup.data.priceHistory.length === 2 && backup.data.activity.length > 0, 'Backup should include items, price history, and activity');
execFileSync('npx', ['wrangler', 'd1', 'execute', 'supplier-price-manager', '--local', '--command', 'DELETE FROM activity_log'], { cwd: '/home/ubuntu/supplierpm', stdio: 'ignore' });
const restored = await check('/api/backup/restore', jsonOptions('POST', { backup: backup.data, confirmationPhrase: 'PULIHKAN' }, session), 200);
assert(restored.data.merged && restored.data.deleted === 0, 'Restore should merge and never delete unrelated records');
const restoredActivity = await check('/api/history?page=1&pageSize=25', { headers: { cookie } }, 200);
assert(restoredActivity.data.activity.length === backup.data.activity.length + 1, 'Restore should merge missing audit rows and add one restore event');
const stats = await check('/api/stats', { headers: { cookie } }, 200);
assert(stats.data.totalItems === 5 && stats.data.totalSuppliers === 4, 'Dashboard totals should reflect D1 records');

const all = await check('/api/items?pageSize=100', { headers: { cookie } }, 200);
for (const item of all.data.items) {
  await check(`/api/items/${item.id}`, jsonOptions('DELETE', { expectedUpdatedAt: item.updatedAt }, session), 200);
}
const cleaned = await check('/api/stats', { headers: { cookie } }, 200);
assert(cleaned.data.totalItems === 0 && cleaned.data.totalSuppliers === 0, 'Smoke-test rows should be cleaned from local D1');
const retainedHistory = await check('/api/history?page=1&pageSize=25', { headers: { cookie } }, 200);
assert(retainedHistory.data.priceHistory.length === 2, 'Deleting active items must not delete price history');
await check('/api/auth/logout', jsonOptions('POST', {}, session), 200);
console.log('PASS: local API login/CSRF, CRUD, unit conversion, invalid unit rejection, atomic concurrent updates, search/filter, comparison, import preview, CSV/JSON/activity backup restore, stats, and retained history.');
