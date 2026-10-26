# Supplier Price Manager

Aplikasi pencatatan dan perbandingan harga bahan baku supplier. Frontend memakai HTML/CSS/JavaScript vanilla; Cloudflare Worker menyajikan halaman sekaligus API; Cloudflare D1 menyimpan data barang, sesi, aktivitas, dan riwayat harga. Tidak ada framework frontend dan tidak ada data bisnis yang disimpan di `localStorage`.

## Arsitektur berkas

`public/` berisi antarmuka dan satu halaman (`index.html`), gaya responsif (`style.css`), interaksi (`app.js`), helper satuan bersama (`units.js`), logo, dan manifest Preview. Helper mengonversi satuan antara UI dan Worker agar nilai persediaan konsisten. `src/` berisi API Worker, autentikasi, validasi, CRUD/pencarian/statistik/perbandingan, serta transfer CSV/backup. `migrations/0001_initial_schema.sql` membuat tabel dan indeks D1. `wrangler.jsonc` menghubungkan API dan aset `public/` pada satu Worker. API `/api/*` dijalankan terlebih dahulu oleh Worker; berkas lain dilayani sebagai aset statis.

## Kebutuhan

Pasang Node.js 22 atau versi LTS yang didukung Wrangler, dan npm. Perintah di bawah dijalankan dari folder utama proyek, yaitu folder yang berisi `package.json` dan `wrangler.jsonc`. Wrangler 4.153.0 sudah dicantumkan sebagai dependency terkunci. Tidak diperlukan build frontend terpisah.

## Jalankan secara lokal

Jika Anda menerima arsip `supplier-price-manager.zip`, buat folder dan ekstrak seluruh file proyek ke dalamnya. Dari terminal macOS/Linux, contoh jika arsip ada di `~/Downloads`:

```sh
mkdir -p supplier-price-manager
unzip ~/Downloads/supplier-price-manager.zip -d supplier-price-manager
cd supplier-price-manager
```

Di Windows, ekstrak ZIP melalui File Explorer lalu buka PowerShell pada folder yang berisi `package.json`. Jika memakai hasil clone repository, buka terminal langsung di folder hasil clone. Pastikan folder kerja berisi `package.json` dan `wrangler.jsonc`, lalu jalankan:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run password:hash
```

Script meminta kata sandi dua kali tanpa menampilkan ketikan. Gunakan kata sandi kuat sekurangnya 16 karakter. Hash memakai PBKDF2-HMAC-SHA-256 100.000 iterasi dan salt acak; parameter tersebut dipilih secara konservatif karena laporan komunitas Cloudflare tanggal 6 Oktober 2026 menyebut production Workers Free menolak iterasi di atas 100.000, sedangkan dokumentasi Web Crypto hanya mencantumkan algoritme tanpa menyatakan batas iterasi. Laporan itu bukan konfirmasi resmi, jadi verifikasi login di deployment Anda sebelum memakai data usaha nyata. Workers Free juga mempunyai batas CPU per request 10 ms; ukur fungsi autentikasi pada Worker sebenarnya. Salin baris `ADMIN_PASSWORD_HASH=...` yang dicetak ke `.dev.vars` dan jangan membagikan/commit file tersebut. Di `.dev.vars`, pastikan `ADMIN_USERNAME=admin`, `COOKIE_SECURE=false`, serta `ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000` untuk akses lokal HTTP. Untuk password operator, Anda dapat mengganti nama pengguna, tetapi variabel yang dipakai harus cocok dengan `ADMIN_USERNAME` saat deployment.

Siapkan database lokal dan jalankan Worker:

```sh
npm run db:migrate:local
npm run dev
```

Buka `http://localhost:3000`. Data dalam mode lokal berada pada penyimpanan D1 lokal Wrangler dan **bukan** database cloud. Jangan memasang `remote: true` pada binding untuk pengembangan harian: perubahan pada remote dapat langsung memengaruhi data cloud. Untuk berhenti, tekan `Ctrl+C` pada terminal server.

Nilai persediaan memakai harga per satuan pembelian dan stok tersedia. Aplikasi mengonversi satuan massa **kg ↔ gram**, volume **liter ↔ ml**, serta hitungan **pcs ↔ unit**. Nama kemasan lain seperti **dus**, **karton**, atau **sak** harus sama persis antara kedua kolom. Jika dua satuan tidak setara dan tidak ada konversi yang valid, preview menampilkan pesan dan Worker menolak penyimpanan; aplikasi tidak menebak nilai.

Pemeriksaan sintaks dasar:

```sh
npm run check
```

## Buat akun Cloudflare dan D1

1. Buat akun Cloudflare di [cloudflare.com](https://dash.cloudflare.com/sign-up) dan verifikasi alamat surel bila diminta. Akun diperlukan karena database dan URL deployment berada di akun pemilik; repositori ini tidak berisi kredensial Cloudflare.
2. Dari terminal folder proyek, autentikasi Wrangler:

   ```sh
   npx wrangler login
   ```

   Selesaikan otorisasi Cloudflare di browser yang dibuka.
3. Buat database D1:

   ```sh
   npm run db:create
   ```

   Jika Wrangler menawarkan untuk menambahkan binding ke `wrangler.jsonc`, pilih **Yes**. Wrangler akan menuliskan `database_id` milik akun Anda. Jika tidak, salin ID UUID yang ditampilkan Cloudflare ke field `database_id` pada binding `DB` di `wrangler.jsonc`. Nilai UUID nol pada file yang dibagikan hanya untuk menjalankan simulasi lokal; jangan deploy dengan nilai itu.
4. Tinjau binding `DB`, nama database `supplier-price-manager`, dan direktori migration `migrations`. Nama binding harus tetap `DB`, karena backend mengakses `env.DB`.
5. Terapkan skema ke database cloud satu kali:

   ```sh
   npm run db:migrate:remote
   ```

   Wrangler meminta konfirmasi sebelum perubahan remote. Tinjau nama basis data yang tampil dan pastikan itu database proyek yang benar sebelum menyetujui.

Perintah `wrangler d1 create` menghasilkan UUID database yang tidak dapat diketahui sebelum akun pengguna membuat resource tersebut. Itulah satu-satunya nilai per akun yang harus masuk ke konfigurasi. Wrangler dapat menambahkannya otomatis; jangan menebak atau menyalin ID dari akun lain.

## Atur login produksi dan deploy

1. Buat hash password administrator dari folder proyek:

   ```sh
   npm run password:hash
   ```

   Simpan baris yang dihasilkan sementara di tempat aman. Di terminal yang sama, masukkan secret ke Cloudflare:

   ```sh
   npx wrangler secret put ADMIN_PASSWORD_HASH
   ```

   Tempel **nilai hash saja** setelah prompt Wrangler. Jangan menempel password biasa, jangan memasukkan secret ke `public/`, dan jangan menaruh hash produksi di Git.
2. `ADMIN_USERNAME` dapat diganti pada `vars.ADMIN_USERNAME` di `wrangler.jsonc`. `COOKIE_SECURE` harus `true` untuk situs HTTPS seperti `workers.dev`. Mode lokal HTTP saja memakai `COOKIE_SECURE=false` dalam `.dev.vars`. Jangan menyalin `.dev.vars` ke repository.
3. Deploy kode dan aset:

   ```sh
   npm run deploy
   ```

   Wrangler menampilkan URL seperti `https://supplier-price-manager.<subdomain-akun>.workers.dev`. Ini adalah URL aplikasi Anda. Jalankan `/api/health` pada domain tersebut; hasil `{"ok":true,"database":"terhubung"}` menunjukkan Worker dapat mengakses D1. Jika belum, pastikan migration remote telah diterapkan dan `database_id` pada binding cocok.
4. Buka URL aplikasi dari perangkat kedua, lalu masuk memakai akun operator yang sama. Setelah menambah satu barang, muat ulang atau masuk dari perangkat kedua dan periksa apakah barang muncul. Jangan menganggap deployment lokal sebagai bukti penyimpanan cloud.

Worker memeriksa autentikasi pada server untuk semua endpoint privat. Cookie sesi HTTPS memakai `HttpOnly`, `Secure`, dan `SameSite=None` untuk mendukung preview HTTPS tersemat. Untuk mode HTTP lokal cookie Secure dinonaktifkan secara eksplisit lewat `.dev.vars`; aplikasi tidak menebak keamanan cookie dari alamat internal server. API juga memakai token CSRF per sesi dan tidak mengaktifkan CORS terbuka.

## Hubungkan ke repository GitHub

Repository workspace awal dikelola Manus; akun/repository GitHub pemilik belum terhubung otomatis. Buat repository **private** di GitHub, lalu dari checkout lokal proyek tambahkan GitHub sebagai remote terpisah agar remote yang sudah ada tidak tertimpa:

```sh
git remote add github https://github.com/USERNAME/supplier-price-manager.git
git push -u github main
```

Ganti `USERNAME` dengan nama akun GitHub Anda dan pastikan repository private bila berisi konfigurasi operasional. Autentikasi GitHub melalui Git Credential Manager atau GitHub CLI sesuai cara kerja komputer Anda; jangan memasukkan token ke URL remote. Setelah itu, `git push github main` memperbarui **kode** di GitHub. Menambahkan GitHub sebagai remote tidak memindahkan, menghapus, atau menyinkronkan database D1.

## Ubah kode dan ubah data adalah dua hal berbeda

Perubahan kode dilakukan dengan mengedit/commit file lalu deploy; perubahan kode tidak mengubah record barang D1. Harga satuan, pembelian, stok, dan supplier sehari-hari diubah dari dashboard setelah login; API menyimpan perubahan ke D1. Jangan mengedit file JavaScript untuk memperbarui harga.

Untuk mengambil pembaruan kode dari remote `github` yang sudah Anda tambahkan:

```sh
git pull github main
npm ci
# Hanya bila update menambahkan migration baru:
npm run db:migrate:remote
npm run deploy
```

Sebelum berbagi perubahan kode dengan tim, lakukan commit lalu `git push github main`. Jangan memasukkan `.dev.vars`, dump database, atau cadangan data ke Git.

Saat migration baru ditambahkan, tinjau SQL dan backup lebih dahulu, lalu jalankan `npm run db:migrate:remote` sebelum deploy kode yang membutuhkan skema tersebut. Migration yang sudah diterapkan tidak seharusnya diedit; tambahkan migration bernomor baru untuk perubahan berikutnya. Data development lokal tidak sama dengan D1 cloud.

## CSV dan cadangan

Pada menu **Impor & cadangan**, tombol **Ekspor CSV** mengunduh semua barang yang tercatat. Kolom CSV berbahasa Indonesia tercantum pada halaman tersebut. Impor menerima maksimum 500 baris per pratinjau; file diperiksa sebelum penyimpanan, pasangan kode barang + supplier dibandingkan untuk deteksi duplikat, lalu operator memilih **Tambah saja** atau mengonfirmasi **Perbarui yang cocok**. Import tidak menghapus barang yang tidak ada di file. Kuantitas dapat memakai titik atau koma sebagai pemisah desimal, hingga tiga angka desimal; harga diisi sebagai rupiah bulat.

**Unduh cadangan** dari aplikasi membuat JSON berisi barang, riwayat harga, dan aktivitas. Pilih file JSON di menu yang sama, kemudian ketik `PULIHKAN`. Pemulihan menggabungkan barang dengan ID yang sama, menambahkan barang baru dan mempertahankan data yang tidak ada di file. Jika operasi besar terputus, unduh data lagi dan ulangi; perubahan yang sudah diterapkan tidak membuang record yang tidak masuk backup.

Cadangan SQL manual Cloudflare dibuat dari komputer yang telah login Wrangler. Jalankan dari folder proyek:

```sh
mkdir -p backups
npx wrangler d1 export supplier-price-manager --remote --output="./backups/supplier-price-manager-$(date +%Y%m%d-%H%M%S).sql"
```

Untuk pemulihan SQL yang aman, buat D1 baru (misalnya `supplier-price-manager-restore`), lalu muat SQL ke database **baru** setelah memeriksa berkas:

```sh
npx wrangler d1 create supplier-price-manager-restore
npx wrangler d1 execute supplier-price-manager-restore --remote --file="./backups/NAMA-BERKAS.sql"
```

Setelah memastikan data pada database baru benar, ubah binding `database_name` dan `database_id` pada `wrangler.jsonc` ke database pemulihan, lalu deploy ulang. Jangan impor dump langsung ke database aktif tanpa memahami dampaknya; data unik dapat bertabrakan. Simpan arsip backup dengan aman dan di luar Git; folder `backups/` diabaikan oleh `.gitignore`.

Cloudflare D1 menyediakan Time Travel otomatis. Pada Workers Free, pemulihan point-in-time resmi mencakup hingga 7 hari; restore langsung bersifat destruktif dan menimpa keadaan database. Gunakan hanya setelah memastikan database dan waktunya benar, dan bila mungkin uji restore pada database baru terlebih dahulu. Time Travel bukan pengganti unduhan backup yang disimpan terpisah.

## Pemeriksaan sebelum dipakai untuk operasi nyata

- Jalankan `npm run check` dan `npm run db:migrate:local`.
- Di lokal, buat operator, masuk, tambah barang, edit harga, muat ulang, cek total/nilai stok, pencarian dan filter, bandingkan barang dengan supplier serta satuan sama, lalu hapus barang setelah konfirmasi.
- Coba CSV yang valid, CSV dengan header hilang, duplikat kode/supplier, dan file JSON backup. Pastikan restore menggabungkan data tanpa menghapus record lain.
- Di environment cloud, uji `GET /api/health`, login, operasi barang, dan pemeriksaan jumlah data D1 melalui `npx wrangler d1 execute supplier-price-manager --remote --command "SELECT COUNT(*) AS total FROM items;"`.
- Login dari perangkat kedua dengan URL aplikasi yang sama untuk memeriksa data cloud bersama. Periksa konflik dengan membuka barang yang sama pada dua sesi, menyimpan dari sesi pertama, lalu memastikan sesi kedua diberi pesan konflik.
- Pastikan deployment memakai ID D1 remote yang benar, secret hash disimpan sebagai Wrangler Secret, HTTPS aktif, dan `.dev.vars` tidak ikut commit.

Hanya tes yang benar-benar dijalankan di environment terkait yang boleh ditandai berhasil. Proyek yang baru di-clone tanpa akun Cloudflare belum membuktikan deployment, penyimpanan remote, atau sinkronisasi antarperangkat.

## Referensi Cloudflare

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) — konfigurasi aset statis dan pemrosesan jalur API oleh Worker.
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) — `wrangler.jsonc`, binding D1, aset, dan migration directory.
- [D1 getting started](https://developers.cloudflare.com/d1/get-started/) — membuat database dan menautkannya ke Worker.
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) — membuat dan menerapkan file migration lokal maupun remote.
- [Local D1 development](https://developers.cloudflare.com/d1/best-practices/local-development/) — D1 lokal terpisah dari data produksi.
- [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/) — ekspor SQL dan impor ke D1.
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) — retensi pemulihan dan konsekuensi restore.
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) — kriptografi yang tersedia di Worker.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — termasuk CPU limit per request pada Workers Free.
- [PBKDF2 iteration limit report](https://community.cloudflare.com/t/pbkdf2-iteration-limit-on-workers-free/965725) — laporan komunitas, bukan konfirmasi batas resmi.
