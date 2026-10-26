const unitProfiles = new Map([
  ['kg', ['massa', 1000]],
  ['kilogram', ['massa', 1000]],
  ['kilograms', ['massa', 1000]],
  ['g', ['massa', 1]],
  ['gram', ['massa', 1]],
  ['grams', ['massa', 1]],
  ['l', ['volume', 1000]],
  ['liter', ['volume', 1000]],
  ['litre', ['volume', 1000]],
  ['ml', ['volume', 1]],
  ['milliliter', ['volume', 1]],
  ['millilitre', ['volume', 1]],
  ['pc', ['jumlah', 1]],
  ['pcs', ['jumlah', 1]],
  ['piece', ['jumlah', 1]],
  ['pieces', ['jumlah', 1]],
  ['buah', ['jumlah', 1]],
  ['biji', ['jumlah', 1]],
  ['butir', ['jumlah', 1]],
  ['unit', ['jumlah', 1]],
  ['units', ['jumlah', 1]],
  ['ea', ['jumlah', 1]],
  ['satuan', ['jumlah', 1]],
]);

const MAX_SAFE_MILLI = BigInt(Number.MAX_SAFE_INTEGER);

function normalizeUnit(unit) {
  return String(unit ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
}

function profile(unit) {
  const key = normalizeUnit(unit);
  const known = unitProfiles.get(key);
  return known
    ? { dimension: known[0], baseFactor: BigInt(known[1]) }
    : { dimension: `exact:${key}`, baseFactor: 1n };
}

export function areUnitsConvertible(fromUnit, toUnit) {
  return profile(fromUnit).dimension === profile(toUnit).dimension;
}

export function calculateInventoryValueMilli(priceRupiah, stockQuantityMilli, stockUnit, purchaseUnit) {
  const from = profile(stockUnit);
  const to = profile(purchaseUnit);
  if (from.dimension !== to.dimension) {
    throw new RangeError('Satuan stok harus sama atau dapat dikonversi ke satuan pembelian.');
  }

  const price = BigInt(priceRupiah);
  const stock = BigInt(stockQuantityMilli);
  if (price < 0n || stock < 0n) throw new RangeError('Harga dan stok tidak boleh negatif.');

  // Nilai disimpan dalam seperseribu rupiah agar jumlah desimal tetap presisi.
  const numerator = price * stock * from.baseFactor;
  const roundedMilliRupiah = (numerator + to.baseFactor / 2n) / to.baseFactor;
  if (roundedMilliRupiah > MAX_SAFE_MILLI) {
    throw new RangeError('Nilai persediaan melewati batas angka aman.');
  }
  return Number(roundedMilliRupiah);
}
