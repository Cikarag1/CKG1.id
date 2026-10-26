# Catatan riset Cloudflare untuk Supplier Price Manager

Diperiksa 26 Oktober 2026, sumber resmi Cloudflare:

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/ — satu deployment dapat menyajikan Worker dan aset statis bersama; `assets.directory`, `assets.binding`, `run_worker_first` dapat memprioritaskan Worker pada `/api/*`.
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/ — Cloudflare merekomendasikan `wrangler.jsonc`; binding D1 menggunakan `binding`, `database_name`, `database_id`, opsional `migrations_dir`; local mode memakai simulasi lokal.
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/ — migration disimpan sebagai SQL bernomor pada `migrations/`; `wrangler d1 migrations apply` mendukung `--local` dan `--remote`.
- D1 getting started: https://developers.cloudflare.com/d1/get-started/ — `npx wrangler d1 create <nama>` membuat database serta memberikan binding dan UUID; query Worker harus memakai prepared statement `.prepare(...).bind(...)`.
- Wrangler D1 commands: https://developers.cloudflare.com/d1/wrangler-commands/ — export SQL memakai `wrangler d1 export <database> --remote --output=...`; eksekusi/restore SQL memakai `wrangler d1 execute <database> --remote --file=...`.
- D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/ — ekspor basis data penuh atau tabel sebagai SQL, impor dengan `d1 execute --file`; ekspor mengonversi nilai integer besar melalui batas presisi 52-bit JavaScript.
- D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/ — pemulihan point-in-time otomatis; pada Free, jangkauan pemulihan 7 hari; restore menimpa database sehingga destruktif.
- Worker local development: https://developers.cloudflare.com/workers/local-development/ — `wrangler dev` menjalankan Worker lokal dan menghubungkan binding ke simulasi lokal secara default.
- D1 local development: https://developers.cloudflare.com/d1/best-practices/local-development/ — database lokal terpisah dari remote; mengakses data produksi membutuhkan konfigurasi remote eksplisit dan perubahan tidak dapat dibatalkan.
- Workers Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ — Worker mendukung Web Crypto API termasuk PBKDF2, digest SHA-256, random crypto dan timingSafeEqual.

Rancangan aman: jalankan migrasi lokal terlebih dahulu; ganti ID database dari output Wrangler untuk binding deployment; jangan mengaktifkan remote binding saat dev biasa. Gunakan HTTPS-only cookie di deployment dan sediakan export SQL selain fitur backup aplikasi.


## Update autentikasi Workers Free (2026-10-27)
- Dokumentasi resmi Limits yang diperiksa pada 2026-10-27 mencantumkan Free CPU 10 ms per HTTP request dan Paid dapat dinaikkan sampai 5 menit; CPU waktu jaringan tidak dihitung. Sumber: https://developers.cloudflare.com/workers/platform/limits/
- Diskusi komunitas tanggal 2026-10-06 menyebut produksi Free menolak PBKDF2 WebCrypto di atas 100.000 iterasi (NotSupportedError); bukan konfirmasi resmi. Sumber: https://community.cloudflare.com/t/pbkdf2-iteration-limit-on-workers-free/965725
- WebCrypto docs mencantumkan PBKDF2 sebagai didukung namun tak menetapkan iteration cap: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- Sumber ini mendukung kompromi kompatibilitas 100.000 iterasi dengan password minimum 16 karakter dan throttling 5 percobaan/15 menit; login remote tetap harus diverifikasi oleh pemilik sebelum data riil.
