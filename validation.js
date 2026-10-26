export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

import { areUnitsConvertible, calculateInventoryValueMilli } from '../public/units.js';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PRICE = 999_999_999_999;
const MAX_QUANTITY_MILLI = 1_000_000_000_000;

export function cleanText(value, label, maxLength, required = true) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new AppError(`${label} wajib diisi.`);
  if (text.length > maxLength) throw new AppError(`${label} maksimal ${maxLength} karakter.`);
  return text;
}

export function parsePrice(value, label = 'Harga satuan') {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(text)) {
    throw new AppError(`${label} harus berupa rupiah bulat dan tidak boleh negatif.`, 400, 'INVALID_NUMBER');
  }
  const price = Number(text);
  if (!Number.isSafeInteger(price) || price > MAX_PRICE) {
    throw new AppError(`${label} terlalu besar.`, 400, 'INVALID_NUMBER');
  }
  return price;
}

export function parseQuantityMilli(value, label = 'Kuantitas') {
  let text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(text)) {
    throw new AppError(`${label} harus angka nonnegatif dengan maksimal 3 angka desimal.`, 400, 'INVALID_NUMBER');
  }
  const [whole, fraction = ''] = text.split('.');
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
  if (scaled > BigInt(MAX_QUANTITY_MILLI)) {
    throw new AppError(`${label} terlalu besar.`, 400, 'INVALID_NUMBER');
  }
  return Number(scaled);
}

export function formatQuantityMilli(value) {
  const n = Number(value || 0);
  const whole = Math.floor(n / 1000);
  const fractional = String(n % 1000).padStart(3, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : String(whole);
}

export function calculateMilliRupiah(priceRupiah, quantityMilli, label) {
  const total = BigInt(priceRupiah) * BigInt(quantityMilli);
  if (total > MAX_SAFE) throw new AppError(`${label} melewati batas angka aman.`, 400, 'AMOUNT_TOO_LARGE');
  return Number(total);
}

export function normalizeItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Format data barang tidak valid.');
  }
  const itemCode = cleanText(input.itemCode ?? input.item_code, 'Kode barang', 60);
  const name = cleanText(input.name ?? input.nama, 'Nama barang', 160);
  const supplier = cleanText(input.supplier, 'Nama supplier', 120);
  const category = cleanText(input.category ?? input.kategori, 'Kategori barang', 80);
  const purchaseUnit = cleanText(input.purchaseUnit ?? input.purchase_unit, 'Satuan pembelian', 24);
  const stockUnit = cleanText(input.stockUnit ?? input.stock_unit, 'Satuan stok', 24);
  const unitPriceRupiah = parsePrice(input.unitPriceRupiah ?? input.unit_price_rupiah ?? input.price, 'Harga satuan');
  const purchaseQtyMilli = parseQuantityMilli(input.purchaseQuantity ?? input.purchase_qty ?? input.purchase_qty_milli / 1000, 'Kuantitas pembelian');
  const stockQtyMilli = parseQuantityMilli(input.stockQuantity ?? input.stock_qty ?? input.stock_qty_milli / 1000, 'Stok tersedia');
  const notes = cleanText(input.notes ?? input.catatan, 'Catatan', 2000, false);
  const purchaseTotalMilli = calculateMilliRupiah(unitPriceRupiah, purchaseQtyMilli, 'Total harga pembelian');
  if (!areUnitsConvertible(stockUnit, purchaseUnit)) {
    throw new AppError('Satuan stok harus sama atau dapat dikonversi ke satuan pembelian.', 400, 'INCOMPATIBLE_UNITS');
  }
  let inventoryValueMilli;
  try {
    inventoryValueMilli = calculateInventoryValueMilli(unitPriceRupiah, stockQtyMilli, stockUnit, purchaseUnit);
  } catch (error) {
    throw new AppError(error.message || 'Nilai persediaan melewati batas angka aman.', 400, 'AMOUNT_TOO_LARGE');
  }
  return {
    itemCode, name, supplier, category, unitPriceRupiah,
    purchaseQtyMilli, purchaseUnit, stockQtyMilli, stockUnit,
    purchaseTotalMilli, inventoryValueMilli, notes,
  };
}

export function itemForClient(row) {
  return {
    id: row.id,
    itemCode: row.item_code,
    name: row.name,
    supplier: row.supplier,
    category: row.category,
    unitPriceRupiah: row.unit_price_rupiah,
    purchaseQuantity: formatQuantityMilli(row.purchase_qty_milli),
    purchaseUnit: row.purchase_unit,
    stockQuantity: formatQuantityMilli(row.stock_qty_milli),
    stockUnit: row.stock_unit,
    purchaseTotalMilli: row.purchase_total_milli,
    inventoryValueMilli: row.inventory_value_milli,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

export function itemValues(item) {
  return [
    item.id, item.itemCode, item.name, item.supplier, item.category,
    item.unitPriceRupiah, item.purchaseQtyMilli, item.purchaseUnit,
    item.stockQtyMilli, item.stockUnit, item.purchaseTotalMilli,
    item.inventoryValueMilli, item.notes, item.createdAt, item.updatedAt,
  ];
}
