import { AppError, cleanText, itemForClient, normalizeItem } from './validation.js';
import { json, readJson } from './auth.js';

const CSV_HEADERS = ['kode_barang', 'nama_barang', 'supplier', 'kategori', 'harga_satuan_rp', 'kuantitas_pembelian', 'satuan_pembelian', 'stok_tersedia', 'satuan_stok', 'catatan'];
const INSERT_SQL = `INSERT INTO items (id, item_code, name, supplier, category, unit_price_rupiah,
  purchase_qty_milli, purchase_unit, stock_qty_milli, stock_unit, purchase_total_milli,
  inventory_value_milli, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function newId() { return crypto.randomUUID(); }
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csvRow(values) { return values.map(csvCell).join(','); }
function sqlValues(item, id, createdAt, updatedAt) {
  return [id, item.itemCode, item.name, item.supplier, item.category, item.unitPriceRupiah,
    item.purchaseQtyMilli, item.purchaseUnit, item.stockQtyMilli, item.stockUnit,
    item.purchaseTotalMilli, item.inventoryValueMilli, item.notes, createdAt, updatedAt];
}
function logStatement(env, type, item, summary, timestamp) {
  return env.DB.prepare(`INSERT INTO activity_log (id, event_type, item_id, item_code, item_name, summary, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId(), type, item.id, item.itemCode, item.name, summary, '{}', timestamp);
}

async function allItems(env) {
  const result = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await env.DB.prepare('SELECT * FROM items ORDER BY created_at, id LIMIT ? OFFSET ?').bind(pageSize, offset).all();
    result.push(...(page.results || []));
    if ((page.results || []).length < pageSize) break;
    if (result.length > 50_000) throw new AppError('Ekspor dibatasi 50.000 barang per berkas.', 413, 'EXPORT_TOO_LARGE');
  }
  return result;
}

export async function exportCsv(env) {
  const rows = await allItems(env);
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(csvRow([
      row.item_code, row.name, row.supplier, row.category, row.unit_price_rupiah,
      itemForClient(row).purchaseQuantity, row.purchase_unit,
      itemForClient(row).stockQuantity, row.stock_unit, row.notes,
    ]));
  }
  return new Response(`\uFEFF${lines.join('\r\n')}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cadangan-harga-supplier.csv"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function exportBackup(env) {
  const items = await allItems(env);
  const [history, activity] = await Promise.all([
    env.DB.prepare('SELECT * FROM price_history ORDER BY changed_at').all(),
    env.DB.prepare('SELECT * FROM activity_log ORDER BY created_at').all(),
  ]);
  return json({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    items: items.map(itemForClient),
    priceHistory: history.results || [],
    activity: activity.results || [],
  }, 200, { 'content-disposition': 'attachment; filename="cadangan-supplier-price-manager.json"' });
}

async function importRows(request, env) {
  const body = await readJson(request, 1_500_000);
  if (body?.confirmed !== true || !['add', 'upsert'].includes(body?.mode)) {
    throw new AppError('Pilih tambah atau perbarui, lalu konfirmasikan impor.', 400, 'IMPORT_CONFIRMATION_REQUIRED');
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 250) {
    throw new AppError('Impor harus berisi 1 sampai 250 baris per permintaan.', 400, 'IMPORT_ROW_LIMIT');
  }
  const normalized = body.rows.map((row) => ({ source: row, item: normalizeItem(row) }));
  const keys = new Set();
  for (const { item } of normalized) {
    const key = `${item.itemCode.toLocaleLowerCase('id-ID')}\u0000${item.supplier.toLocaleLowerCase('id-ID')}`;
    if (keys.has(key)) throw new AppError(`Kode ${item.itemCode} muncul lebih dari sekali untuk supplier ${item.supplier}.`, 409, 'DUPLICATE_IN_FILE');
    keys.add(key);
  }
  const existingRows = await Promise.all(normalized.map(({ item }) => env.DB.prepare(`SELECT * FROM items
    WHERE lower(item_code) = lower(?) AND lower(supplier) = lower(?)`).bind(item.itemCode, item.supplier).first()));
  if (body.mode === 'add' && existingRows.some(Boolean)) {
    const rowIndex = existingRows.findIndex(Boolean) + 1;
    throw new AppError(`Baris ${rowIndex} sudah ada untuk kode dan supplier tersebut. Pilih mode perbarui setelah memeriksa pratinjau.`, 409, 'DUPLICATE_ITEM');
  }
  const timestamp = new Date().toISOString();
  const statements = [];
  const updatedRows = [];
  let added = 0;
  let updated = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const { item } = normalized[index];
    const previous = existingRows[index];
    if (!previous) {
      const id = newId();
      statements.push(env.DB.prepare(INSERT_SQL).bind(...sqlValues(item, id, timestamp, timestamp)));
      statements.push(logStatement(env, 'impor_tambah', { ...item, id }, `Barang ${item.name} ditambahkan melalui CSV.`, timestamp));
      added += 1;
      continue;
    }
    const updatedAt = new Date(Math.max(Date.now() + index, (Date.parse(previous.updated_at) || 0) + 1)).toISOString();
    statements.push(env.DB.prepare(`UPDATE items SET item_code = ?, name = ?, supplier = ?, category = ?, unit_price_rupiah = ?, purchase_qty_milli = ?,
      purchase_unit = ?, stock_qty_milli = ?, stock_unit = ?, purchase_total_milli = ?, inventory_value_milli = ?,
      notes = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND updated_at = ?`)
      .bind(item.itemCode, item.name, item.supplier, item.category, item.unitPriceRupiah, item.purchaseQtyMilli, item.purchaseUnit,
        item.stockQtyMilli, item.stockUnit, item.purchaseTotalMilli, item.inventoryValueMilli,
        item.notes, updatedAt, previous.id, previous.updated_at));
    updatedRows.push({ id: previous.id, updatedAt });
    const priceChanged = previous.unit_price_rupiah !== item.unitPriceRupiah
      || previous.purchase_unit !== item.purchaseUnit || previous.supplier !== item.supplier;
    if (priceChanged) {
      statements.push(env.DB.prepare(`INSERT INTO price_history (id, item_id, item_code, item_name,
        old_price_rupiah, new_price_rupiah, old_supplier, new_supplier, old_unit, new_unit, changed_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM items WHERE id = ? AND updated_at = ?)`)
        .bind(newId(), previous.id, item.itemCode, item.name, previous.unit_price_rupiah,
          item.unitPriceRupiah, previous.supplier, item.supplier, previous.purchase_unit, item.purchaseUnit,
          updatedAt, previous.id, updatedAt));
    }
    statements.push(env.DB.prepare(`INSERT INTO activity_log (id, event_type, item_id, item_code, item_name, summary, details_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM items WHERE id = ? AND updated_at = ?)`)
      .bind(newId(), 'impor_perbarui', previous.id, item.itemCode, item.name,
        `Barang ${item.name} diperbarui melalui CSV.`, '{}', updatedAt, previous.id, updatedAt));
    updated += 1;
  }
  try {
    await env.DB.batch(statements);
    const currentVersions = await Promise.all(updatedRows.map(({ id }) => env.DB.prepare('SELECT updated_at FROM items WHERE id = ?').bind(id).first()));
    if (currentVersions.some((row, index) => row?.updated_at !== updatedRows[index].updatedAt)) {
      throw new AppError('Sebagian data berubah di perangkat lain. Muat ulang data lalu ulangi impor.', 409, 'VERSION_CONFLICT');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (/unique/i.test(String(error?.message || error))) throw new AppError('Baris CSV bertabrakan dengan data yang sudah ada.', 409, 'DUPLICATE_ITEM');
    throw error;
  }
  return json({ imported: added + updated, added, updated });
}

async function previewImport(request, env) {
  const body = await readJson(request, 2_000_000);
  if (!Array.isArray(body?.rows) || body.rows.length < 1 || body.rows.length > 500) {
    throw new AppError('Pratinjau CSV harus berisi 1 sampai 500 baris.', 400, 'IMPORT_ROW_LIMIT');
  }
  const rows = body.rows.map((source, index) => {
    try {
      const item = normalizeItem(source);
      return { line: Number(source?._line) || index + 2, item, key: `${item.itemCode.toLocaleLowerCase('id-ID')}\u0000${item.supplier.toLocaleLowerCase('id-ID')}` };
    } catch (error) {
      return { line: Number(source?._line) || index + 2, item: null, error: error.message };
    }
  });
  const counts = new Map();
  for (const row of rows) if (row.key) counts.set(row.key, (counts.get(row.key) || 0) + 1);
  const duplicateKeys = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  const existingChecks = await Promise.all(rows.map(async (row) => {
    if (!row.item || duplicateKeys.has(row.key)) return null;
    return env.DB.prepare('SELECT id FROM items WHERE lower(item_code) = lower(?) AND lower(supplier) = lower(?)')
      .bind(row.item.itemCode, row.item.supplier).first();
  }));
  let valid = 0;
  let existing = 0;
  let duplicatesInFile = 0;
  let invalid = 0;
  const resultRows = rows.map((row, index) => {
    let status;
    let statusLabel;
    if (!row.item) { status = 'invalid'; statusLabel = row.error; invalid += 1; }
    else if (duplicateKeys.has(row.key)) { status = 'duplicate_file'; statusLabel = 'Duplikat di file'; duplicatesInFile += 1; }
    else if (existingChecks[index]) { status = 'existing'; statusLabel = 'Sudah ada'; existing += 1; }
    else { status = 'valid'; statusLabel = 'Baru'; valid += 1; }
    return {
      line: row.line,
      status,
      statusLabel,
      item: row.item ? {
        itemCode: row.item.itemCode, name: row.item.name, supplier: row.item.supplier,
        category: row.item.category, unitPriceRupiah: row.item.unitPriceRupiah,
        purchaseQuantity: Number(row.item.purchaseQtyMilli) / 1000,
        purchaseUnit: row.item.purchaseUnit,
        stockQuantity: Number(row.item.stockQtyMilli) / 1000,
        stockUnit: row.item.stockUnit,
        notes: row.item.notes,
      } : null,
    };
  });
  return json({ total: rows.length, valid, existing, duplicatesInFile, invalid, rows: resultRows });
}

function restoreItem(item) {
  const normalized = normalizeItem(item);
  const id = String(item.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('ID pada cadangan tidak valid.');
  const createdAt = String(item.createdAt || '');
  const updatedAt = String(item.updatedAt || '');
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new AppError(`Timestamp pada barang ${item.itemCode} tidak valid.`);
  }
  return { normalized, id, createdAt, updatedAt };
}

function restoreActivity(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError('Entri aktivitas pada cadangan tidak valid.');
  const id = String(row.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('ID aktivitas pada cadangan tidak valid.');
  const itemId = row.item_id == null || row.item_id === '' ? null : String(row.item_id);
  if (itemId && !/^[0-9a-f-]{36}$/i.test(itemId)) throw new AppError('ID barang dalam aktivitas cadangan tidak valid.');
  const eventType = cleanText(row.event_type, 'Jenis aktivitas', 80);
  const itemCode = cleanText(row.item_code, 'Kode barang aktivitas', 60, false);
  const itemName = cleanText(row.item_name, 'Nama barang aktivitas', 160, false);
  const summary = cleanText(row.summary, 'Ringkasan aktivitas', 500);
  const detailsJson = String(row.details_json || '{}');
  if (detailsJson.length > 10_000) throw new AppError('Rincian aktivitas pada cadangan terlalu besar.');
  let details;
  try { details = JSON.parse(detailsJson); } catch { throw new AppError('Rincian aktivitas pada cadangan tidak valid.'); }
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new AppError('Rincian aktivitas pada cadangan harus berupa objek JSON.');
  }
  const createdAt = String(row.created_at || '');
  if (!Number.isFinite(Date.parse(createdAt))) throw new AppError('Tanggal aktivitas pada cadangan tidak valid.');
  return { id, eventType, itemId, itemCode: itemCode || null, itemName: itemName || null,
    summary, detailsJson: JSON.stringify(details), createdAt };
}

async function restoreBackup(request, env) {
  const body = await readJson(request, 6_000_000);
  const backup = body?.backup;
  if (body?.confirmationPhrase !== 'PULIHKAN') {
    throw new AppError('Ketik PULIHKAN untuk mengonfirmasi pemulihan cadangan.', 400, 'RESTORE_CONFIRMATION_REQUIRED');
  }
  if (!backup || backup.schemaVersion !== 1 || !Array.isArray(backup.items) || !Array.isArray(backup.priceHistory)
    || (backup.activity !== undefined && !Array.isArray(backup.activity))) {
    throw new AppError('Berkas cadangan tidak dikenali atau versinya tidak didukung.', 400, 'INVALID_BACKUP');
  }
  if (backup.items.length > 50_000 || backup.priceHistory.length > 200_000 || (backup.activity || []).length > 200_000) {
    throw new AppError('Berkas cadangan melebihi batas pemulihan.', 413, 'BACKUP_TOO_LARGE');
  }
  const entries = backup.items.map(restoreItem);
  const activities = (backup.activity || []).map(restoreActivity);
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new AppError('Berkas cadangan berisi ID barang duplikat.');
    ids.add(entry.id);
  }
  let restored = 0;
  for (let offset = 0; offset < entries.length; offset += 100) {
    const chunk = entries.slice(offset, offset + 100);
    const statements = [];
    for (const entry of chunk) {
      const { normalized: item, id, createdAt, updatedAt } = entry;
      const conflict = await env.DB.prepare(`SELECT id FROM items WHERE (lower(item_code) = lower(?) AND lower(supplier) = lower(?)) AND id <> ?`)
        .bind(item.itemCode, item.supplier, id).first();
      if (conflict) throw new AppError(`Kode ${item.itemCode} untuk ${item.supplier} sudah dipakai oleh barang lain.`, 409, 'DUPLICATE_ITEM');
      statements.push(env.DB.prepare(`${INSERT_SQL} ON CONFLICT(id) DO UPDATE SET
        item_code = excluded.item_code, name = excluded.name, supplier = excluded.supplier,
        category = excluded.category, unit_price_rupiah = excluded.unit_price_rupiah,
        purchase_qty_milli = excluded.purchase_qty_milli, purchase_unit = excluded.purchase_unit,
        stock_qty_milli = excluded.stock_qty_milli, stock_unit = excluded.stock_unit,
        purchase_total_milli = excluded.purchase_total_milli, inventory_value_milli = excluded.inventory_value_milli,
        notes = excluded.notes, updated_at = excluded.updated_at, revision = items.revision + 1`)
        .bind(...sqlValues(item, id, createdAt, updatedAt)));
    }
    await env.DB.batch(statements);
    restored += chunk.length;
  }
  for (let offset = 0; offset < backup.priceHistory.length; offset += 100) {
    const chunk = backup.priceHistory.slice(offset, offset + 100);
    const statements = chunk.map((row) => {
      const id = String(row.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('ID riwayat pada cadangan tidak valid.');
      return env.DB.prepare(`INSERT OR IGNORE INTO price_history (id, item_id, item_code, item_name,
        old_price_rupiah, new_price_rupiah, old_supplier, new_supplier, old_unit, new_unit, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, String(row.item_id || ''), String(row.item_code || ''),
          String(row.item_name || ''), Number(row.old_price_rupiah), Number(row.new_price_rupiah),
          String(row.old_supplier || ''), String(row.new_supplier || ''), String(row.old_unit || ''),
          String(row.new_unit || ''), String(row.changed_at || new Date().toISOString()));
    });
    await env.DB.batch(statements);
  }
  for (let offset = 0; offset < activities.length; offset += 100) {
    const chunk = activities.slice(offset, offset + 100);
    const statements = chunk.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO activity_log
      (id, event_type, item_id, item_code, item_name, summary, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.eventType, row.itemId, row.itemCode,
        row.itemName, row.summary, row.detailsJson, row.createdAt));
    await env.DB.batch(statements);
  }
  const timestamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO activity_log (id, event_type, summary, details_json, created_at)
    VALUES (?, 'pulihkan_cadangan', ?, ?, ?)`)
    .bind(newId(), `${restored} barang dipulihkan dari cadangan.`, JSON.stringify({ restored }), timestamp).run();
  return json({ restored, merged: true, deleted: 0, message: 'Cadangan digabungkan; data yang tidak ada di cadangan tetap dipertahankan.' });
}

export async function handleTransfers(request, env, segments) {
  if (segments.length === 2 && segments[0] === 'import' && segments[1] === 'preview' && request.method === 'POST') return previewImport(request, env);
  if (segments.length === 1 && segments[0] === 'import' && request.method === 'POST') return importRows(request, env);
  if (segments.length === 1 && segments[0] === 'export.csv' && request.method === 'GET') return exportCsv(env);
  if (segments.length === 1 && segments[0] === 'backup.json' && request.method === 'GET') return exportBackup(env);
  if (segments.length === 2 && segments[0] === 'backup' && segments[1] === 'restore' && request.method === 'POST') return restoreBackup(request, env);
  throw new AppError('Endpoint tidak ditemukan.', 404, 'NOT_FOUND');
}
