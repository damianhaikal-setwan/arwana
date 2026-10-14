# ARWANA — Deployment dan AI Assistant

Dokumen ini menjelaskan source yang berada di repository ini: `index.html`, Supabase Edge Function `supabase/functions/arwana-ai/index.ts`, dan konfigurasi `supabase/config.toml`. Jangan masukkan data operasional, file `.env`, access token, API key provider, atau `service_role` key ke repository.

## Integrasi yang tersedia

- Frontend berupa HTML statis. `index.html` memakai Supabase URL dan anon/publishable key untuk koneksi browser. Anon key memang dapat dilihat di browser; pembatasan data harus ditegakkan melalui autentikasi, grant, dan RLS.
- Login dan logout menggunakan Supabase Auth. Jangan memakai `service_role` key di HTML.
- AI dipanggil melalui fungsi `arwana-ai`, yang memvalidasi JWT, memeriksa `profiles.role`, memeriksa origin yang diizinkan, membatasi ukuran input, dan meminta jawaban dari endpoint OpenAI-compatible Chat Completions.
- Enam agent umum tersedia: `design`, `regulation`, `implementor`, `sql`, `evolution`, dan `output`. Agent khusus ketujuh adalah `akip_evidence`.
- AI menghasilkan draf/rekomendasi. Ia tidak boleh dianggap sebagai verifikasi bukti, keputusan resmi, atau pengesahan AKIP.
- `supabase/config.toml` mempertahankan `verify_jwt = true`.

## PWA

Repository menyertakan `manifest.webmanifest`, `service-worker.js`, ikon, meta Apple/iOS, dan dukungan pemasangan. Cloudflare Pages harus disajikan melalui HTTPS agar service worker dan instalasi bekerja. Cache service worker hanya untuk app shell/aset lokal; request Supabase Auth, Edge Functions, dan API tidak boleh disimpan sebagai cache. Mode offline tidak menyinkronkan data dan tidak menyediakan AI offline. Di iPhone, buka melalui Safari → Bagikan → Tambahkan ke Layar Utama.

## Deploy frontend

Repository ini dapat dihubungkan ke Cloudflare Pages melalui Git:

1. Pilih framework preset **None**.
2. Biarkan build command kosong.
3. Gunakan `/` sebagai build output directory (root repository).
4. Pastikan situs memakai HTTPS.
5. Catat origin situs yang benar-benar terdeploy, misalnya `https://nama-proyek.pages.dev` atau domain kustom. Jangan menebak origin dari URL repository GitHub.

`index.html` sudah memiliki konfigurasi browser Supabase. Hanya URL proyek dan anon/publishable key yang boleh berada di frontend; jangan menambahkan API key provider atau service-role key.

## Deploy dan konfigurasi Supabase Edge Function

Dari root proyek Supabase yang benar:

```bash
supabase link --project-ref PROJECT_REF
supabase functions deploy arwana-ai
```

Set secret provider dan origin server-side. Ganti nilai contoh dengan nilai proyek Anda; jangan commit nilainya:

```bash
supabase secrets set \
  ARWANA_LLM_API_KEY='ISI_SECRET_PROVIDER' \
  ARWANA_LLM_CHAT_URL='https://api.openai.com/v1/chat/completions' \
  ARWANA_LLM_MODEL='gpt-4o-mini' \
  ARWANA_ALLOWED_ORIGINS='https://HOST-ARWANA-ANDA'
```

`ARWANA_ALLOWED_ORIGINS` harus sama persis dengan origin hosting (scheme dan host, tanpa path). Untuk beberapa origin, pisahkan dengan koma. Fungsi juga memerlukan `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` pada environment server Supabase. Pastikan `service_role` hanya tersedia di server, tidak di `index.html`.

Jangan menggunakan `OPENAI_API_KEY`, `OPENAI_MODEL`, atau `ARWANA_ALLOWED_USERS` untuk fungsi yang ada saat ini; variabel tersebut tidak dibaca oleh `supabase/functions/arwana-ai/index.ts`. Akses fungsi didasarkan pada JWT Supabase dan role pada `profiles`, bukan email allowlist tersebut.

## Prasyarat rate limit

Fungsi memanggil RPC `arwana_ai_consume_rate` untuk membatasi penggunaan hingga 25 permintaan per pengguna per menit. Repository saat ini **belum menyertakan file migration** yang membuat RPC/tabel rate-limit tersebut. Pastikan migration yang sesuai sudah diterapkan di proyek Supabase sebelum menguji chat. Jika RPC tidak tersedia, fungsi mengembalikan 503. Perubahan dokumentasi ini tidak membuat atau mengubah migration.

## Uji setelah deploy

1. Jalankan skrip read-only [`diagnostics/ARWANA-Check-DB-Profiles-RLS.sql`](diagnostics/ARWANA-Check-DB-Profiles-RLS.sql) di Supabase SQL Editor. Skrip menampilkan status tabel `profiles`, RLS, rincian policy, dan grant. Skrip tidak mengubah database.
2. Login ke situs ARWANA menggunakan akun yang memiliki baris profil dan role yang diizinkan.
3. Buka **ARWANA AI Assistant**, berikan consent cloud, lalu tekan **Uji Koneksi**.
4. Health check memeriksa JWT, profil/role, konfigurasi fungsi, dan keberadaan secret LLM. Health check **tidak** mengirim prompt ke model. Kirim prompt pendek untuk menguji provider sebenarnya.
5. Ikuti [Panduan Uji Edge Function ARWANA](docs/ARWANA-Edge-Function-Pengujian.md) untuk prompt setiap agent dan diagnosis kode respons.
6. Tinjau log di **Supabase Dashboard → Edge Functions → `arwana-ai` → Logs**.

Jalankan pengujian dengan data nonrahasia. Chat yang lolos health check dapat memanggil provider dan menimbulkan biaya sesuai akun provider. Tinjau akses instansi, retensi, RLS/grant, dan ketentuan layanan sebelum penggunaan data riil. SQL Architect hanya menghasilkan draft; jangan menerapkan SQL atau policy tanpa review dan uji staging.
