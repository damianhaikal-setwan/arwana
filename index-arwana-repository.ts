// ARWANA repository indexer (Deno). Run locally; never commit service-role credentials.
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: ARWANA_GITHUB_REPO (default damianhaikal-setwan/arwana), ARWANA_GITHUB_BRANCH (default main)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REPO = Deno.env.get("ARWANA_GITHUB_REPO") ?? "damianhaikal-setwan/arwana";
const BRANCH = Deno.env.get("ARWANA_GITHUB_BRANCH") ?? "main";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in local environment.");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DENY_PATH = /(^|\/)(\.git|\.github\/workflows|node_modules|dist|build|coverage|vendor)(\/|$)|(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx|keystore|sqlite|db|zip|png|jpe?g|gif|webp|ico|pdf|docx?|xlsx?|pptx?|mp[34]|mov|woff2?|ttf))$/i;
const ALLOW_EXT = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".sql", ".md", ".txt", ".json", ".toml", ".yml", ".yaml"]);
function ext(path: string) { const i = path.lastIndexOf("."); return i >= 0 ? path.slice(i).toLowerCase() : ""; }
async function sha256Hex(text: string) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function splitChunks(text: string, maxChars = 2600) {
  const chunks: string[] = []; let current = "";
  for (const line of text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim().split("\n")) {
    if (current.length + line.length + 1 > maxChars && current) { chunks.push(current); current = ""; }
    if (line.length > maxChars) { if (current) chunks.push(current); current = ""; for (let i=0;i<line.length;i+=maxChars) chunks.push(line.slice(i,i+maxChars)); }
    else current += (current ? "\n" : "") + line;
  }
  if (current) chunks.push(current); return chunks;
}
async function githubJson(url: string) { const r = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "ARWANA-Knowledge-Indexer" } }); if (!r.ok) throw new Error(`GitHub API ${r.status}: ${url}`); return await r.json(); }
const tree: any = await githubJson(`https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`);
if (tree.truncated) throw new Error("GitHub tree was truncated; split the indexing job before continuing.");
const commitSha = String(tree.sha ?? "");
const blobs = (tree.tree ?? []).filter((x: any) => x.type === "blob" && ALLOW_EXT.has(ext(String(x.path))) && !DENY_PATH.test(String(x.path)) && !/(^|\/)(secrets?|credentials?)(\/|\.|$)/i.test(String(x.path)) && !/(service[_-]?role|api[_-]?key|access[_-]?token|password)/i.test(String(x.path)));
let indexed=0, skipped=0;
for (const item of blobs) {
  const path = String(item.path);
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(rawUrl); if (!response.ok) { skipped++; continue; }
  const type = response.headers.get("content-type") ?? ""; const raw = await response.text();
  if (raw.length > 1_500_000 || type.includes("image/") || raw.includes("\u0000") || /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,}|sb_secret_[0-9A-Za-z_-]{20,}/.test(raw)) { skipped++; console.warn("Skipped unsupported or possible secret-bearing file:", path); continue; }
  const chunks = splitChunks(raw);
  for (let i=0;i<chunks.length;i++) {
    const content = chunks[i]; const hash = await sha256Hex(`${REPO}|${path}|${i}|${content}`);
    const { error } = await supabase.from("arwana_knowledge_chunks").upsert({ repository: REPO, source_type: "repository", file_path: path, title: path.split("/").pop() || path, content, chunk_index: i, commit_sha: commitSha, content_hash: hash, indexed_at: new Date().toISOString() }, { onConflict: "repository,file_path,chunk_index" });
    if (error) throw new Error(`Supabase upsert failed for ${path} chunk ${i}: ${error.message}`); indexed++;
  }
}
console.log(JSON.stringify({ repository: REPO, branch: BRANCH, commitSha, files: blobs.length, chunksUpserted: indexed, skipped }, null, 2));
console.log("After a successful full index, prune stale chunks from deleted files or old chunk counts after verifying the new index.");
