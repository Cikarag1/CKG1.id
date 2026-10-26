# Rencana — Supplier Price Manager

**Status:** disetujui pengguna pada 27 Oktober 2026 setelah pengguna meminta pembuatan kode dan berkas.

## Arsitektur dan keputusan implementasi

Aplikasi memakai satu Cloudflare Worker untuk API dan distribusi berkas statis melalui Workers Static Assets. Frontend hanya HTML5, CSS3, dan JavaScript vanilla tanpa framework. API memakai Cloudflare Workers dan binding D1 bernama `DB`; migrasi SQL berada di `migrations/`. `wrangler.jsonc` menjadi sumber konfigurasi; aset di `public/`, dan rute `/api/*` lebih dahulu diproses Worker. `wrangler dev` menggunakan database D1 lokal secara default. Database remote hanya disentuh secara sengaja lewat perintah migrasi/deploy setelah pemilik proyek mengatur akun Cloudflare dan ID database. Konfigurasi awal proyek Manus saat ini menonaktifkan server/database Manus, port preview 3000, dan auto-publish mati; saya mempertahankan ini karena brief secara eksplisit menetapkan Cloudflare, bukan database Manus.

Data pokok memakai ID unik, kode barang, nama, supplier, kategori, harga satuan dalam rupiah bulat, kuantitas pembelian berskala sampai tiga angka desimal, satuan pembelian, stok berskala tiga desimal, satuan stok, catatan, dan timestamp ISO. Harga, jumlah pembelian, dan stok tetap terpisah. Bilangan rupiah dan kuantitas disimpan/dihitung dengan skala integer agar perkalian desimal tidak bergantung pada floating point. Total pembelian dihitung dari harga × jumlah pembelian. Nilai persediaan memakai harga × stok setelah konversi massa (kg/gram), volume (liter/ml), atau hitungan (pcs/unit) yang eksplisit; satuan kemasan yang lain harus sama, dan satuan yang tidak sebanding ditolak, bukan menghasilkan estimasi salah. Kombinasi kode barang + supplier mencegah rekaman supplier yang sama terduplikasi, sedangkan barang bernama sama dari supplier lain tetap dapat disimpan.

Autentikasi satu akun operator ditentukan saat deployment melalui variabel username dan secret hash PBKDF2. Script lokal menghasilkan salt/hash; hash hanya berada di secret Worker, bukan frontend. D1 menyimpan hash token sesi acak, sesi berumur terbatas, serta log aktivitas. Semua API bisnis dan backup mewajibkan sesi server-side; endpoint memvalidasi input, membatasi payload, menggunakan prepared statements, memeriksa Origin, menghindari CORS terbuka, dan menerapkan jeda login setelah kegagalan berulang. Cookie di host HTTPS memakai HttpOnly, Secure, SameSite=None agar dapat dipakai pada preview HTTPS tersemat; mode localhost HTTP diatur eksplisit lewat variabel lingkungan terpisah, bukan ditebak dari URL internal.

API yang direncanakan: `GET /api/auth/session`, `POST /api/auth/login`, `POST /api/auth/logout`; `GET /api/items` (search/filter/server pagination/sort), `GET /api/items/:id`, `POST /api/items`, `PUT /api/items/:id`, `DELETE /api/items/:id`; `GET /api/stats`, `GET /api/filters`, `GET /api/compare`, `GET /api/history`; `POST /api/import/preview`, `POST /api/import` dengan mode tambah atau perbarui yang harus dipilih/dikonfirmasi; `GET /api/export.csv`, `GET /api/backup.json`, dan `POST /api/backup/restore`. Mutasi edit mengirim versi `updated_at` yang diharapkan; versi berbeda menghasilkan HTTP 409 agar perubahan pengguna lain tidak tertimpa. Perbandingan hanya memasangkan nama barang dan unit pembelian yang sama persis; aplikasi tidak mengasumsikan konversi antarunit. Perubahan harga/supplier/unit dicatat tanpa menghapus riwayat. Restore cadangan terpisah dari import CSV, menampilkan konfirmasi eksplisit dan tidak dilakukan diam-diam.

Antarmuka berupa dashboard operasional berbahasa Indonesia: navigasi ringkas, pencarian di header, statistik dari API, tabel berpaginasi, filter supplier/kategori/rentang harga, pengurutan, form tambah/edit, detail, dialog hapus, toast dan status penyimpanan, perbandingan supplier, histori, impor CSV dengan pratinjau/deteksi duplikat/pilihan tambah atau perbarui, ekspor CSV serta unduh/pulihkan backup JSON. Tanpa server/D1 yang tersedia, UI menampilkan status backend tidak tersambung; tidak ada login tiruan, data utama localStorage, atau klaim bahwa perubahan telah tersimpan sebelum API mengonfirmasi.

## Desain

Gaya yang dipertimbangkan (probabilitas ekor untuk eksplorasi alternatif): **industrial Swiss ledger** (0,06), **soft neumorphism** (0,03), **terminal retro-futurist** (0,02). Pilihan: **industrial Swiss ledger**, karena paling jelas untuk pemantauan harga dan operasi harian.

- **Gerakan desain:** Swiss International Typographic Style yang diterapkan pada alat pencatatan rantai pasok kontemporer; rapi dan informatif tanpa nuansa template admin generik.
- **Prinsip utama:** angka mudah dipindai; hierarki visual membedakan kondisi operasional; setiap perubahan status terlihat; kepadatan tabel tetap nyaman pada layar kecil.
- **Filosofi warna:** dasar putih tulang dan abu kebiruan menjaga keterbacaan; tinta navy memberi kesan tepercaya; hijau teal menjadi aksen khas untuk penyimpanan dan harga kompetitif; jingga hanya menandai peringatan.
- **Tata letak:** sidebar dan area kerja lebar yang mendahulukan pencarian serta tabel, statistik horizontal, lalu panel detail kontekstual; di ponsel sidebar menjadi drawer dan tabel mempertahankan kolom penting dalam wadah yang dapat digulir horizontal.
- **Elemen khas:** strip harga terendah berwarna teal pada tabel perbandingan; penanda riwayat seperti ledger di sisi baris; chip status sinkronisasi dengan titik dan label teks.
- **Filosofi interaksi:** simpan hanya lewat aksi yang jelas, form edit tidak menutup sebelum server merespons, konflik memberi pesan yang tidak menimpa perubahan lain secara diam-diam, penghapusan selalu memerlukan konfirmasi, dan empty/error state memberi langkah pemulihan.
- **Animasi:** transisi 140–180 ms untuk drawer, dialog, toast, dan perubahan status; tanpa animasi berulang atau gerakan dekoratif; hormati `prefers-reduced-motion`.
- **Tipografi:** Inter untuk antarmuka dan angka dengan tabular numerals; font sistem fallback. Judul tegas dan singkat, label berukuran konsisten, harga memakai angka rata agar mudah dibandingkan.
- **Esensi merek:** buku kerja harga bahan baku yang membantu operator membandingkan pemasok dan mencatat pembelian tanpa spreadsheet yang rapuh; teliti, tenang, tanggap.
- **Suara merek:** praktis, ringkas, menjelaskan dampak; contoh: “Harga tersimpan di basis data.” dan “Versi data berubah di perangkat lain. Muat ulang sebelum menyimpan.”
- **Wordmark/logo:** tanda indeks berbingkai dengan garis-garis ledger dan aksen teal, diikuti nama aplikasi; dibuat sebagai SVG kecil tanpa aset dekoratif eksternal.
- **Warna merek khas:** teal gelap `#147D73` sebagai penanda harga/aksi penting, dipasangkan navy `#14213D` dan latar `#F4F6F8`.

## Struktur proyek

```text
supplier-price-manager/
├── public/
│   ├── index.html              # shell aplikasi dan dialog akses
│   ├── style.css               # sistem visual responsif
│   ├── app.js                  # UI, form, tabel, filter, CSV dan backup
│   ├── units.js                # konversi satuan stok bersama UI dan Worker
│   ├── logo.svg                # monogram aplikasi
│   └── manus-routes.json       # deklarasi rute halaman preview
├── src/
│   ├── index.js                # router Worker, autentikasi, API, aset
│   ├── auth.js                 # login, hashing, sesi, cookie
│   ├── items.js                # CRUD, pencarian, statistik, perbandingan
│   ├── transfers.js            # CSV dan backup JSON
│   └── validation.js           # normalisasi dan validasi input
├── migrations/
│   └── 0001_initial_schema.sql # tabel, constraint, indeks dan migrasi awal
├── scripts/
│   └── make-password-hash.mjs  # membuat hash secret secara lokal
├── wrangler.jsonc              # binding D1 dan Workers Static Assets
├── package.json                # skrip dev/deploy dan pin Wrangler
├── package-lock.json           # versi dependency yang terkunci
├── app.config.ts               # logo proyek WebDev
├── .dev.vars.example           # nama variabel lokal, tanpa kredensial nyata
├── .gitignore
├── plan.md
├── TODO.md                     # dibuat setelah rencana disetujui
└── README.md                   # setup lokal, Cloudflare, D1, GitHub, backup
```

## Batas pelaksanaan

Saya dapat membuat serta memeriksa kode, migrasi, dan panduan dalam proyek ini. Workspace yang disiapkan saat ini menggunakan remote Git internal Manus, bukan repository GitHub pilihan pengguna; saya belum melihat koneksi akun/repository GitHub yang dipilih. Cloudflare juga belum ditautkan di workspace. Karena itu, deployment Workers/D1 ke akun nyata, pengujian lintas dua perangkat di database produksi, serta pembuatan/push ke repository GitHub milik pengguna baru dapat dinyatakan selesai setelah koneksi dan kredensial pemiliknya tersedia. README akan memberi langkah yang dapat dijalankan untuk kedua integrasi tersebut; tidak ada kredensial yang ditanam di source code.

## Status pelaksanaan

Frontend, Worker API, migrasi D1, autentikasi, impor/ekspor, README, dan konfigurasi Wrangler telah dibuat. `npm run check`, migrasi D1 lokal, `wrangler deploy --dry-run`, health route, dan smoke test lokal telah dijalankan. Deployment Cloudflare remote, akun/ID D1 produksi, pengujian dua perangkat ke database cloud, dan repository GitHub pribadi pengguna belum dihubungkan atau diverifikasi; langkahnya dijelaskan di README.
