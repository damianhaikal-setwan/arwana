# ARWANA — AI Assistant dan Deployment

Aplikasi ARWANA adalah frontend HTML statis. Layanan model berjalan di server melalui Supabase Edge Function `arwana-ai`; kunci provider tidak boleh dimasukkan ke browser atau repository.

## Status integrasi AI

- Menu memiliki tujuh agent dan mengirim chat ke `supabase.functions.invoke('arwana-ai')` saat pengguna login ke Supabase dan memberi consent cloud.
- Tanpa login/consent cloud, aplikasi memberi jawaban fallback lokal. Itu bukan respons LLM; UI menandainya sebagai fallback.
- Edge Function memvalidasi JWT, baris `profiles` dan role, origin, consent, ukuran konteks, rate limit, lalu memanggil endpoint OpenAI-compatible Chat Completions.
- `Uji Koneksi AI` hanya memeriksa sesi, profil/role dan keberadaan secret. Tes itu tidak mengirim prompt ke model; kirim prompt singkat nonrahasia untuk menguji provider sebenarnya.
- Kode sumber saja tidak membuktikan bahwa Edge Function, secret, migration, atau aplikasi sudah terpasang pada deployment tertentu.

## Deploy Supabase

Jalankan dari root repository dengan Supabase CLI pada project yang benar:

```sh
supabase login
supabase link --project-ref PROJECT_REF
supabase db push
supabase functions deploy arwana-ai
```

`supabase db push` menerapkan migration `supabase/migrations/20261015000000_arwana_ai_rate_limit.sql`. Migration tersebut membuat penghitung per pengguna per menit dan RPC `arwana_ai_consume_rate`; hanya `service_role` yang dapat memanggil RPC, dan browser tidak mendapat akses ke tabelnya. Chat mengembalikan 503 jika migration belum diterapkan.

Set konfigurasi provider dan origin secara aman di Supabase (jangan commit nilainya):

```sh
supabase secrets set --project-ref PROJECT_REF \
  ARWANA_LLM_API_KEY='ISI_SECRET_PROVIDER' \
  ARWANA_LLM_CHAT_URL='https://api.openai.com/v1/chat/completions' \
  ARWANA_LLM_MODEL='gpt-4o-mini' \
  ARWANA_ALLOWED_ORIGINS='https://HOST-ARWANA-ANDA'
```

`ARWANA_ALLOWED_ORIGINS` harus cocok persis dengan origin HTTPS situs (scheme dan host, tanpa path); pisahkan beberapa origin dengan koma. Function juga menggunakan `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` dari environment server Supabase. Pastikan ketiganya tersedia di Edge Functions; `service_role` hanya untuk server, jangan pernah menaruhnya di HTML.

Buat akun pengguna melalui Supabase Auth. Pengguna perlu baris di `public.profiles` dengan `id` yang sama dengan UUID Auth dan role yang diizinkan oleh Edge Function: `sekretaris_dprd`, `admin`, `kabag_umum_keuangan`, `kabag_persidangan_perundang`, `kabag_anggaran_pengawasan`, atau `staf`. Agent `akip_evidence` hanya tersedia untuk role pengelola yang tercantum di kode. Jangan mengaktifkan pendaftaran publik kecuali memang dibutuhkan.

## Deploy frontend

Hubungkan repository ke Cloudflare Pages: framework preset **None**, build command kosong, output directory `/` (root), dan gunakan HTTPS. Aplikasi menyertakan URL Supabase dan anon key publik sebagai konfigurasi awal; halaman login menyediakan **Config** untuk menggantinya. Jika diganti, gunakan URL dan anon/publishable key dari project yang juga menjalankan Edge Function. Jangan pernah memasukkan service-role key atau key provider ke browser.

## Verifikasi setelah deploy

1. Login dengan akun uji yang memiliki profil dan role yang valid.
2. Buka **ARWANA AI Assistant**, baca pernyataan privasi, lalu centang consent cloud.
3. Tekan **Uji Koneksi AI**. Ini memeriksa autentikasi, profil/role dan keberadaan secret, bukan ketersediaan provider.
4. Kirim prompt pendek nonrahasia. Respons yang berhasil melewati Edge Function ditandai nama model; respons fallback lokal diberi label terpisah.
5. Periksa **Supabase Dashboard → Edge Functions → arwana-ai → Logs** bila prompt gagal.

Diagnosis singkat: 401 = token/sesi; 403 = origin, profil/role atau izin agent; 503 = secret atau migration rate limit; 429 = batas 25 permintaan per pengguna per menit; 502 = provider/model/kuota. CORS origin juga harus benar.

Jangan gunakan data rahasia/terklasifikasi. Prompt cloud dan konteks terbatas dikirim ke provider model eksternal dan dapat menimbulkan biaya. Hasil AI adalah draf/rekomendasi, bukan verifikasi hukum atau keputusan resmi; AI tidak mengubah data operasional secara otomatis. Data aplikasi prototipe masih dapat berada di `localStorage`; login AI tidak otomatis memigrasikan atau melindungi data tersebut dengan RLS.

## Pemeriksaan statis

Jalankan `python3 scripts/check_html.py` dari root repository untuk pemeriksaan HTML/JavaScript inline dan pemindaian secret sederhana.
