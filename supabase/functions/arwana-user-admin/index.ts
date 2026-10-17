import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const ALLOWED_ROLES = new Set([
  "sekretaris_dprd",
  "admin",
  "kabag_umum_keuangan",
  "kabag_persidangan_perundang",
  "kabag_anggaran_pengawasan",
  "staf",
]);
const DELEGATED_ROLES = new Set([
  "kabag_umum_keuangan",
  "kabag_persidangan_perundang",
  "kabag_anggaran_pengawasan",
  "staf",
]);

type Profile = {
  id: string;
  email: string;
  nama_lengkap: string;
  nip: string | null;
  role: string;
  bagian_id: string | null;
  jabatan: string | null;
  is_active: boolean | null;
  can_manage_users: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}
function fail(status: number, message: string) {
  return json(status, { ok: false, error: message });
}
function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}
function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "Terjadi kesalahan yang tidak diketahui.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Metode tidak diizinkan.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return fail(500, "Konfigurasi server Supabase belum lengkap.");
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const jwtMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!jwtMatch) return fail(401, "Token login diperlukan.");

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerResult, error: callerError } = await callerClient.auth.getUser(jwtMatch[1]);
  if (callerError || !callerResult.user) return fail(401, "Sesi login tidak valid atau sudah berakhir.");
  const caller = callerResult.user;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: actor, error: actorError } = await adminClient
      .from("profiles")
      .select("id,email,nama_lengkap,role,bagian_id,is_active,can_manage_users")
      .eq("id", caller.id)
      .maybeSingle();
    if (actorError) return fail(500, "Gagal memeriksa kewenangan pengguna: " + actorError.message);
    if (!actor || actor.is_active === false) return fail(403, "Profil aktif tidak ditemukan atau akun dinonaktifkan.");

    const isSekwan = actor.role === "sekretaris_dprd";
    const isDelegatedAdmin = actor.role === "admin" && actor.can_manage_users === true;
    if (!isSekwan && !isDelegatedAdmin) {
      return fail(403, "Hanya Sekretaris DPRD atau admin yang diberi delegasi yang dapat mengelola akun.");
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Format permintaan tidak valid.");
    } catch {
      return fail(400, "Isi permintaan JSON tidak valid.");
    }
    const action = cleanText(body.action, 30);

    async function profileById(id: string): Promise<Profile | null> {
      const { data, error } = await adminClient.from("profiles").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    }
    async function authUserById(id: string) {
      const { data, error } = await adminClient.auth.admin.getUserById(id);
      if (error) throw error;
      if (!data.user) throw new Error("Akun autentikasi tidak ditemukan.");
      return data.user;
    }
    async function checkBagian(value: string | null) {
      if (!value) return null;
      if (!validUuid(value)) throw new Error("Bagian yang dipilih tidak valid.");
      const { data, error } = await adminClient.from("bagian").select("id").eq("id", value).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Bagian yang dipilih tidak ditemukan di master Struktur Organisasi.");
      return value;
    }
    async function activeSekwanCount(): Promise<number> {
      const { data, error } = await adminClient.from("profiles").select("id").eq("role", "sekretaris_dprd").eq("is_active", true);
      if (error) throw error;
      return (data ?? []).length;
    }
    function mayManageTarget(target: Profile | null, targetId: string): string | null {
      if (targetId === caller.id) return "Akun yang sedang digunakan tidak boleh dihapus atau dinonaktifkan dari menu ini.";
      if (!isSekwan && (!target || ["sekretaris_dprd", "admin"].includes(target.role) || target.can_manage_users === true)) {
        return "Admin delegasi hanya dapat mengelola akun staf/bagian, bukan akun penguasa atau admin lain.";
      }
      return null;
    }

    if (action === "list") {
      const users: Array<Record<string, unknown>> = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 500 });
        if (error) throw error;
        const pageUsers = data.users ?? [];
        users.push(...pageUsers);
        if (pageUsers.length < 500) break;
      }
      const { data: profiles, error: profileError } = await adminClient
        .from("profiles")
        .select("id,email,nama_lengkap,nip,role,bagian_id,jabatan,is_active,can_manage_users,created_at,updated_at");
      if (profileError) throw profileError;
      const { data: bagianRows, error: bagianError } = await adminClient.from("bagian").select("id,kode,nama").order("nama");
      if (bagianError) throw bagianError;
      const profileMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p]));
      const bagianMap = new Map((bagianRows ?? []).map((b: any) => [String(b.id), b]));
      const result = users.map((u: any) => {
        const p: any = profileMap.get(String(u.id));
        const b: any = p?.bagian_id ? bagianMap.get(String(p.bagian_id)) : null;
        return {
          id: u.id,
          email: p?.email ?? u.email ?? "",
          nama_lengkap: p?.nama_lengkap ?? u.user_metadata?.nama_lengkap ?? u.user_metadata?.name ?? "",
          nip: p?.nip ?? null,
          role: p?.role ?? null,
          bagian_id: p?.bagian_id ?? null,
          bagian_nama: b?.nama ?? null,
          bagian_kode: b?.kode ?? null,
          jabatan: p?.jabatan ?? null,
          is_active: p?.is_active !== false,
          can_manage_users: p?.can_manage_users === true,
          profile_exists: !!p,
          created_at: p?.created_at ?? u.created_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        };
      }).sort((a: any, b: any) => String(a.nama_lengkap || a.email).localeCompare(String(b.nama_lengkap || b.email), "id"));
      return json(200, { ok: true, users: result, bagian: bagianRows ?? [], capability: { canManage: true, isSekwan } });
    }

    if (action === "create") {
      const email = cleanText(body.email, 254).toLowerCase();
      const name = cleanText(body.nama_lengkap, 160);
      const password = String(body.password ?? "");
      const nip = cleanText(body.nip, 40) || null;
      const jabatan = cleanText(body.jabatan, 160) || null;
      const role = cleanText(body.role, 80);
      const bagianId = await checkBagian(cleanText(body.bagian_id, 64) || null);
      if (!validEmail(email)) return fail(400, "Format email tidak valid.");
      if (name.length < 2) return fail(400, "Nama lengkap minimal 2 karakter.");
      if (password.length < 8) return fail(400, "Kata sandi awal minimal 8 karakter.");
      if (!ALLOWED_ROLES.has(role) || role === "sekretaris_dprd") return fail(400, "Role Sekretaris DPRD tidak dapat dibuat melalui formulir umum. Role tersebut harus diprovisikan secara khusus.");
      if (!isSekwan && !DELEGATED_ROLES.has(role)) return fail(403, "Admin delegasi hanya dapat membuat akun staf atau Kabag.");
      const canManage = isSekwan && role === "admin" && body.can_manage_users === true;
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nama_lengkap: name, nip, jabatan },
      });
      if (createError) return fail(400, "Gagal membuat akun autentikasi: " + createError.message);
      if (!created.user) return fail(500, "Supabase tidak mengembalikan akun baru.");
      const { error: upsertError } = await adminClient.from("profiles").upsert({
        id: created.user.id, email, nama_lengkap: name, nip, role, bagian_id: bagianId, jabatan,
        is_active: true, can_manage_users: canManage, updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (upsertError) {
        await adminClient.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        return fail(400, "Profil gagal dibuat; akun Auth baru dibatalkan. Detail: " + upsertError.message);
      }
      return json(200, { ok: true, user: { id: created.user.id, email, nama_lengkap: name, role }, message: "Akun Auth dan profil berhasil dibuat." });
    }

    if (action === "update") {
      const id = cleanText(body.id, 64);
      if (!validUuid(id)) return fail(400, "ID akun tidak valid.");
      const target = await profileById(id);
      if (!isSekwan && (!target || (id !== caller.id && (["sekretaris_dprd", "admin"].includes(target.role) || target.can_manage_users === true)))) return fail(403, "Admin delegasi tidak dapat mengubah akun Sekretaris atau admin lain.");
      const authUser = await authUserById(id);
      const email = cleanText(body.email, 254).toLowerCase();
      const name = cleanText(body.nama_lengkap, 160);
      const password = String(body.password ?? "");
      const nip = cleanText(body.nip, 40) || null;
      const jabatan = cleanText(body.jabatan, 160) || null;
      const role = cleanText(body.role, 80);
      const bagianId = await checkBagian(cleanText(body.bagian_id, 64) || null);
      if (!validEmail(email)) return fail(400, "Format email tidak valid.");
      if (name.length < 2) return fail(400, "Nama lengkap minimal 2 karakter.");
      if (password && password.length < 8) return fail(400, "Kata sandi baru minimal 8 karakter.");
      if (!ALLOWED_ROLES.has(role)) return fail(400, "Role tidak dikenal.");
      if (role === "sekretaris_dprd" && target?.role !== "sekretaris_dprd") return fail(403, "Role Sekretaris DPRD tidak dapat diberikan melalui edit pengguna biasa.");
      if (!isSekwan && !DELEGATED_ROLES.has(role) && role !== target?.role) return fail(403, "Admin delegasi tidak boleh menaikkan role menjadi admin atau Sekretaris DPRD.");
      if (!isSekwan && role !== target?.role) return fail(403, "Admin delegasi tidak boleh mengubah role akun ini.");
      const isSelf = id === caller.id;
      if (isSelf && (email !== String(authUser.email ?? target?.email ?? "").toLowerCase() || password || role !== target?.role || (Boolean(body.can_manage_users) !== (target?.can_manage_users === true)))) {
        return fail(403, "Untuk mencegah kehilangan akses, perubahan email, kata sandi, role, atau delegasi akun sendiri tidak diizinkan dari menu ini.");
      }
      if (target?.role === "sekretaris_dprd" && role !== "sekretaris_dprd") {
        const count = await activeSekwanCount();
        if (target.is_active !== false && count <= 1) return fail(409, "Akun Sekretaris DPRD aktif terakhir tidak boleh diturunkan rolenya.");
      }
      const canManage = isSekwan && role === "admin" && body.can_manage_users === true;
      const oldProfile = target ? { ...target } : null;
      const profilePayload = {
        id, email, nama_lengkap: name, nip, role, bagian_id: bagianId, jabatan,
        is_active: target?.is_active !== false, can_manage_users: canManage, updated_at: new Date().toISOString(),
      };
      const { error: profileWriteError } = await adminClient.from("profiles").upsert(profilePayload, { onConflict: "id" });
      if (profileWriteError) return fail(400, "Gagal menyimpan profil: " + profileWriteError.message);
      const authChanges: Record<string, unknown> = { user_metadata: { ...(authUser.user_metadata ?? {}), nama_lengkap: name, nip, jabatan } };
      if (email !== String(authUser.email ?? "").toLowerCase()) {
        authChanges.email = email;
        authChanges.email_confirm = true;
      }
      if (password) authChanges.password = password;
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, authChanges as any);
      if (authUpdateError) {
        if (oldProfile) await adminClient.from("profiles").update(oldProfile).eq("id", id);
        else await adminClient.from("profiles").delete().eq("id", id);
        return fail(400, "Profil tidak dipertahankan karena pembaruan Auth gagal. Detail: " + authUpdateError.message);
      }
      return json(200, { ok: true, user: { id, email, nama_lengkap: name, role }, message: "Profil dan akun berhasil diperbarui." });
    }

    if (action === "status") {
      const id = cleanText(body.id, 64);
      if (!validUuid(id)) return fail(400, "ID akun tidak valid.");
      if (typeof body.active !== "boolean") return fail(400, "Status active harus true atau false.");
      const target = await profileById(id);
      const permissionError = mayManageTarget(target, id);
      if (permissionError) return fail(403, permissionError);
      if (!target) return fail(404, "Profil pengguna tidak ditemukan.");
      if (target.role === "sekretaris_dprd" && body.active === false && target.is_active !== false && await activeSekwanCount() <= 1) {
        return fail(409, "Sekretaris DPRD aktif terakhir tidak boleh dinonaktifkan.");
      }
      const { error: authError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: body.active ? "none" : "87600h" });
      if (authError) return fail(400, "Status login Auth gagal diubah: " + authError.message);
      const { error: profileError } = await adminClient.from("profiles").update({ is_active: body.active, updated_at: new Date().toISOString() }).eq("id", id);
      if (profileError) {
        await adminClient.auth.admin.updateUserById(id, { ban_duration: target.is_active === false ? "87600h" : "none" });
        return fail(400, "Status profil gagal disimpan; status blokir Auth telah diupayakan untuk dikembalikan. Detail: " + profileError.message);
      }
      return json(200, { ok: true, user: { id, is_active: body.active }, message: body.active ? "Akun diaktifkan." : "Akun dinonaktifkan dan login diblokir." });
    }

    if (action === "delete") {
      const id = cleanText(body.id, 64);
      if (!validUuid(id)) return fail(400, "ID akun tidak valid.");
      const target = await profileById(id);
      const permissionError = mayManageTarget(target, id);
      if (permissionError) return fail(403, permissionError);
      if (target?.role === "sekretaris_dprd" && target.is_active !== false && await activeSekwanCount() <= 1) {
        return fail(409, "Akun Sekretaris DPRD aktif terakhir tidak boleh dihapus.");
      }
      const { error } = await adminClient.auth.admin.deleteUser(id);
      if (error) return fail(400, "Akun gagal dihapus: " + error.message);
      // profiles.id references auth.users(id) with ON DELETE CASCADE; no separate profile delete is needed.
      return json(200, { ok: true, user: { id }, message: "Akun Auth berhasil dihapus; profil terkait mengikuti ON DELETE CASCADE." });
    }

    return fail(400, "Aksi tidak dikenal. Gunakan list, create, update, status, atau delete.");
  } catch (error) {
    console.error("arwana-user-admin failed:", error);
    return fail(500, errorText(error));
  }
});
