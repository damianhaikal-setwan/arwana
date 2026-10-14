-- ARWANA: diagnostik database dan RLS untuk public.profiles
-- READ-ONLY: skrip ini hanya membaca metadata katalog; tidak mengubah tabel, kebijakan, atau data.
-- Jalankan di SQL Editor proyek Supabase yang benar.
-- Catatan: SQL Editor biasanya memakai role berprivilege tinggi; hasil ini memeriksa konfigurasi,
-- bukan simulasi perilaku setiap request pengguna authenticated di aplikasi.

-- Hasil 1: status database, tabel, RLS, dan kebijakan yang berpotensi terlalu luas.
WITH target AS (
  SELECT to_regclass('public.profiles') AS relid
), metrics AS (
  SELECT
    clock_timestamp() AS checked_at,
    current_database() AS database_name,
    current_user AS sql_editor_role,
    target.relid IS NOT NULL AS profiles_exists,
    COALESCE((SELECT c.relrowsecurity FROM pg_class AS c WHERE c.oid = target.relid), false) AS rls_enabled,
    COALESCE((SELECT c.relforcerowsecurity FROM pg_class AS c WHERE c.oid = target.relid), false) AS rls_forced,
    (
      SELECT count(*)
      FROM pg_policies AS p
      WHERE p.schemaname = 'public' AND p.tablename = 'profiles'
    ) AS policy_count,
    (
      SELECT count(*)
      FROM pg_policies AS p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'profiles'
        AND upper(p.permissive) = 'PERMISSIVE'
        AND p.cmd IN ('SELECT', 'ALL')
        AND lower(regexp_replace(COALESCE(p.qual, ''), '[[:space:]()]', '', 'g')) = 'true'
    ) AS unrestricted_permissive_read_policy_count,
    (
      SELECT count(*)
      FROM pg_policies AS p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'profiles'
        AND upper(p.permissive) = 'PERMISSIVE'
        AND (
          (p.cmd IN ('INSERT', 'UPDATE', 'ALL')
           AND lower(regexp_replace(COALESCE(p.with_check, ''), '[[:space:]()]', '', 'g')) = 'true')
          OR
          (p.cmd IN ('DELETE', 'ALL')
           AND lower(regexp_replace(COALESCE(p.qual, ''), '[[:space:]()]', '', 'g')) = 'true')
        )
    ) AS broad_permissive_write_policy_count
  FROM target
)
SELECT
  checked_at,
  database_name,
  sql_editor_role,
  profiles_exists,
  rls_enabled,
  rls_forced,
  policy_count,
  unrestricted_permissive_read_policy_count,
  broad_permissive_write_policy_count,
  CASE
    WHEN NOT profiles_exists THEN 'FAIL: public.profiles tidak ditemukan.'
    WHEN NOT rls_enabled THEN 'FAIL: RLS belum aktif pada public.profiles.'
    WHEN policy_count = 0 THEN 'WARNING: RLS aktif, tetapi tidak ada policy; akses API non-bypass biasanya tertutup.'
    WHEN unrestricted_permissive_read_policy_count > 0 THEN 'WARNING: ditemukan policy SELECT/ALL permissive dengan USING (true); periksa akses baca semua profil.'
    WHEN broad_permissive_write_policy_count > 0 THEN 'WARNING: ditemukan policy tulis permissive yang terlalu luas atau perlu ditinjau.'
    ELSE 'CHECKED: RLS aktif dan policy ditemukan; tetap tinjau rincian policy serta uji dengan sesi pengguna aplikasi.'
  END AS diagnostic_status
FROM metrics;

-- Hasil 2: rincian policy untuk ditinjau. USING (true) pada policy SELECT permissive
-- berarti semua baris yang mendapat privilege SELECT dapat terlihat lewat policy tersebut.
SELECT
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual AS using_expression,
  p.with_check,
  CASE
    WHEN upper(p.permissive) = 'PERMISSIVE'
      AND p.cmd IN ('SELECT', 'ALL')
      AND lower(regexp_replace(COALESCE(p.qual, ''), '[[:space:]()]', '', 'g')) = 'true'
      THEN 'WARNING: policy baca permissive tanpa pembatas baris; tinjau data profil yang dapat dibaca.'
    WHEN upper(p.permissive) = 'PERMISSIVE'
      AND p.cmd IN ('INSERT', 'UPDATE', 'ALL')
      AND lower(regexp_replace(COALESCE(p.with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
      THEN 'WARNING: WITH CHECK permissive; tinjau siapa yang boleh menulis baris.'
    WHEN upper(p.permissive) = 'PERMISSIVE'
      AND p.cmd IN ('DELETE', 'ALL')
      AND lower(regexp_replace(COALESCE(p.qual, ''), '[[:space:]()]', '', 'g')) = 'true'
      THEN 'WARNING: policy hapus permissive; tinjau siapa yang boleh menghapus baris.'
    ELSE 'REVIEW: periksa ekspresi, role, grant, dan kebutuhan akses.'
  END AS review_note
FROM pg_policies AS p
WHERE p.schemaname = 'public' AND p.tablename = 'profiles'
ORDER BY p.policyname;

-- Hasil 3: privilege tabel untuk role API yang lazim digunakan.
SELECT
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- Pemeriksaan RLS fungsional tetap perlu dilakukan melalui aplikasi/API dengan sesi pengguna.
-- Jangan menilai akses pengguna hanya dari SELECT di SQL Editor yang memakai role postgres.