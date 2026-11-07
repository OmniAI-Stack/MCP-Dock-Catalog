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
const MIN_APP_ICONS = "0.1.43"; // first app version that downloads icons
const MIN_APP_OAUTH = "0.1.62"; // first app version that can sign in with OAuth (transport.auth)
// AI applications a server can be marked for in "apps" (the ids of clients/clients.json in MCP Dock).
const APPS = ["claude-desktop", "cursor", "cherry-studio", "antigravity", "cline", "chatgpt-desktop"];
const APP_STATUS = ["tested", "works", "avoid"];
const ICON_MAX = { svg: 50 * 1024, png: 100 * 1024 };
const LANGS = ["en", "cs", "de", "es", "fr", "pt"];
const errors = []; // { where, msg, hint }
const err = (where, msg, hint) => errors.push({ where, msg, hint });
const warnings = [];

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

/** Problems of an icon file, empty when it is fine. SVG must not run code or load anything from outside. */
function iconProblems(kind, buf) {
  const p = [];
  if (buf.length > ICON_MAX[kind]) p.push(`is ${Math.ceil(buf.length / 1024)} kB, at most ${ICON_MAX[kind] / 1024} kB is allowed`);
  if (kind === "svg") {
    const text = buf.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) p.push("is not an SVG image (no <svg> element)");
    if (/<script/i.test(text)) p.push("contains <script>");
    if (/\son[a-z]+\s*=/i.test(text)) p.push("contains an event attribute (onload=, onclick=, ...)");
    if (/<foreignObject/i.test(text)) p.push("contains <foreignObject> (embedded HTML)");
    if (/<!ENTITY|<!DOCTYPE/i.test(text)) p.push("contains a DOCTYPE or ENTITY declaration");
    if (/javascript:/i.test(text)) p.push("contains a javascript: link");
    if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(text)) p.push("links to something outside the file (href must start with #)");
    if (/url\(\s*["']?(?!#)/i.test(text)) p.push("loads something with url() from outside the file");
  } else {
    const sig = "89504e470d0a1a0a";
    if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== sig) p.push("is not a PNG image");
    else {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      if (w !== h) p.push(`must be square, it is ${w}×${h} px`);
      if (Math.min(w, h) < 128) p.push(`must be at least 128×128 px, it is ${w}×${h} px`);
    }
  }
  return p;
}

const files = [];
const serversDir = join(root, "servers");
for (const pub of readdirSync(serversDir, { withFileTypes: true }).filter((d) => d.isDirectory()))
  for (const f of readdirSync(join(serversDir, pub.name)).filter((f) => f.endsWith(".yaml")))
    files.push({ folder: pub.name, path: join(serversDir, pub.name, f) });
// An image in servers/ without a YAML file of the same name is a mistake.
for (const pub of readdirSync(serversDir, { withFileTypes: true }).filter((d) => d.isDirectory()))
  for (const f of readdirSync(join(serversDir, pub.name)).filter((f) => /\.(svg|png)$/i.test(f))) {
    if (!/\.(svg|png)$/.test(f)) err(`servers/${pub.name}/${f}`, "the icon extension must be lowercase (.svg or .png)");
    else if (!existsSync(join(serversDir, pub.name, f.replace(/\.(svg|png)$/, ".yaml"))))
      err(`servers/${pub.name}/${f}`, "icon without a server", `Name the icon like the server file: ${f.replace(/\.(svg|png)$/, ".yaml")} -> ${f}`);
  }
const icons = new Map(); // server id -> { ext, buf }
const oauthServers = new Set(); // ids of servers that sign in with OAuth

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
  if (t.auth != null) {
    const a = t.auth;
    if (t.type !== "remote-http") err(where, "transport.auth is only for remote-http servers");
    else if (typeof a !== "object" || a.type !== "oauth")
      err(where, 'transport.auth.type must be "oauth"', "Servers with an API key use a header with a {{placeholder}} instead of auth.");
    else {
      for (const k of Object.keys(a)) if (!["type", "scopes", "clientId"].includes(k)) err(where, `unknown key transport.auth.${k}`, 'Allowed: type, scopes, clientId.');
      if (a.scopes != null && (!Array.isArray(a.scopes) || a.scopes.some((x) => typeof x !== "string" || !x.trim())))
        err(where, "transport.auth.scopes must be a list of texts", "For example: scopes: [openid, email]. Leave it out to ask for the scopes the server lists.");
      if (a.clientId != null && (typeof a.clientId !== "string" || !a.clientId.trim()))
        err(where, "transport.auth.clientId must be a text", "Leave it out when the server registers clients itself.");
      oauthServers.add(y.id);
    }
  }

  // apps: how the server does in each AI application. Missing application = "works" (should work, not tried).
  const apps = {};
  if (y.apps != null && (typeof y.apps !== "object" || Array.isArray(y.apps))) err(where, '"apps" must be a mapping', "For example:\n    apps:\n      claude-desktop: tested");
  else for (const [app, v] of Object.entries(y.apps ?? {})) {
    if (!APPS.includes(app)) {
      const m = closest(app, APPS);
      err(where, `unknown app "${app}" in apps`, `${m ? `Did you mean "${m}"? ` : ""}Known apps: ${APPS.join(", ")}.`);
      continue;
    }
    const status = typeof v === "string" ? v : v?.status;
    const note = typeof v === "object" && v ? v.note ?? {} : {};
    if (!APP_STATUS.includes(status)) { err(where, `apps.${app}: status must be one of ${APP_STATUS.join(", ")}`); continue; }
    if (typeof v === "object" && v) for (const k of Object.keys(v)) if (!["status", "note"].includes(k)) err(where, `apps.${app}: unknown key "${k}"`, "Allowed: status, note.");
    if (typeof note !== "object" || Array.isArray(note)) { err(where, `apps.${app}.note must be a mapping by language`); continue; }
    for (const [l, text] of Object.entries(note)) {
      if (!LANGS.includes(l)) err(where, `apps.${app}.note: unknown language "${l}"`);
      else if (typeof text !== "string" || !text.trim()) err(where, `apps.${app}.note.${l} must be a text`);
    }
    if (status === "avoid" && !note.en)
      err(where, `apps.${app} is "avoid" but has no note`, `Say briefly why, at least in English:\n    ${app}:\n      status: avoid\n      note:\n        en: ...\n        cs: ...`);
    if (status !== "avoid" && Object.keys(note).length) warnings.push(`${where}: apps.${app} has a note, but the app shows notes only for "avoid"`);
    if (status === "works" && !Object.keys(note).length) warnings.push(`${where}: apps.${app}: works is the default, the line can be left out`);
    apps[app] = Object.keys(note).length ? { status, note } : { status };
  }

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

  // Icon: <id>.svg (preferred) or <id>.png next to the server file. Without one the app shows initials.
  const base = path.replace(/\.yaml$/, "");
  const found = ["svg", "png"].filter((ext) => existsSync(`${base}.${ext}`));
  if (found.length > 1) err(where, "has both an .svg and a .png icon", "Keep only one of them (SVG is preferred).");
  else if (found.length === 1) {
    const ext = found[0];
    const buf = readFileSync(`${base}.${ext}`);
    const problems = iconProblems(ext, buf);
    for (const msg of problems) err(`${where.replace(/\.yaml$/, "")}.${ext}`, `the icon ${msg}`);
    if (!problems.length && y.id) icons.set(y.id, { ext, buf });
  } else warnings.push(`${where}: no icon (${where.split("/").pop().replace(/\.yaml$/, "")}.svg or .png), the app shows initials`);

  const { texts: _t, inputs: _i, apps: _a, ...rest } = y;
  const icon = icons.has(y.id) ? `icons/${y.id}.${icons.get(y.id).ext}` : undefined;
  details.set(y.id, { ...rest, ...(icon ? { icon } : {}), description: en?.description ?? "", inputs, texts, tags: y.tags ?? [], verified: !!y.verified, requires: y.requires ?? [], ...(Object.keys(apps).length ? { apps } : {}) });
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
for (const w of warnings) console.log(`Note: ${w}`);
console.log(`OK: ${details.size} server(s), ${icons.size} icon(s), ${Object.keys(publishers).length} publisher(s), ${Object.keys(categories).length} categories, ${Object.keys(tags).length} tags.`);
if (check) process.exit(0);

// ---- generate ----
const out = new Map(); // relative path in dist -> text (or the bytes of an icon)
const ids = [...details.keys()].sort();
const index = [];
for (const id of ids) {
  const d = details.get(id);
  const body = stable(d);
  out.set(`servers/${id}.json`, body);
  index.push({ id, name: d.name, publisher: d.publisher, category: d.category, tags: d.tags, verified: d.verified, ...(d.icon ? { icon: d.icon } : {}), summary: d.texts.en.summary, sha256: sha(body) });
  if (icons.has(id)) out.set(d.icon, icons.get(id).buf);
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
// The oldest app version that understands everything in the catalog. "apps" needs nothing: older apps ignore it.
const newer = (a, b) => (a.split(".").map(Number).reduce((r, n, i) => r || n - Number(b.split(".")[i] ?? 0), 0) >= 0 ? a : b);
let minApp = MIN_APP;
if (icons.size) minApp = newer(MIN_APP_ICONS, minApp);
if (oauthServers.size) minApp = newer(MIN_APP_OAUTH, minApp);
if (prev && prev.contentHash === contentHash && prev.schema === SCHEMA && prev.minAppVersion === minApp) version = prev.version;
else if (prev?.version?.startsWith(today + ".")) version = `${today}.${Number(prev.version.split(".")[3]) + 1}`;
else version = `${today}.1`;
const manifest = {
  schema: SCHEMA,
  version,
  minAppVersion: minApp,
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
