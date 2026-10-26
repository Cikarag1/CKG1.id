import { AppError, itemForClient, normalizeItem } from './validation.js';
import { json, readJson } from './auth.js';

const SORTS = {
  price_asc: 'unit_price_rupiah ASC, lower(name) ASC',
  price_desc: 'unit_price_rupiah DESC, lower(name) ASC',
  name_asc: 'lower(name) ASC, lower(supplier) ASC',
  date_desc: 'updated_at DESC',
};

function itemId() {
  return crypto.randomUUID();
}

function nextTimestamp(previous) {
  const now = Date.now();
  const old = Date.parse(previous || '') || 0;
  return new Date(Math.max(now, old + 1)).toISOString();
}

function activityStatement(conditional = false) {
  return `INSERT INTO activity_log (id, event_type, item_id, item_code, item_name, summary, details_json, created_at)
    ${conditional ? 'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1' : 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'}`;
}

function queryString(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function parseNonnegativePrice(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^\d{1,12}$/.test(String(value))) throw new AppError(`Filter ${label} harus berupa rupiah bulat.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new AppError(`Filter ${label} terlalu besar.`);
  return result;
}

async function listItems(request, env) {
  const url = new URL(request.url);
  const q = queryString(url.searchParams.get('q'), 120);
  const supplier = queryString(url.searchParams.get('supplier'), 120);
  const category = queryString(url.searchParams.get('category'), 80);
  const minPrice = parseNonnegativePrice(url.searchParams.get('minPrice'), 'harga minimum');
  const maxPrice = parseNonnegativePrice(url.searchParams.get('maxPrice'), 'harga maksimum');
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new AppError('Harga minimum tidak boleh lebih besar dari harga maksimum.');
  }
  const page = Math.max(1, Math.min(100_000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const pageSize = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get('pageSize') || '25', 10) || 25));
  const sort = SORTS[url.searchParams.get('sort')] ? url.searchParams.get('sort') : 'date_desc';
  const where = [];
  const values = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(item_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR name LIKE ? ESCAPE '\\' COLLATE NOCASE OR supplier LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE OR notes LIKE ? ESCAPE '\\' COLLATE NOCASE)`);
    values.push(like, like, like, like, like);
  }
  if (supplier) { where.push('supplier = ? COLLATE NOCASE'); values.push(supplier); }
  if (category) { where.push('category = ? COLLATE NOCASE'); values.push(category); }
  if (minPrice !== null) { where.push('unit_price_rupiah >= ?'); values.push(minPrice); }
  if (maxPrice !== null) { where.push('unit_price_rupiah <= ?'); values.push(maxPrice); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM items ${clause}`).bind(...values).first();
  const rows = await env.DB.prepare(`SELECT * FROM items ${clause} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, (page - 1) * pageSize).all();
  const total = Number(count?.total || 0);
  return json({
    items: (rows.results || []).map(itemForClient),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    sort,
  });
}

async function getItem(env, id) {
  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!row) throw new AppError('Barang tidak ditemukan.', 404, 'NOT_FOUND');
  const history = await env.DB.prepare('SELECT * FROM price_history WHERE item_id = ? ORDER BY changed_at DESC LIMIT 50').bind(id).all();
  const activity = await env.DB.prepare('SELECT * FROM activity_log WHERE item_id = ? ORDER BY created_at DESC LIMIT 20').bind(id).all();
  return json({ item: itemForClient(row), priceHistory: history.results || [], activity: activity.results || [] });
}

async function createItem(request, env) {
  const input = await readJson(request);
  const item = normalizeItem(input);
  const id = itemId();
  const timestamp = new Date().toISOString();
  const values = [id, item.itemCode, item.name, item.supplier, item.category, item.unitPriceRupiah,
    item.purchaseQtyMilli, item.purchaseUnit, item.stockQtyMilli, item.stockUnit,
    item.purchaseTotalMilli, item.inventoryValueMilli, item.notes, timestamp, timestamp];
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO items (id, item_code, name, supplier, category, unit_price_rupiah,
        purchase_qty_milli, purchase_unit, stock_qty_milli, stock_unit, purchase_total_milli,
        inventory_value_milli, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values),
      env.DB.prepare(activityStatement()).bind(itemId(), 'buat', id, item.itemCode, item.name,
        `Barang ${item.name} ditambahkan.`, JSON.stringify({ supplier: item.supplier }), timestamp),
    ]);
  } catch (error) {
    if (/unique/i.test(String(error?.message || error))) {
      throw new AppError('Kode barang untuk supplier ini sudah ada.', 409, 'DUPLICATE_ITEM');
    }
    throw error;
  }
  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return json({ item: itemForClient(row) }, 201);
}

async function updateItem(request, env, id) {
  const input = await readJson(request);
  const expectedUpdatedAt = String(input.expectedUpdatedAt || '');
  if (!expectedUpdatedAt) throw new AppError('Versi data yang akan diperbarui tidak tersedia. Muat ulang barang.', 409, 'VERSION_REQUIRED');
  const existing = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!existing) throw new AppError('Barang tidak ditemukan.', 404, 'NOT_FOUND');
  if (existing.updated_at !== expectedUpdatedAt) {
    throw new AppError('Data ini telah berubah di perangkat lain. Muat ulang sebelum menyimpan.', 409, 'VERSION_CONFLICT');
  }
  const item = normalizeItem(input);
  const timestamp = nextTimestamp(existing.updated_at);
  const priceChanged = existing.unit_price_rupiah !== item.unitPriceRupiah
    || existing.supplier !== item.supplier || existing.purchase_unit !== item.purchaseUnit;
  const statements = [env.DB.prepare(`UPDATE items SET item_code = ?, name = ?, supplier = ?, category = ?,
    unit_price_rupiah = ?, purchase_qty_milli = ?, purchase_unit = ?, stock_qty_milli = ?, stock_unit = ?,
    purchase_total_milli = ?, inventory_value_milli = ?, notes = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND updated_at = ?`)
    .bind(item.itemCode, item.name, item.supplier, item.category, item.unitPriceRupiah,
      item.purchaseQtyMilli, item.purchaseUnit, item.stockQtyMilli, item.stockUnit,
      item.purchaseTotalMilli, item.inventoryValueMilli, item.notes, timestamp, id, expectedUpdatedAt)];
  if (priceChanged) {
    statements.push(env.DB.prepare(`INSERT INTO price_history (id, item_id, item_code, item_name,
      old_price_rupiah, new_price_rupiah, old_supplier, new_supplier, old_unit, new_unit, changed_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(itemId(), id, item.itemCode, item.name, existing.unit_price_rupiah, item.unitPriceRupiah,
        existing.supplier, item.supplier, existing.purchase_unit, item.purchaseUnit, timestamp));
  }
  statements.push(env.DB.prepare(activityStatement(true)).bind(itemId(), priceChanged ? 'harga_diperbarui' : 'ubah',
    id, item.itemCode, item.name, `Barang ${item.name} diperbarui.`,
    JSON.stringify({ priceChanged, previousUpdatedAt: existing.updated_at }), timestamp));
  const results = await env.DB.batch(statements);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    throw new AppError('Data ini berubah di perangkat lain. Muat ulang sebelum menyimpan.', 409, 'VERSION_CONFLICT');
  }
  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return json({ item: itemForClient(row) });
}

async function deleteItem(request, env, id) {
  const body = await readJson(request, 16_384);
  const expectedUpdatedAt = String(body.expectedUpdatedAt || '');
  if (!expectedUpdatedAt) throw new AppError('Versi data tidak tersedia. Muat ulang sebelum menghapus.', 409, 'VERSION_REQUIRED');
  const existing = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!existing) throw new AppError('Barang tidak ditemukan.', 404, 'NOT_FOUND');
  if (existing.updated_at !== expectedUpdatedAt) {
    throw new AppError('Data ini telah berubah di perangkat lain. Muat ulang sebelum menghapus.', 409, 'VERSION_CONFLICT');
  }
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE id = ? AND updated_at = ?').bind(id, expectedUpdatedAt),
    env.DB.prepare(activityStatement(true)).bind(itemId(), 'hapus', id, existing.item_code, existing.name,
      `Barang ${existing.name} dihapus.`, JSON.stringify({ itemCode: existing.item_code }), timestamp),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    throw new AppError('Data berubah di perangkat lain. Muat ulang sebelum menghapus.', 409, 'VERSION_CONFLICT');
  }
  return json({ deleted: true, id });
}

export async function handleItems(request, env, segments) {
  const method = request.method.toUpperCase();
  if (segments.length === 1 && segments[0] === 'items') {
    if (method === 'GET') return listItems(request, env);
    if (method === 'POST') return createItem(request, env);
  }
  if (segments.length === 2 && segments[0] === 'items') {
    const id = segments[1];
    if (method === 'GET') return getItem(env, id);
    if (method === 'PUT') return updateItem(request, env, id);
    if (method === 'DELETE') return deleteItem(request, env, id);
  }
  if (segments.length === 1 && segments[0] === 'filters' && method === 'GET') {
    const [suppliers, categories] = await Promise.all([
      env.DB.prepare('SELECT DISTINCT supplier AS value FROM items ORDER BY lower(supplier)').all(),
      env.DB.prepare('SELECT DISTINCT category AS value FROM items ORDER BY lower(category)').all(),
    ]);
    return json({ suppliers: suppliers.results || [], categories: categories.results || [] });
  }
  if (segments.length === 1 && segments[0] === 'stats' && method === 'GET') return getStats(env);
  if (segments.length === 1 && segments[0] === 'compare' && method === 'GET') return getComparison(request, env);
  if (segments.length === 1 && segments[0] === 'history' && method === 'GET') return getHistory(request, env);
  throw new AppError('Endpoint tidak ditemukan.', 404, 'NOT_FOUND');
}

async function getStats(env) {
  const [counts, items, changed, activity] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS item_count, COUNT(DISTINCT lower(supplier)) AS supplier_count FROM items').first(),
    env.DB.prepare(`SELECT id, name, supplier, category, unit_price_rupiah, purchase_unit,
      stock_qty_milli, stock_unit, inventory_value_milli FROM items`).all(),
    env.DB.prepare('SELECT COUNT(DISTINCT h.item_id) AS total FROM price_history h INNER JOIN items i ON i.id = h.item_id').first(),
    env.DB.prepare('SELECT id, event_type, item_id, item_code, item_name, summary, created_at FROM activity_log ORDER BY created_at DESC LIMIT 8').all(),
  ]);
  const rows = items.results || [];
  let inventoryValueMilli = 0n;
  const stockTotals = new Map();
  const groups = new Map();
  let mostExpensive = null;
  for (const row of rows) {
    inventoryValueMilli += BigInt(row.inventory_value_milli || 0);
    stockTotals.set(row.stock_unit, (stockTotals.get(row.stock_unit) || 0n) + BigInt(row.stock_qty_milli || 0));
    if (!mostExpensive || row.unit_price_rupiah > mostExpensive.unitPriceRupiah) {
      mostExpensive = { name: row.name, supplier: row.supplier, unitPriceRupiah: row.unit_price_rupiah, unit: row.purchase_unit };
    }
    const key = `${row.name.trim().toLocaleLowerCase('id-ID')}\u0000${row.purchase_unit.trim().toLocaleLowerCase('id-ID')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let cheapestComparable = null;
  for (const group of groups.values()) {
    const suppliers = new Set(group.map((row) => row.supplier.trim().toLocaleLowerCase('id-ID')));
    if (suppliers.size < 2) continue;
    for (const row of group) {
      if (!cheapestComparable || row.unit_price_rupiah < cheapestComparable.unitPriceRupiah) {
        cheapestComparable = { name: row.name, supplier: row.supplier, unitPriceRupiah: row.unit_price_rupiah, unit: row.purchase_unit };
      }
    }
  }
  return json({
    totalItems: Number(counts?.item_count || 0),
    totalSuppliers: Number(counts?.supplier_count || 0),
    stockByUnit: [...stockTotals.entries()].map(([unit, milli]) => ({ unit, quantity: milli.toString() })),
    inventoryValueMilli: inventoryValueMilli.toString(),
    priceChangedItems: Number(changed?.total || 0),
    mostExpensive,
    cheapestComparable,
    recentActivity: activity.results || [],
  });
}

async function getComparison(request, env) {
  const q = queryString(new URL(request.url).searchParams.get('q'), 120).toLocaleLowerCase('id-ID');
  const rows = await env.DB.prepare(`SELECT id, item_code, name, supplier, category, unit_price_rupiah,
    purchase_qty_milli, purchase_unit, updated_at FROM items ORDER BY lower(name), lower(purchase_unit), unit_price_rupiah`).all();
  const groups = new Map();
  for (const row of rows.results || []) {
    if (q && ![row.name, row.item_code, row.category].some((value) => String(value).toLocaleLowerCase('id-ID').includes(q))) continue;
    const key = `${row.name.trim().toLocaleLowerCase('id-ID')}\u0000${row.purchase_unit.trim().toLocaleLowerCase('id-ID')}`;
    if (!groups.has(key)) groups.set(key, { name: row.name, unit: row.purchase_unit, suppliers: [] });
    groups.get(key).suppliers.push({
      id: row.id, itemCode: row.item_code, supplier: row.supplier, category: row.category,
      unitPriceRupiah: row.unit_price_rupiah,
      purchaseQuantity: Number(row.purchase_qty_milli) / 1000,
      updatedAt: row.updated_at,
    });
  }
  const comparisons = [...groups.values()]
    .filter((group) => new Set(group.suppliers.map((item) => item.supplier.toLocaleLowerCase('id-ID'))).size > 1)
    .map((group) => ({
      ...group,
      suppliers: group.suppliers.sort((a, b) => a.unitPriceRupiah - b.unitPriceRupiah),
      cheapestPriceRupiah: Math.min(...group.suppliers.map((item) => item.unitPriceRupiah)),
      suppliersCompared: new Set(group.suppliers.map((item) => item.supplier.toLocaleLowerCase('id-ID'))).size,
    }));
  return json({ comparisons });
}

async function getHistory(request, env) {
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100_000, Number.parseInt(params.get('page') || '1', 10) || 1));
  const pageSize = Math.max(10, Math.min(100, Number.parseInt(params.get('pageSize') || '25', 10) || 25));
  const [count, history, activity] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM price_history').first(),
    env.DB.prepare('SELECT * FROM price_history ORDER BY changed_at DESC LIMIT ? OFFSET ?').bind(pageSize, (page - 1) * pageSize).all(),
    env.DB.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 50').all(),
  ]);
  const total = Number(count?.total || 0);
  return json({
    priceHistory: history.results || [],
    activity: activity.results || [],
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
