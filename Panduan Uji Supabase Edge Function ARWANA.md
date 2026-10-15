# Panduan Uji Supabase Edge Function ARWANA

## Cakupan agent

Uji enam agent umum: `design`, `regulation`, `implementor`, `sql`, `evolution`, dan `output`. Versi HTML yang ada juga mendukung agent khusus ketujuh, `akip_evidence` (AKIP Evidence Assistant). Uji agent AKIP secara terpisah dengan role yang diizinkan.

## 1. Pemeriksaan database dan RLS `profiles`

1. Buka **Supabase Dashboard → SQL Editor** pada proyek yang benar.
2. Jalankan skrip read-only [`ARWANA-Check-DB-Profiles-RLS.sql`](ARWANA-Check-DB-Profiles-RLS.sql).
3. Pada hasil pertama, periksa `profiles_exists = true`, `rls_enabled = true`, dan status diagnostik. RLS aktif saja belum membuktikan ekspresi policy sudah aman.
4. Periksa hasil kedua untuk role, command, `USING`, dan `WITH CHECK`. Policy permissive `SELECT` dengan `USING (true)` berpotensi membuka seluruh baris yang dapat dibaca oleh role tersebut.
5. Hasil ketiga menampilkan privilege tabel untuk `anon` dan `authenticated`.

Skrip hanya membaca katalog database; tidak mengubah data atau policy. SQL Editor umumnya memakai role berprivilege tinggi, sehingga hasil ini tidak mensimulasikan akses pengguna akhir. Uji RLS fungsional juga melalui aplikasi/API dengan sesi authenticated.

## 2. Prasyarat Edge Function

- Pengguna uji harus mempunyai baris `public.profiles` dengan `profiles.id` yang sama dengan UUID `auth.users.id`, serta `profiles.role` yang termasuk role diizinkan.
- Pastikan environment Edge Function memiliki `ARWANA_LLM_API_KEY`, `ARWANA_LLM_CHAT_URL`, `ARWANA_LLM_MODEL`, dan `ARWANA_ALLOWED_ORIGINS`. Jangan simpan key provider di HTML atau Git.
- `ARWANA_ALLOWED_ORIGINS` harus cocok persis dengan origin hosting, termasuk `https://` tetapi tanpa path. Domain aktual harus diambil dari deployment Cloudflare Pages, bukan ditebak dari URL GitHub.
- Fungsi juga memerlukan `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` di server. Jangan pernah mengekspos service-role key ke browser.
- Pertahankan `verify_jwt = true` di `supabase/config.toml`.
- Repository menyertakan migration `supabase/migrations/20261015000000_arwana_ai_rate_limit.sql`. Jalankan `supabase db push` sebelum uji chat. Migration membuat RPC `arwana_ai_consume_rate` dengan penghitung atomik per pengguna per menit; hanya `service_role` yang boleh memanggilnya. Jika belum diterapkan, Edge Function mengembalikan 503.

Contoh deploy fungsi (jalankan dari root proyek Supabase yang benar):

```bash
supabase link --project-ref PROJECT_REF
supabase db push
supabase functions deploy arwana-ai
```

Set secrets melalui Dashboard atau CLI di lingkungan aman. Jangan commit nilainya:

```bash
supabase secrets set \
  ARWANA_LLM_API_KEY='ISI_SECRET_PROVIDER' \
  ARWANA_LLM_CHAT_URL='https://api.openai.com/v1/chat/completions' \
  ARWANA_LLM_MODEL='gpt-4o-mini' \
  ARWANA_ALLOWED_ORIGINS='https://HOST-ARWANA-ANDA'
```

## 3. Uji koneksi

1. Buka situs ARWANA terdeploy melalui HTTPS.
2. Login dengan pengguna uji yang memiliki profil dan role valid.
3. Buka **ARWANA AI Assistant**, baca dan berikan consent cloud.
4. Tekan **Uji Koneksi**.

Health check memverifikasi JWT, profil/role, dan konfigurasi secret. Health check tidak mengirim prompt ke provider LLM. Kirim prompt chat pendek untuk memastikan model/provider benar-benar menjawab.

## 4. Uji setiap agent

Gunakan prompt singkat dan data nonrahasia. Pastikan respons berasal dari Edge Function, bukan fallback lokal.

| Agent | Prompt uji | Hasil yang diharapkan |
|---|---|---|
| Design AI (`design`) | “Usulkan patch CSS kecil agar kartu dashboard lebih mudah dibaca; jangan ubah data atau hak akses.” | Jawaban dan patch CSS terbatas pada `#appView`; tinjau pratinjau sebelum menerapkan. |
| Regulation Reader (`regulation`) | “Ringkas dokumen contoh yang tersedia di konteks, sebutkan sumber/ID, dan tandai bila dasar belum cukup.” | Ringkasan berbasis konteks, tanpa mengarang pasal atau kutipan. |
| Workflow Builder (`implementor`) | “Rancang alur tindak lanjut aspirasi ke Pokir beserta status, peran, validasi, dan kasus gagal.” | Rancangan untuk ditinjau, bukan klaim bahwa alur sudah dijalankan. |
| SQL Architect (`sql`) | “Buat draft query baca dengan asumsi kolom yang harus saya verifikasi dan prinsip RLS least-privilege.” | Draft SQL tanpa eksekusi dan tanpa policy terbuka `USING (true)`. |
| Evolution Planner (`evolution`) | “Buat prioritas peningkatan, dependensi, risiko, dan indikator sukses; tandai data yang belum tersedia.” | Prioritas/asumsi dibedakan; tidak mengarang angka GAP. |
| Output Forge (`output`) | “Buat kerangka memo tindak lanjut berlabel DRAF dan tandai bagian yang harus diverifikasi.” | Draf yang belum disahkan/dikirim. |
| AKIP Evidence Assistant (`akip_evidence`) | “Susun matriks bukti AKIP dari data nonrahasia yang tersedia; sebutkan tabel/ID, gap, status verifikasi, dan langkah lanjut. Jangan memberi predikat.” | Hanya menggunakan konteks yang tersedia dan membedakan catatan dari bukti terverifikasi. |

Untuk `regulation` dan `akip_evidence`, muat dokumen/data relevan lebih dulu. Jika konteks kosong, respons yang tepat adalah menyatakan sumber belum cukup, bukan menebak.

## 5. Log dan diagnosis

Buka **Supabase Dashboard → Edge Functions → `arwana-ai` → Logs** dan cocokkan waktunya dengan uji di aplikasi.

- **401**: token tidak ada, kedaluwarsa, atau tidak valid.
- **403**: origin tidak diizinkan, profil/role tidak valid, atau role tidak diizinkan untuk agent AKIP.
- **400**: action, agent, prompt, atau consent tidak valid.
- **503**: secret LLM belum tersedia atau RPC rate-limit belum diterapkan.
- **429**: batas 25 permintaan per pengguna per menit tercapai.
- **502**: provider menolak, tidak terjangkau, atau memberi respons yang tidak dapat diproses.

Jangan gunakan data rahasia/terklasifikasi. Setiap chat yang mencapai provider dapat menimbulkan biaya provider. Jangan membagikan access token, `service_role`, atau API key provider.