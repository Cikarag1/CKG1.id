# TODO — Supplier Price Manager

## 1. Antarmuka dashboard dan responsivitas
- [x] Aplikasi menampilkan dashboard modern, profesional, bersih, dan mudah dipahami dengan sidebar navigasi, header berisi nama aplikasi dan kolom pencarian, kartu ringkasan statistik, tabel data yang rapi, form tambah/edit barang, modal konfirmasi saat menghapus data, notifikasi berhasil/gagal menyimpan, indikator status penyimpanan, serta tata letak responsif untuk HP dan komputer.
- [x] Nama aplikasi adalah “Supplier Price Manager”. Semua menu, tombol, label, notifikasi, serta petunjuk memakai bahasa Indonesia.

## 2. Model barang dan kalkulasi harga/stok
- [x] Setiap barang menyimpan ID barang otomatis dan unik; kode barang; nama barang; supplier; jenis/kategori barang; harga satuan dalam rupiah; kuantitas pembelian; satuan kuantitas seperti kg, gram, liter, ml, dus, karton, sak, pcs, atau unit; jumlah stok tersedia; satuan stok; total harga pembelian; tanggal pencatatan; tanggal terakhir diperbarui; dan catatan tambahan.
- [x] Kuantitas pembelian, stok tersedia, serta harga satuan menjadi kolom yang berbeda.
- [x] Total harga pembelian dihitung otomatis sebagai harga satuan × kuantitas pembelian. Nilai persediaan dihitung sebagai harga satuan × jumlah stok tersedia setelah konversi yang valid (kg ↔ gram, liter ↔ ml, pcs ↔ unit). Satuan yang tidak sama dan tidak dapat dikonversi ditolak, bukan dihitung dengan nilai yang menyesatkan. Format rupiah Indonesia menampilkan pemisah ribuan yang sesuai, dan perhitungan mencegah kesalahan desimal.

## 3. Pengelolaan data barang (CRUD)
- [x] Pengguna dapat menambah barang baru, melihat seluruh data barang, membuka detail barang, mengedit data barang, dan menghapus barang dengan konfirmasi.
- [x] Data tersimpan ke database; tabel dan statistik diperbarui tanpa memuat ulang halaman setelah data ditambah, diedit, atau dihapus.
- [x] Aplikasi mencegah formulir dikirim ganda, memvalidasi kolom wajib, menolak angka negatif, menangani kegagalan penyimpanan serta gangguan jaringan, dan memberi notifikasi status yang jelas.

## 4. Pencarian, filter, pengurutan dan halaman
- [x] Pencarian langsung bekerja untuk nama barang, kode barang, nama supplier, jenis barang, serta catatan barang, termasuk saat jumlah data mencapai ribuan baris.
- [x] Filter tersedia berdasarkan supplier, kategori, dan rentang harga. Pengurutan tersedia untuk harga terendah ke tertinggi, harga tertinggi ke terendah, nama barang A–Z, dan tanggal terbaru.
- [x] Tersedia pagination ketika data banyak, tombol reset filter, dan pesan ketika hasil pencarian tidak ditemukan.

## 5. Perbandingan supplier dan riwayat harga
- [x] Satu jenis barang dapat dicatat untuk beberapa supplier dengan harga berbeda. Perbandingan menampilkan nama supplier, harga satuan, satuan pengukuran, kuantitas pembelian, serta tanggal terakhir harga diperbarui.
- [x] Harga tidak dibandingkan langsung bila satuan berbeda kecuali ada konversi yang valid. Harga termurah hanya ditampilkan untuk barang dengan satuan yang dapat dibandingkan. Riwayat harga supplier sebelumnya tidak dihapus otomatis.
- [x] Perubahan harga disimpan sebagai riwayat yang menampilkan harga lama, harga baru, supplier, serta tanggal perubahan.

## 6. API, penyimpanan permanen dan autentikasi
- [x] Cloudflare D1 menjadi database utama; semua operasi tambah, edit, hapus, pencarian, serta pengambilan data menggunakan backend API yang terhubung ke D1.
- [ ] Data tidak hilang ketika halaman ditutup atau browser dibersihkan, dapat diakses dari perangkat lain melalui URL aplikasi, dan perubahan disimpan ke database cloud, bukan hanya di browser.
  > Kode API/D1 tersedia dan smoke test memakai D1 lokal. Persistensi remote dan lintas perangkat belum diverifikasi karena akun Cloudflare/ID D1 pemilik belum terhubung.
- [x] UI menunjukkan status menyimpan, berhasil, atau gagal; status berhasil hanya ditampilkan setelah server mengonfirmasi. Gangguan koneksi menampilkan pesan jelas, timestamp digunakan untuk perubahan, dan perubahan pengguna lain tidak ditimpa diam-diam. Sediakan tombol simpan manual bila autosave dipakai.
- [x] Backend memvalidasi data dan memakai prepared statements/parameter binding SQL. Kredensial, token rahasia, serta akses database tidak diekspos ke frontend.
- [x] Terdapat autentikasi aman sebelum aplikasi dipakai untuk data usaha nyata. Password disimpan/diperiksa secara aman dan sesi terlindungi. Setiap endpoint yang membaca atau mengubah data privat memeriksa autentikasi di server. Akses dibatasi untuk pengguna berwenang; URL sulit ditebak tidak dianggap sebagai keamanan.

## 7. CSV dan cadangan data
- [x] Pengguna dapat mengekspor data sebagai CSV yang dapat dibuka di Excel, mengimpor CSV, memvalidasi file dan format, melihat pratinjau sebelum menyimpan, mendeteksi baris duplikat, serta mengonfirmasi pilihan menimpa atau menambah.
- [x] Impor file baru tidak menghapus data yang sudah ada. Tersedia unduhan cadangan yang memuat barang, riwayat harga, dan aktivitas serta pemulihan dengan konfirmasi yang jelas; pemulihan menggabungkan log aktivitas yang belum ada tanpa menghapus catatan lama.

## 8. Statistik dan aktivitas
- [x] Statistik menampilkan total jenis barang, total supplier, total jumlah stok, total estimasi nilai persediaan, jumlah barang dengan harga berubah, barang paling mahal, barang paling murah berdasarkan satuan yang sebanding, serta aktivitas perubahan terbaru.
- [x] Seluruh angka berasal dari database dan diperbarui setelah data berubah.

## 9. Struktur sumber dan dokumentasi operasional
- [x] Proyek memisahkan struktur frontend, backend, dan database secara jelas; meliputi HTML, CSS, JavaScript vanilla, Cloudflare Worker API, migration SQL D1, konfigurasi Cloudflare, package manifest, README, dan gitignore. Nama file, endpoint API, skema database, dan konfigurasi konsisten.
- [x] README memberi panduan pemula bertahap dengan perintah terminal yang dapat dijalankan dan folder tempat menjalankannya: membuat folder/proyek dan file, menjalankan lokal, membuat akun Cloudflare, membuat D1, menjalankan migrasi/tabel, menghubungkan D1 ke backend, mengatur Cloudflare, pengujian lokal, deployment Cloudflare gratis, memperoleh URL, menghubungkan repository GitHub bila tersedia, memperbarui kode, menguji persistensi cloud, mengunduh cadangan, dan memulihkan data.
- [x] README menjelaskan bahwa deployment kode dan penyimpanan data adalah dua proses berbeda; pengguna tidak perlu mengubah kode untuk memperbarui harga harian. Placeholder penting tidak digunakan bila nilainya dapat dihasilkan; nilai ID database yang hanya tersedia sesudah membuat akun dijelaskan sebagai langkah konfigurasi.

## 10. Verifikasi dan pelaporan yang jujur
- [ ] Sebelum menyatakan pekerjaan selesai, periksa tambah/edit/hapus; pencarian nama/supplier; kalkulasi total dan nilai persediaan; perbandingan dengan satuan sesuai; impor/ekspor CSV; penyimpanan ke D1; akses data dari dua perangkat; validasi dan keamanan API; tampilan desktop/mobile; penanganan jaringan putus; serta deployment dan migrasi database jika akses akun tersedia.
  > Smoke test lokal mengonfirmasi login/CSRF, CRUD, kalkulasi, pencarian/filter, perbandingan satuan, konflik versi, validasi, impor/ekspor, backup/restore, statistik, dan histori. Pengujian lintas perangkat, browser desktop/mobile, gangguan jaringan, serta deployment remote masih terbuka.
- [x] Jangan menyatakan fitur, tes, sinkronisasi perangkat, deployment, atau penyimpanan cloud berhasil jika belum benar-benar dijalankan dan dikonfirmasi.
