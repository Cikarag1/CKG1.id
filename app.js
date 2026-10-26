const state = {
  csrfToken: '',
  username: '',
  items: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  itemPage: 1,
  historyPage: 1,
  editingItem: null,
  deletingItem: null,
  pendingImport: null,
  pendingBackup: null,
  searchTimer: null,
  compareTimer: null,
  loading: false,
};

import { areUnitsConvertible, calculateInventoryValueMilli } from './units.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ids = (id) => document.getElementById(id);
const encoder = new TextEncoder();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatRupiah(value, scaled = false) {
  try {
    const total = BigInt(value || 0);
    const rupiah = scaled ? total / 1000n : total;
    const fractional = scaled ? total % 1000n : 0n;
    const wholeText = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(rupiah);
    if (!fractional) return `Rp${wholeText}`;
    const decimal = String(fractional).padStart(3, '0').replace(/0+$/, '');
    return `Rp${wholeText},${decimal}`;
  } catch {
    return '—';
  }
}

function formatQuantity(value) {
  const [whole = '0', fraction = ''] = String(value ?? '0').split(/[.,]/);
  const formattedWhole = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(BigInt(whole || 0));
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${formattedWhole},${trimmedFraction}` : formattedWhole;
}

function formatQuantityMilli(value) {
  const milli = BigInt(value || 0);
  const whole = milli / 1000n;
  const rest = milli % 1000n;
  const formattedWhole = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(whole);
  if (!rest) return formattedWhole;
  return `${formattedWhole},${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat('id-ID', includeTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function status(text, kind = 'saved') {
  ids('save-status').dataset.state = kind;
  ids('save-status-text').textContent = text;
  ids('sidebar-status').textContent = kind === 'error' || kind === 'offline' ? 'Perlu diperiksa' : text;
  ids('connection-banner').hidden = !(kind === 'error' || kind === 'offline');
}

function toast(message, kind = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'error' ? 'error' : ''}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.innerHTML = `<span class="toast-mark" aria-hidden="true">${kind === 'error' ? '!' : '✓'}</span><span>${escapeHtml(message)}</span>`;
  ids('toast-region').append(node);
  window.setTimeout(() => node.remove(), 4600);
}

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) headers.set('x-csrf-token', state.csrfToken);
  try {
    const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin', cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/auth/login') {
        state.csrfToken = '';
        showLogin('Sesi berakhir. Silakan masuk kembali.');
      }
      const message = data?.error?.message || `Permintaan gagal (HTTP ${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      error.code = data?.error?.code;
      throw error;
    }
    status('Tersambung', 'saved');
    return data;
  } catch (error) {
    if (!error.status) status('Koneksi gagal', 'offline');
    throw error;
  }
}

function showLogin(message = '') {
  ids('app-view').hidden = true;
  ids('login-view').hidden = false;
  ids('login-message').textContent = message;
  ids('login-password').value = '';
  window.setTimeout(() => ids('login-username').focus(), 0);
}

function showApp(username) {
  state.username = username || 'Operator';
  ids('operator-name').textContent = state.username;
  ids('login-view').hidden = true;
  ids('app-view').hidden = false;
}

async function checkSession() {
  try {
    const session = await api('/api/auth/session');
    if (!session.authenticated) {
      showLogin();
      return;
    }
    state.csrfToken = session.csrfToken || '';
    showApp(session.username);
    await refreshAll();
  } catch (error) {
    showLogin(error.message || 'Layanan belum tersedia. Periksa konfigurasi backend.');
    status('Backend belum siap', 'offline');
  }
}

async function refreshAll() {
  status('Memuat data', 'saving');
  await Promise.all([loadStats(), loadItems(), loadFilters(), loadDashboardActivity()]);
  ids('last-updated').textContent = `Data diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
}

async function loadStats() {
  const data = await api('/api/stats');
  ids('stat-items').textContent = new Intl.NumberFormat('id-ID').format(data.totalItems || 0);
  ids('stat-suppliers').textContent = new Intl.NumberFormat('id-ID').format(data.totalSuppliers || 0);
  ids('stat-changed').textContent = new Intl.NumberFormat('id-ID').format(data.priceChangedItems || 0);
  ids('stat-inventory').textContent = formatRupiah(data.inventoryValueMilli, true);
  ids('stat-stock').textContent = (data.stockByUnit || []).length
    ? data.stockByUnit.map((item) => `${formatQuantityMilli(item.quantity)} ${item.unit}`).join(' · ')
    : '0';
  if (data.mostExpensive) {
    ids('stat-highest').textContent = formatRupiah(data.mostExpensive.unitPriceRupiah);
    ids('stat-highest-label').textContent = `${data.mostExpensive.name} · ${data.mostExpensive.supplier} / ${data.mostExpensive.unit}`;
  } else {
    ids('stat-highest').textContent = '—';
    ids('stat-highest-label').textContent = 'Belum ada barang';
  }
  if (data.cheapestComparable) {
    ids('stat-lowest').textContent = formatRupiah(data.cheapestComparable.unitPriceRupiah);
    ids('stat-lowest-label').textContent = `${data.cheapestComparable.name} · ${data.cheapestComparable.supplier} / ${data.cheapestComparable.unit}`;
  } else {
    ids('stat-lowest').textContent = '—';
    ids('stat-lowest-label').textContent = 'Perlu lebih dari satu supplier dengan satuan sama';
  }
}

function currentFilters() {
  return {
    q: ids('item-search').value.trim() || ids('global-search').value.trim(),
    supplier: ids('supplier-filter').value,
    category: ids('category-filter').value,
    minPrice: ids('min-price-filter').value,
    maxPrice: ids('max-price-filter').value,
    sort: ids('sort-filter').value,
    page: state.itemPage,
    pageSize: 25,
  };
}

async function loadItems() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentFilters())) if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
  const data = await api(`/api/items?${params.toString()}`);
  if (data.pagination && state.itemPage > data.pagination.totalPages) {
    state.itemPage = data.pagination.totalPages;
    return loadItems();
  }
  state.items = data.items || [];
  state.pagination = data.pagination || { page: 1, pageSize: 25, total: 0, totalPages: 1 };
  renderItems();
}

function rowMarkup(item, includeValue = false) {
  const itemData = escapeHtml(JSON.stringify(item));
  return `<tr data-item-id="${escapeHtml(item.id)}">
    <td><span class="item-primary">${escapeHtml(item.name)}</span><span class="item-secondary">${escapeHtml(item.itemCode)} · ${escapeHtml(item.category)}</span></td>
    <td>${escapeHtml(item.supplier)}</td>
    <td><span class="money-cell">${formatRupiah(item.unitPriceRupiah)}</span><small>${escapeHtml(item.purchaseUnit)} / satuan</small></td>
    <td>${formatQuantity(item.purchaseQuantity)} ${escapeHtml(item.purchaseUnit)}</td>
    <td><span class="stock-chip">${formatQuantity(item.stockQuantity)} ${escapeHtml(item.stockUnit)}</span></td>
    ${includeValue ? `<td><span class="money-cell">${formatRupiah(item.inventoryValueMilli, true)}</span></td>` : ''}
    <td>${formatDate(item.updatedAt)}</td>
    <td><div class="row-actions"><button class="row-action" type="button" data-action="detail" data-item='${itemData}' aria-label="Lihat detail ${escapeHtml(item.name)}" title="Detail">◉</button><button class="row-action" type="button" data-action="edit" data-item='${itemData}' aria-label="Edit ${escapeHtml(item.name)}" title="Edit">✎</button><button class="row-action delete" type="button" data-action="delete" data-item='${itemData}' aria-label="Hapus ${escapeHtml(item.name)}" title="Hapus">×</button></div></td>
  </tr>`;
}

function renderItems() {
  const body = ids('items-table-body');
  const dashBody = ids('dashboard-table-body');
  const isSearching = Boolean(currentFilters().q || currentFilters().supplier || currentFilters().category || currentFilters().minPrice || currentFilters().maxPrice);
  if (!state.items.length) {
    body.innerHTML = '';
    dashBody.innerHTML = '';
    ids('items-empty').hidden = false;
    ids('dashboard-empty').hidden = false;
    ids('items-empty-title').textContent = isSearching ? 'Data tidak ditemukan' : 'Belum ada barang tercatat';
    ids('items-empty-message').textContent = isSearching ? 'Ubah kata kunci atau reset filter.' : 'Mulai dengan menambahkan barang dari supplier.';
    ids('items-empty-add').hidden = isSearching;
    ids('items-summary').textContent = isSearching ? 'Tidak ada hasil' : '0 barang';
    ids('page-label').textContent = 'Halaman 1 dari 1';
    ids('page-prev').disabled = true;
    ids('page-next').disabled = true;
    return;
  }
  ids('items-empty').hidden = true;
  ids('dashboard-empty').hidden = true;
  body.innerHTML = state.items.map((item) => rowMarkup(item, true)).join('');
  dashBody.innerHTML = state.items.slice(0, 5).map((item) => rowMarkup(item, false)).join('');
  const start = (state.pagination.page - 1) * state.pagination.pageSize + 1;
  const end = Math.min(start + state.items.length - 1, state.pagination.total);
  ids('items-summary').textContent = `Menampilkan ${new Intl.NumberFormat('id-ID').format(start)}–${new Intl.NumberFormat('id-ID').format(end)} dari ${new Intl.NumberFormat('id-ID').format(state.pagination.total)} barang`;
  ids('page-label').textContent = `Halaman ${state.pagination.page} dari ${state.pagination.totalPages}`;
  ids('page-prev').disabled = state.pagination.page <= 1;
  ids('page-next').disabled = state.pagination.page >= state.pagination.totalPages;
}

async function loadFilters() {
  const data = await api('/api/filters');
  fillSelect(ids('supplier-filter'), data.suppliers || [], 'Semua supplier');
  fillSelect(ids('category-filter'), data.categories || [], 'Semua kategori');
}

function fillSelect(select, values, firstLabel) {
  const previous = select.value;
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>` + values.map((row) => `<option value="${escapeHtml(row.value)}">${escapeHtml(row.value)}</option>`).join('');
  if (values.some((row) => row.value === previous)) select.value = previous;
}

async function loadDashboardActivity() {
  const data = await api('/api/history?page=1&pageSize=8');
  const activity = data.activity || [];
  ids('dashboard-activity').innerHTML = activity.length ? activity.slice(0, 6).map((row) => `<div class="activity-item"><span class="activity-mark" aria-hidden="true">${activityGlyph(row.event_type)}</span><div class="activity-copy">${escapeHtml(row.summary)}<small class="item-secondary">${escapeHtml(row.item_code || '')}${row.item_name ? ` · ${escapeHtml(row.item_name)}` : ''}</small></div><time class="activity-time">${formatDate(row.created_at)}</time></div>`).join('') : '<div class="table-placeholder">Belum ada aktivitas.</div>';
}

function activityGlyph(type) {
  return ({ buat: '+', ubah: '↻', harga_diperbarui: '↕', hapus: '−', impor_tambah: '⇧', impor_perbarui: '↻', pulihkan_cadangan: '↧' })[type] || '·';
}

function setView(view) {
  const valid = ['dashboard', 'items', 'compare', 'history', 'backup'].includes(view) ? view : 'dashboard';
  $$('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === valid));
  $$('.nav-link[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === valid));
  ids('page-heading').textContent = ({ dashboard: 'Ringkasan', items: 'Daftar barang', compare: 'Bandingkan harga', history: 'Riwayat perubahan', backup: 'Impor & cadangan' })[valid];
  closeSidebar();
  if (valid === 'compare') loadComparisons().catch((error) => toast(error.message, 'error'));
  if (valid === 'history') loadHistory().catch((error) => toast(error.message, 'error'));
  if (valid === 'items') loadItems().catch((error) => toast(error.message, 'error'));
}

function openModal(id) {
  const dialog = ids(id);
  if (dialog && !dialog.open) dialog.showModal();
}
function closeModal(id) {
  const dialog = ids(id);
  if (dialog?.open) dialog.close();
}

function closeSidebar() {
  ids('sidebar').classList.remove('open');
  ids('sidebar-scrim').hidden = true;
}

function newItemForm() {
  state.editingItem = null;
  ids('item-form').reset();
  ids('item-form-error').textContent = '';
  ids('item-dialog-title').textContent = 'Tambah barang';
  ids('item-form-eyebrow').textContent = 'DATA BARU';
  ids('item-save-button').textContent = 'Simpan barang';
  updateCalculationPreview();
  openModal('item-dialog');
}

function editItem(item) {
  state.editingItem = item;
  const form = ids('item-form');
  form.elements.itemCode.value = item.itemCode;
  form.elements.name.value = item.name;
  form.elements.supplier.value = item.supplier;
  form.elements.category.value = item.category;
  form.elements.unitPriceRupiah.value = item.unitPriceRupiah;
  form.elements.purchaseUnit.value = item.purchaseUnit;
  form.elements.purchaseQuantity.value = item.purchaseQuantity.replace('.', ',');
  form.elements.stockQuantity.value = item.stockQuantity.replace('.', ',');
  form.elements.stockUnit.value = item.stockUnit;
  form.elements.notes.value = item.notes || '';
  ids('item-form-error').textContent = '';
  ids('item-dialog-title').textContent = 'Edit barang';
  ids('item-form-eyebrow').textContent = 'PERBARUI DATA';
  ids('item-save-button').textContent = 'Simpan perubahan';
  updateCalculationPreview();
  openModal('item-dialog');
}

function parseQuantityInput(value) {
  const clean = String(value || '').trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(clean)) return null;
  return clean;
}

function updateCalculationPreview() {
  const form = ids('item-form');
  const price = BigInt(form.elements.unitPriceRupiah.value || 0);
  const purchase = parseQuantityInput(form.elements.purchaseQuantity.value);
  const stock = parseQuantityInput(form.elements.stockQuantity.value);
  function scaled(text) {
    if (!text) return 0n;
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
  }
  ids('purchase-total-preview').textContent = formatRupiah(price * scaled(purchase), true);
  const purchaseUnit = form.elements.purchaseUnit.value;
  const stockUnit = form.elements.stockUnit.value;
  if (!areUnitsConvertible(stockUnit, purchaseUnit)) {
    ids('inventory-value-preview').textContent = 'Satuan tidak sebanding';
    return;
  }
  try {
    const stockValueMilli = calculateInventoryValueMilli(Number(price), Number(scaled(stock)), stockUnit, purchaseUnit);
    ids('inventory-value-preview').textContent = formatRupiah(stockValueMilli, true);
  } catch {
    ids('inventory-value-preview').textContent = 'Melebihi batas aman';
  }
}

async function saveItem(event) {
  event.preventDefault();
  if (state.loading) return;
  const form = ids('item-form');
  const data = Object.fromEntries(new FormData(form).entries());
  if (!form.reportValidity()) return;
  const payload = {
    itemCode: data.itemCode,
    name: data.name,
    supplier: data.supplier,
    category: data.category,
    unitPriceRupiah: data.unitPriceRupiah,
    purchaseQuantity: data.purchaseQuantity.replace(',', '.'),
    purchaseUnit: data.purchaseUnit,
    stockQuantity: data.stockQuantity.replace(',', '.'),
    stockUnit: data.stockUnit,
    notes: data.notes,
  };
  if (state.editingItem) payload.expectedUpdatedAt = state.editingItem.updatedAt;
  const button = ids('item-save-button');
  state.loading = true;
  button.disabled = true;
  button.textContent = 'Menyimpan…';
  status('Menyimpan', 'saving');
  try {
    const result = await api(state.editingItem ? `/api/items/${encodeURIComponent(state.editingItem.id)}` : '/api/items', {
      method: state.editingItem ? 'PUT' : 'POST', body: JSON.stringify(payload),
    });
    closeModal('item-dialog');
    toast(state.editingItem ? 'Perubahan barang berhasil disimpan.' : 'Barang baru berhasil disimpan.');
    await refreshAll();
  } catch (error) {
    ids('item-form-error').textContent = error.message;
    toast(error.message, 'error');
  } finally {
    state.loading = false;
    button.disabled = false;
    button.textContent = state.editingItem ? 'Simpan perubahan' : 'Simpan barang';
    if (state.editingItem && !ids('item-dialog').open) state.editingItem = null;
  }
}

function showDetail(item) {
  ids('detail-title').textContent = item.name;
  ids('detail-content').innerHTML = '<div class="table-placeholder">Memuat detail…</div>';
  openModal('detail-dialog');
  api(`/api/items/${encodeURIComponent(item.id)}`).then((data) => {
    const row = data.item;
    const fields = [
      ['Kode barang', row.itemCode], ['Supplier', row.supplier], ['Kategori', row.category],
      ['Harga satuan', formatRupiah(row.unitPriceRupiah)], ['Kuantitas pembelian', `${formatQuantity(row.purchaseQuantity)} ${row.purchaseUnit}`],
      ['Total harga pembelian', formatRupiah(row.purchaseTotalMilli, true)], ['Stok tersedia', `${formatQuantity(row.stockQuantity)} ${row.stockUnit}`],
      ['Nilai persediaan', formatRupiah(row.inventoryValueMilli, true)], ['Tanggal dicatat', formatDate(row.createdAt)],
      ['Terakhir diperbarui', formatDate(row.updatedAt)], ['Catatan', row.notes || '—'],
    ];
    const fieldsMarkup = fields.map(([label, value]) => `<div class="detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    const historyMarkup = (data.priceHistory || []).length ? data.priceHistory.map((history) => `<div class="detail-history-item"><span>${formatDate(history.changed_at)} · ${escapeHtml(history.old_supplier)} → ${escapeHtml(history.new_supplier)}</span><strong>${formatRupiah(history.old_price_rupiah)} → ${formatRupiah(history.new_price_rupiah)}</strong></div>`).join('') : '<p class="muted">Belum ada perubahan harga.</p>';
    ids('detail-content').innerHTML = `<div class="detail-grid">${fieldsMarkup}</div><div class="detail-block"><h3>Riwayat harga</h3>${historyMarkup}</div>`;
  }).catch((error) => { ids('detail-content').textContent = error.message; });
}

function confirmDelete(item) {
  state.deletingItem = item;
  ids('delete-message').textContent = `“${item.name}” dari ${item.supplier} akan dihapus dari daftar aktif. Riwayat harga yang sudah tercatat tetap disimpan.`;
  ids('delete-error').textContent = '';
  openModal('delete-dialog');
}

async function deleteItem() {
  const item = state.deletingItem;
  if (!item || state.loading) return;
  state.loading = true;
  ids('delete-confirm').disabled = true;
  ids('delete-confirm').textContent = 'Menghapus…';
  status('Menyimpan', 'saving');
  try {
    await api(`/api/items/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: item.updatedAt }) });
    closeModal('delete-dialog');
    toast('Barang dihapus. Riwayat harganya tetap tersimpan.');
    state.deletingItem = null;
    await refreshAll();
  } catch (error) {
    ids('delete-error').textContent = error.message;
    toast(error.message, 'error');
    if (error.status === 409) await loadItems();
  } finally {
    state.loading = false;
    ids('delete-confirm').disabled = false;
    ids('delete-confirm').textContent = 'Hapus barang';
  }
}

async function loadComparisons() {
  const q = ids('compare-search').value.trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const data = await api(`/api/compare?${params}`);
  const groups = data.comparisons || [];
  ids('compare-count').textContent = `${groups.length} jenis barang dengan satuan yang sebanding`;
  ids('compare-empty').hidden = groups.length > 0;
  ids('compare-list').innerHTML = groups.map((group) => `<section class="compare-group"><div class="compare-group-head"><strong>${escapeHtml(group.name)}</strong><span>Satuan pembanding: ${escapeHtml(group.unit)} · ${group.suppliersCompared} supplier</span></div><div class="compare-row compare-head"><span>Supplier</span><span>Harga satuan</span><span>Kuantitas pembelian</span><span>Satuan</span><span>Harga diperbarui</span></div>${group.suppliers.map((item) => `<div class="compare-row ${item.unitPriceRupiah === group.cheapestPriceRupiah ? 'cheapest' : ''}"><span><strong>${escapeHtml(item.supplier)}</strong><small class="item-secondary">${escapeHtml(item.itemCode)}</small></span><span class="compare-price">${formatRupiah(item.unitPriceRupiah)} ${item.unitPriceRupiah === group.cheapestPriceRupiah ? '<span class="lowest-chip">Termurah</span>' : ''}</span><span>${formatQuantity(item.purchaseQuantity)} ${escapeHtml(group.unit)}</span><span>${escapeHtml(group.unit)}</span><span>${formatDate(item.updatedAt)}</span></div>`).join('')}</section>`).join('');
}

async function loadHistory() {
  const data = await api(`/api/history?page=${state.historyPage}&pageSize=25`);
  const entries = data.priceHistory || [];
  ids('history-count').textContent = `${new Intl.NumberFormat('id-ID').format(data.pagination.total || 0)} perubahan harga tercatat`;
  ids('history-empty').hidden = entries.length > 0;
  ids('history-table-body').innerHTML = entries.length ? entries.map((row) => `<tr><td>${formatDate(row.changed_at)}</td><td><span class="item-primary">${escapeHtml(row.item_name)}</span><span class="item-secondary">${escapeHtml(row.item_code)}</span></td><td>${escapeHtml(row.old_supplier)} → ${escapeHtml(row.new_supplier)}</td><td>${formatRupiah(row.old_price_rupiah)}</td><td><span class="money-cell">${formatRupiah(row.new_price_rupiah)}</span></td><td>${escapeHtml(row.old_unit)} → ${escapeHtml(row.new_unit)}</td></tr>`).join('') : '';
  ids('history-page-label').textContent = `Halaman ${data.pagination.page} dari ${data.pagination.totalPages}`;
  ids('history-prev').disabled = data.pagination.page <= 1;
  ids('history-next').disabled = data.pagination.page >= data.pagination.totalPages;
}

function parseCsv(text) {
  const sample = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delimiter = (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('Terdapat tanda kutip yang tidak berpasangan di file CSV.');
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function canonicalHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const CSV_KEY_MAP = {
  kode_barang: 'itemCode', kode: 'itemCode', item_code: 'itemCode',
  nama_barang: 'name', nama: 'name', name: 'name',
  supplier: 'supplier', nama_supplier: 'supplier',
  kategori: 'category', jenis_barang: 'category', category: 'category',
  harga_satuan_rp: 'unitPriceRupiah', harga_satuan: 'unitPriceRupiah', harga: 'unitPriceRupiah',
  kuantitas_pembelian: 'purchaseQuantity', kuantitas: 'purchaseQuantity',
  satuan_pembelian: 'purchaseUnit', satuan: 'purchaseUnit',
  stok_tersedia: 'stockQuantity', stok: 'stockQuantity',
  satuan_stok: 'stockUnit', catatan: 'notes', notes: 'notes',
};

function readCsvRows(text) {
  const matrix = parseCsv(text.replace(/^\uFEFF/, ''));
  if (matrix.length < 2) throw new Error('File CSV harus memiliki header dan setidaknya satu baris data.');
  const headers = matrix[0].map(canonicalHeader);
  const required = ['itemCode', 'name', 'supplier', 'category', 'unitPriceRupiah', 'purchaseQuantity', 'purchaseUnit', 'stockQuantity', 'stockUnit'];
  const mapped = headers.map((header) => CSV_KEY_MAP[header] || null);
  const missing = required.filter((key) => !mapped.includes(key));
  if (missing.length) throw new Error(`Kolom wajib belum lengkap: ${missing.join(', ')}.`);
  const data = matrix.slice(1).map((cells, index) => {
    const row = { _line: index + 2 };
    for (let i = 0; i < mapped.length; i += 1) if (mapped[i]) row[mapped[i]] = String(cells[i] ?? '').trim();
    return row;
  });
  if (data.length > 500) throw new Error('File terlalu besar untuk satu kali pratinjau. Bagi menjadi beberapa CSV dengan maksimal 500 baris.');
  return data;
}

async function previewImport(rows) {
  const result = await api('/api/import/preview', { method: 'POST', body: JSON.stringify({ rows }) });
  state.pendingImport = { rows, preview: result };
  ids('import-summary').textContent = `${result.total} baris · ${result.valid} valid · ${result.existing} duplikat di basis data · ${result.duplicatesInFile} duplikat di file · ${result.invalid} perlu diperbaiki`;
  ids('import-alerts').textContent = result.invalid || result.duplicatesInFile
    ? 'Periksa baris bertanda masalah. Baris tidak valid atau duplikat dalam file tidak akan diimpor.'
    : result.existing ? 'Ada kode/supplier yang sudah ada. Pilih tambah saja atau perbarui setelah memeriksa pratinjau.' : 'Tidak ditemukan duplikat. Periksa pratinjau lalu konfirmasi.';
  ids('import-preview-body').innerHTML = result.rows.slice(0, 30).map((row) => `<tr><td>${row.line}</td><td>${escapeHtml(row.item?.itemCode || '—')}</td><td>${escapeHtml(row.item?.name || '—')}</td><td>${escapeHtml(row.item?.supplier || '—')}</td><td>${row.item ? formatRupiah(row.item.unitPriceRupiah) : '—'}</td><td>${escapeHtml(row.statusLabel)}</td></tr>`).join('');
  if (result.rows.length > 30) ids('import-alerts').textContent += ` Pratinjau menampilkan 30 dari ${result.rows.length} baris.`;
  ids('import-confirm-checkbox').checked = false;
  ids('import-confirm').disabled = true;
  ids('import-error').textContent = '';
  openModal('import-dialog');
}

async function handleCsvFile(file) {
  if (!file) return;
  if (file.size > 2_000_000) { toast('Ukuran CSV maksimal 2 MB.', 'error'); return; }
  try {
    const rows = readCsvRows(await file.text());
    await previewImport(rows);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    ids('csv-file').value = '';
  }
}

async function importCsv() {
  if (!state.pendingImport || state.loading) return;
  const mode = $('input[name="import-mode"]:checked')?.value || 'add';
  const validRows = state.pendingImport.preview.rows.filter((row) => row.status === 'valid' || (row.status === 'existing' && mode === 'upsert')).map((row) => row.item);
  if (!validRows.length) { ids('import-error').textContent = 'Tidak ada baris valid untuk diimpor.'; return; }
  if (!ids('import-confirm-checkbox').checked) return;
  state.loading = true;
  ids('import-confirm').disabled = true;
  ids('import-confirm').textContent = 'Mengimpor…';
  status('Menyimpan', 'saving');
  try {
    let added = 0;
    let updated = 0;
    for (let offset = 0; offset < validRows.length; offset += 250) {
      const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ mode, confirmed: true, rows: validRows.slice(offset, offset + 250) }) });
      added += result.added || 0;
      updated += result.updated || 0;
    }
    closeModal('import-dialog');
    toast(`Impor selesai: ${added} ditambahkan, ${updated} diperbarui.`);
    state.pendingImport = null;
    await refreshAll();
  } catch (error) {
    ids('import-error').textContent = error.message;
    toast(error.message, 'error');
  } finally {
    state.loading = false;
    ids('import-confirm').disabled = !ids('import-confirm-checkbox').checked;
    ids('import-confirm').textContent = 'Impor data';
  }
}

async function downloadFile(path, fallbackName) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Unduhan gagal (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] || fallbackName;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function handleBackupFile(file) {
  if (!file) return;
  if (file.size > 6_000_000) { toast('Ukuran file cadangan maksimal 6 MB.', 'error'); return; }
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.schemaVersion !== 1 || !Array.isArray(backup.items) || !Array.isArray(backup.priceHistory)) throw new Error('File bukan cadangan Supplier Price Manager yang didukung.');
    state.pendingBackup = backup;
    ids('restore-summary').textContent = `${new Intl.NumberFormat('id-ID').format(backup.items.length)} barang dan ${new Intl.NumberFormat('id-ID').format(backup.priceHistory.length)} riwayat akan digabungkan. Data lain di server tidak dihapus.`;
    ids('restore-phrase').value = '';
    ids('restore-error').textContent = '';
    ids('restore-confirm').disabled = true;
    openModal('restore-dialog');
  } catch (error) { toast(error.message, 'error'); }
  finally { ids('backup-file').value = ''; }
}

async function restoreBackup() {
  if (!state.pendingBackup || state.loading) return;
  state.loading = true;
  ids('restore-confirm').disabled = true;
  ids('restore-confirm').textContent = 'Memulihkan…';
  status('Menyimpan', 'saving');
  try {
    const result = await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ backup: state.pendingBackup, confirmationPhrase: ids('restore-phrase').value }) });
    closeModal('restore-dialog');
    toast(`${result.restored} barang berhasil digabungkan dari cadangan.`);
    state.pendingBackup = null;
    await refreshAll();
  } catch (error) {
    ids('restore-error').textContent = error.message;
    toast(error.message, 'error');
  } finally {
    state.loading = false;
    ids('restore-confirm').disabled = ids('restore-phrase').value !== 'PULIHKAN';
    ids('restore-confirm').textContent = 'Gabungkan cadangan';
  }
}

function scheduleItemsReload() {
  window.clearTimeout(state.searchTimer);
  state.itemPage = 1;
  state.searchTimer = window.setTimeout(() => loadItems().catch((error) => toast(error.message, 'error')), 230);
}

function bindEvents() {
  ids('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    button.textContent = 'Memverifikasi…';
    ids('login-message').textContent = '';
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
      state.csrfToken = result.csrfToken;
      showApp(result.username);
      await refreshAll();
    } catch (error) {
      ids('login-message').textContent = error.message;
    } finally {
      button.disabled = false;
      button.innerHTML = 'Masuk <span aria-hidden="true">→</span>';
    }
  });

  ids('logout-button').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
    catch { /* Sesi server mungkin sudah berakhir; tetap bersihkan UI lokal. */ }
    state.csrfToken = '';
    showLogin('Anda telah keluar.');
  });

  ids('header-add').addEventListener('click', newItemForm);
  ids('item-form').addEventListener('submit', saveItem);
  ids('delete-confirm').addEventListener('click', deleteItem);
  ids('item-form').addEventListener('input', updateCalculationPreview);
  ids('item-form').addEventListener('change', updateCalculationPreview);
  ids('item-save-button').addEventListener('click', () => {});

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) { setView(nav.dataset.view); return; }
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'add') newItemForm();
      if (action.dataset.action === 'detail') showDetail(JSON.parse(action.dataset.item));
      if (action.dataset.action === 'edit') editItem(JSON.parse(action.dataset.item));
      if (action.dataset.action === 'delete') confirmDelete(JSON.parse(action.dataset.item));
      return;
    }
    const close = event.target.closest('[data-close]');
    if (close) closeModal(close.dataset.close);
  });

  ids('menu-toggle').addEventListener('click', () => {
    ids('sidebar').classList.add('open');
    ids('sidebar-scrim').hidden = false;
  });
  ids('sidebar-scrim').addEventListener('click', closeSidebar);
  ids('global-search').addEventListener('input', () => {
    ids('item-search').value = ids('global-search').value;
    if (!$('[data-panel="items"]').classList.contains('active')) setView('items');
    scheduleItemsReload();
  });
  ids('item-search').addEventListener('input', () => {
    ids('global-search').value = ids('item-search').value;
    scheduleItemsReload();
  });
  ['supplier-filter', 'category-filter', 'sort-filter', 'min-price-filter', 'max-price-filter'].forEach((id) => ids(id).addEventListener('change', scheduleItemsReload));
  ids('reset-filters').addEventListener('click', () => {
    ids('item-search').value = '';
    ids('global-search').value = '';
    ids('supplier-filter').value = '';
    ids('category-filter').value = '';
    ids('min-price-filter').value = '';
    ids('max-price-filter').value = '';
    ids('sort-filter').value = 'date_desc';
    state.itemPage = 1;
    loadItems().catch((error) => toast(error.message, 'error'));
  });
  ids('page-prev').addEventListener('click', () => { state.itemPage = Math.max(1, state.itemPage - 1); loadItems().catch((error) => toast(error.message, 'error')); });
  ids('page-next').addEventListener('click', () => { state.itemPage = Math.min(state.pagination.totalPages, state.itemPage + 1); loadItems().catch((error) => toast(error.message, 'error')); });
  ids('compare-search').addEventListener('input', () => {
    window.clearTimeout(state.compareTimer);
    state.compareTimer = window.setTimeout(() => loadComparisons().catch((error) => toast(error.message, 'error')), 250);
  });
  ids('history-prev').addEventListener('click', () => { state.historyPage = Math.max(1, state.historyPage - 1); loadHistory().catch((error) => toast(error.message, 'error')); });
  ids('history-next').addEventListener('click', () => { state.historyPage += 1; loadHistory().catch((error) => toast(error.message, 'error')); });
  ids('csv-file').addEventListener('change', (event) => handleCsvFile(event.target.files?.[0]));
  ids('backup-file').addEventListener('change', (event) => handleBackupFile(event.target.files?.[0]));
  ids('import-confirm-checkbox').addEventListener('change', (event) => { ids('import-confirm').disabled = !event.target.checked; });
  ids('import-confirm').addEventListener('click', importCsv);
  ids('restore-phrase').addEventListener('input', (event) => { ids('restore-confirm').disabled = event.target.value !== 'PULIHKAN'; });
  ids('restore-confirm').addEventListener('click', restoreBackup);
  ids('download-backup').addEventListener('click', () => downloadFile('/api/backup.json', 'cadangan-supplier-price-manager.json').catch((error) => toast(error.message, 'error')));
  ids('download-csv').addEventListener('click', () => downloadFile('/api/export.csv', 'cadangan-harga-supplier.csv').catch((error) => toast(error.message, 'error')));
  ids('retry-connection').addEventListener('click', () => refreshAll().catch((error) => toast(error.message, 'error')));
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.target.matches('input,textarea,select') && !ids('app-view').hidden) {
      event.preventDefault();
      ids('global-search').focus();
    }
  });
}

bindEvents();
checkSession();
