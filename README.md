# ARWANA AI — Starter Deployment Pack — V7.38

Paket integrasi AI untuk ARWANA Perencanaan Terpadu. Frontend tetap HTML statis; autentikasi dan pemanggilan model AI berjalan melalui Supabase Edge Function. Tidak ada kredensial akun pengguna atau secret yang disertakan.

## PWA (Progressive Web App)

Paket ini sudah menyertakan `manifest.webmanifest`, `service-worker.js`, ikon PNG 192/512 dan SVG, meta Apple/iOS, serta tombol pemasangan. Cloudflare Pages wajib menggunakan HTTPS agar service worker dan instalasi bekerja. Cache hanya menyimpan app shell/aset lokal; permintaan Supabase Auth, Edge Functions, dan API tidak pernah disimpan di cache. Mode offline hanya menyediakan shell aplikasi, bukan sinkronisasi data atau kemampuan AI offline. Pada iPhone, buka melalui Safari → Bagikan → Tambahkan ke Layar Utama.

## Status nyata paket

- HTML ARWANA berbasis V7.36 dipertahankan; menu ARWANA AI ditambahkan dan login Supabase Auth diintegrasikan.
- UI koneksi menggunakan Supabase URL + anon/publishable key.
- Login/logout menggunakan Supabase Auth SDK; access token diambil dari sesi aktif, tidak ditempel manual.
- Edge Function memvalidasi token pengguna dan memanggil OpenAI Responses API dari server.
- Konteks yang dikirim dibatasi pada metadata dokumen perencanaan, data kinerja, target, dan relasi. Tanda tangan, data pegawai, anggota DPRD, dan perjalanan dinas tidak dikirim oleh fungsi pembentuk konteks ini.
- Hasil AI hanya berupa draf/rekomendasi; tidak menulis otomatis ke data bisnis.
- Pemeriksaan statis tersedia di `scripts/check_html.py` dan workflow GitHub Actions.

**Belum dilakukan:** deploy ke akun GitHub/Supabase/Cloudflare milik pengguna, konfigurasi secrets di akun, atau pengujian end-to-end di browser/iPhone. Itu memerlukan akses ke akun dan kredensial milik pengguna. Jangan mengirimkan password atau secret ke percakapan.

## 1. Siapkan GitHub

1. Buat repositori GitHub **Private** bernama `arwana-ai`.
2. Ekstrak ZIP ini, lalu unggah seluruh isi folder (termasuk folder tersembunyi `.github`) ke root repositori.
3. Commit `index.html`, folder `supabase/`, `scripts/`, `.github/`, `_headers`, `.gitignore`, dan `README.md`.
4. Jangan mengunggah JSON data riil, file `.env`, token, `OPENAI_API_KEY`, atau service-role key.
5. GitHub Actions otomatis memeriksa sintaks inline JavaScript pada `index.html` saat push.

## 2. Siapkan Supabase Auth dan Edge Function

Di Supabase Dashboard:

1. Buka **Authentication → Users**, buat pengguna uji secara administratif. Matikan sign-up publik jika tidak dibutuhkan.
2. Ambil Project URL dan anon/publishable key. Keduanya digunakan di browser; **jangan gunakan service-role key**.
3. Pada komputer pengembang, pasang Supabase CLI, login, lalu tautkan direktori ini ke project yang benar:

   ```bash
   supabase login
   supabase link --project-ref PROJECT_REF
   supabase functions deploy arwana-ai
   ```

4. Set secret server-side (jangan menaruh nilai secret dalam Git):

   ```bash
   supabase secrets set OPENAI_API_KEY=ISI_SECRET_OPENAI
   supabase secrets set OPENAI_MODEL=gpt-4.1-mini
   supabase secrets set ARWANA_ALLOWED_USERS=operator@instansi.go.id,sekwan@instansi.go.id
   supabase secrets set ARWANA_ALLOWED_ORIGINS=https://DOMAIN-ARWANA.pages.dev
   ```

   Jika memakai domain kustom, masukkan origin itu juga, dipisahkan koma. Contoh: `https://arwana.pages.dev,https://arwana.example.go.id`. Jangan masukkan path URL.

5. `SUPABASE_URL` dan `SUPABASE_ANON_KEY` biasanya tersedia otomatis untuk Edge Functions. Jika proyek menggunakan nama secret berbeda, sesuaikan dengan environment proyek.
6. Konfigurasi function ada di `supabase/config.toml`, dengan verifikasi JWT aktif. Function memvalidasi pengguna melalui `auth.getUser()` dan memeriksa allowlist `ARWANA_ALLOWED_USERS`. Masukkan hanya email akun yang memang diberi izin; pisahkan beberapa email dengan koma. Tanpa allowlist, function gagal tertutup dan tidak memproses permintaan.
7. Jangan gunakan data pribadi/riil sebelum kebijakan keamanan, izin instansi, retensi, dan ketentuan penggunaan layanan AI ditinjau. Function AI ini tidak memerlukan akses service-role/database; ia hanya memvalidasi sesi dan memproses konteks terbatas yang dikirim frontend.

## 3. Deploy Cloudflare Pages dari GitHub

1. Buka Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pilih repositori `arwana-ai`.
3. Framework preset: **None**.
4. Build command: kosong / none.
5. Build output directory: `/` (root repositori).
6. Deploy. Setelah domain `*.pages.dev` tersedia, set `ARWANA_ALLOWED_ORIGINS` di Supabase dengan origin yang tepat, lalu deploy ulang Edge Function bila diperlukan.
7. Pada halaman ARWANA → menu **ARWANA AI Assistant**, isi:
   - URL proyek Supabase, contoh `https://PROJECT_REF.supabase.co`
   - anon/publishable key
   - URL function, contoh `https://PROJECT_REF.supabase.co/functions/v1/arwana-ai`
8. Simpan, login menggunakan akun Supabase Auth yang dibuat pengelola, lalu tekan **Uji Koneksi AI**.

## 4. Tes end-to-end setelah deployment

- Login benar berhasil; password salah ditolak.
- Tanpa login, panggilan AI harus ditolak dengan 401.
- `Uji Koneksi AI` mengembalikan jawaban singkat.
- Perintah analisis memakai data perencanaan aktif dan tidak mengirim data pegawai, tanda tangan, anggota DPRD, atau perjalanan dinas.
- Origin yang tidak diizinkan ditolak setelah `ARWANA_ALLOWED_ORIGINS` disetel.
- Secret yang tidak ada menghasilkan pesan konfigurasi generik; nilai secret tidak dikirim ke browser.
- Token kedaluwarsa meminta login ulang.
- Hasil AI dapat disalin/diunduh TXT, dan tidak mengubah data master secara otomatis.
- Uji Safari macOS, iPhone, responsif, jaringan gagal, kuota API, dan log function.

## Batasan keamanan yang belum digantikan paket ini

- Data operasional utama pada versi prototipe masih menggunakan `localStorage` browser, bukan database bersama Supabase. Login AI **tidak** otomatis memindahkan data aplikasi atau menjamin RLS pada data lokal.
- Batasi akses repositori, akun Supabase, OpenAI API, dan Cloudflare menurut kebijakan instansi.
- Tambahkan rate limiting/kuota berbasis penyimpanan server-side sebelum penggunaan luas; batas sederhana di memori Edge Function tidak cukup untuk produksi.
- Gunakan RLS dan pengujian role bila nanti data bisnis dimigrasikan ke Supabase.
- AI bukan APIP/evaluator, tidak memberi skor/predikat resmi SAKIP, tidak mengesahkan dokumen, dan tidak boleh mengarang target atau realisasi.
