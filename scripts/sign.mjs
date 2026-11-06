// Signs dist/manifest.json with the private key and writes dist/manifest.sig (base64 Ed25519 signature of the
// exact bytes of manifest.json).
//   node scripts/sign.mjs            sign, then verify with signing-public-key.txt
//   node scripts/sign.mjs --verify   only verify (used by `npm run check`)
import { createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keyPath, loadPrivateKey, publicKeyFile, publicKeyFromBase64 } from "./signing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "dist", "manifest.json");
const sigPath = join(root, "dist", "manifest.sig");
const verifyOnly = process.argv.includes("--verify");

const fail = (msg) => { console.error(msg); process.exit(1); };
if (!existsSync(manifestPath)) fail("dist/manifest.json does not exist. Run `npm run build` first.");
const manifest = readFileSync(manifestPath);

function verifyNow() {
  if (!existsSync(publicKeyFile(root))) { console.log("No signing-public-key.txt yet, signature not checked. Run `npm run keygen` once."); return; }
  if (!existsSync(sigPath)) fail("dist/ is not signed: dist/manifest.sig is missing. Run `npm run release` (build and sign).");
  const ok = verify(null, manifest, publicKeyFromBase64(readFileSync(publicKeyFile(root), "utf8")), Buffer.from(readFileSync(sigPath, "utf8").trim(), "base64"));
  if (!ok) fail("The signature of dist/manifest.json is NOT valid for signing-public-key.txt. The manifest changed after signing (run `npm run release`) or the key does not match.");
  console.log("Signature OK.");
}

if (verifyOnly) { verifyNow(); process.exit(0); }

if (!existsSync(keyPath(root))) fail(`The private key was not found: ${keyPath(root)}\nCreate it once with \`npm run keygen\` (on the computer that publishes the catalog).`);
const signature = sign(null, manifest, loadPrivateKey(root));
writeFileSync(sigPath, signature.toString("base64") + "\n");
console.log("dist/manifest.sig written.");
verifyNow();
