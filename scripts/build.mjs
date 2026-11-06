// Validates the YAML sources and generates dist/ (the JSON the app reads). Nobody edits dist/ by hand.
//   node scripts/build.mjs          validate and write dist/
//   node scripts/build.mjs --check  validate only (used by CI)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const check = process.argv.includes("--check");

const SCHEMA = 1; // bump only on a breaking change of the generated format
const MIN_APP = "0.1.32";
const LANGS = ["en", "cs", "de", "es", "fr", "pt"];
const errors = []; // { where, msg, hint }
const err = (where, msg, hint) => errors.push({ where, msg, hint });

/** The closest known id to a mistyped one, or null. */
function closest(word, known) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null;
  for (const k of known) {
    const n = dist(word.toLowerCase(), k);
    if (n <= 2 || k.includes(word.toLowerCase()) || word.toLowerCase().includes(k)) if (!best || n < best.n) best = { k, n };
  }
  return best?.k ?? null;
}
const nameLine = (id) => `${id}: { ${LANGS.map((l) => `${l}: ...`).join(", ")} }`;

const ID = /^[a-z0-9][a-z0-9-]*$/;
const readYaml = (p) => YAML.parse(readFileSync(p, "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const stable = (o) => JSON.stringify(o, null, 2) + "\n";

const categories = readYaml(join(root, "categories.yaml"));
const tags = readYaml(join(root, "tags.yaml"));
for (const [id, names] of Object.entries(tags)) {
  if (!ID.test(id)) err(`tags.yaml/${id}`, "a tag id must be lowercase letters, digits and dashes");
  for (const l of LANGS) if (!names[l]) err(`tags.yaml/${id}`, `missing name in "${l}"`);
}
const publishers = readYaml(join(root, "publishers.yaml"));
for (const [id, names] of Object.entries(categories))
  for (const l of LANGS) if (!names[l]) err(`categories.yaml/${id}`, `missing name in "${l}"`);
for (const [id, p] of Object.entries(publishers)) if (!p.name) err(`publishers.yaml/${id}`, "missing name");

const files = [];
const serversDir = join(root, "servers");
for (const pub of readdirSync(serversDir, { withFileTypes: true }).filter((d) => d.isDirectory()))
  for (const f of readdirSync(join(serversDir, pub.name)).filter((f) => f.endsWith(".yaml")))
    files.push({ folder: pub.name, path: join(serversDir, pub.name, f) });

const details = new Map();
for (const { folder, path } of files) {
  const where = relative(root, path).replaceAll("\\", "/");
  let y;
  try { y = readYaml(path); } catch (e) { err(where, `not valid YAML: ${e.message}`); continue; }
  if (!y || typeof y !== "object") { err(where, "empty file"); continue; }
  for (const k of ["id", "name", "publisher", "category", "transport", "texts"]) if (y[k] == null) err(where, `missing "${k}"`);
  if (y.id && !ID.test(y.id)) err(where, `id "${y.id}" must be lowercase letters, digits and dashes`);
  if (y.id && details.has(y.id)) err(where, `duplicate id "${y.id}"`);
  if (y.publisher && y.publisher !== folder) err(where, `publisher "${y.publisher}" must equal the folder name "${folder}"`);
  if (y.publisher && !publishers[y.publisher])
    err(where, `unknown publisher "${y.publisher}"`, `Add the publisher to publishers.yaml:\n    ${y.publisher}:\n      name: ...\n      homepage: https://...`);
  if (y.category && !categories[y.category]) {
    const m = closest(y.category, Object.keys(categories));
    err(where, `unknown category "${y.category}"`, `${m ? `Did you mean "${m}"? ` : ""}Use one of: ${Object.keys(categories).join(", ")}. A really new category is added to categories.yaml with names in all six languages.`);
  }
  for (const tag of y.tags ?? []) {
    if (tags[tag]) continue;
    const m = closest(String(tag), Object.keys(tags));
    err(where, `tag "${tag}" is not in tags.yaml, so the catalog was NOT built`,
      `${m ? `Did you mean "${m}"? ` : ""}If it is really a new tag, add it to tags.yaml with its name in all six languages:\n    ${nameLine(String(tag))}\n  Known tags: ${Object.keys(tags).join(", ")}`);
  }
  const t = y.transport ?? {};
  if (t.type === "stdio") { if (!t.command) err(where, "stdio needs a command"); }
  else if (t.type === "remote-http") { if (!/^https:\/\//.test(t.url ?? "")) err(where, "remote-http needs an https url"); }
  else err(where, `unknown transport type "${t.type}"`);

  const texts = y.texts ?? {};
  for (const l of Object.keys(texts)) if (!LANGS.includes(l)) err(where, `unknown language "${l}"`);
  const en = texts.en;
  if (!en?.summary || !en?.description) err(where, 'texts.en needs "summary" and "description"');
  const inputs = (y.inputs ?? []).map((i) => {
    if (!i.id) err(where, "an input has no id");
    const e = en?.input?.[i.id];
    if (!e?.label) err(where, `texts.en.input.${i.id}.label is missing`);
    return { ...i, label: e?.label ?? i.id, help: e?.help ?? null };
  });
  const text = JSON.stringify(y.transport);
  for (const m of text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g))
    if (!inputs.some((i) => i.id === m[1])) err(where, `placeholder {{${m[1]}}} has no input`);
  for (const l of Object.keys(texts))
    for (const k of Object.keys(texts[l]?.input ?? {})) if (!inputs.some((i) => i.id === k)) err(where, `texts.${l}.input.${k} is not an input`);

  const { texts: _t, inputs: _i, ...rest } = y;
  details.set(y.id, { ...rest, description: en?.description ?? "", inputs, texts, tags: y.tags ?? [], verified: !!y.verified, requires: y.requires ?? [] });
}

if (errors.length) {
  console.error(`\nThe catalog was NOT built: ${errors.length} problem(s). dist/ was left as it was.\n`);
  for (const [i, e] of errors.entries()) {
    console.error(`${i + 1}. ${e.where}\n   ${e.msg}`);
    if (e.hint) console.error(`   How to fix: ${e.hint}`);
    console.error("");
  }
  process.exit(1);
}
console.log(`OK: ${details.size} server(s), ${Object.keys(publishers).length} publisher(s), ${Object.keys(categories).length} categories, ${Object.keys(tags).length} tags.`);
if (check) process.exit(0);

// ---- generate ----
const out = new Map(); // relative path in dist -> text
const ids = [...details.keys()].sort();
const index = [];
for (const id of ids) {
  const d = details.get(id);
  const body = stable(d);
  out.set(`servers/${id}.json`, body);
  index.push({ id, name: d.name, publisher: d.publisher, category: d.category, tags: d.tags, verified: d.verified, summary: d.texts.en.summary, sha256: sha(body) });
}
out.set("index.json", stable(index));
for (const l of LANGS.filter((l) => l !== "en")) {
  const m = {};
  for (const id of ids) if (details.get(id).texts[l]?.summary) m[id] = details.get(id).texts[l].summary;
  out.set(`index.${l}.json`, stable(m));
}
out.set("categories.json", stable(categories));
out.set("tags.json", stable(tags));
out.set("publishers.json", stable(publishers));

// Catalog version: YYYY.MM.DD.N, bumped only when the content changed.
const contentHash = sha([...out].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}\n${sha(v)}`).join("\n"));
let version;
const mPath = join(dist, "manifest.json");
const prev = existsSync(mPath) ? JSON.parse(readFileSync(mPath, "utf8")) : null;
const now = new Date();
const today = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, "0")}.${String(now.getUTCDate()).padStart(2, "0")}`;
if (prev && prev.contentHash === contentHash && prev.schema === SCHEMA && prev.minAppVersion === MIN_APP) version = prev.version;
else if (prev?.version?.startsWith(today + ".")) version = `${today}.${Number(prev.version.split(".")[3]) + 1}`;
else version = `${today}.1`;
const manifest = {
  schema: SCHEMA,
  version,
  minAppVersion: MIN_APP,
  serverCount: ids.length,
  contentHash,
  files: Object.fromEntries([...out].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sha(v)])),
};
out.set("manifest.json", stable(manifest));

rmSync(dist, { recursive: true, force: true });
for (const [rel, text] of out) {
  const p = join(dist, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
console.log(`Catalog version ${version} written to dist/ (${out.size} files).`);
