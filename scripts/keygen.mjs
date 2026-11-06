// Creates the signing key pair for the catalog (once). The PRIVATE key is written to _private/signing-key.pem
// (the folder is ignored by git; override with MCP_DOCK_SIGNING_KEY). The PUBLIC key goes to
// signing-public-key.txt in this repository and into the app.
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyPath, publicKeyFile, rawPublicKeyBase64 } from "./signing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = keyPath(root);

const rel = relative(root, resolve(target)).replaceAll("\\", "/");
if (!rel.startsWith("..") && !rel.startsWith("_private/")) {
  console.error(`Inside the repository the private key may only live in the ignored folder _private/ (not ${target}).`);
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`A private key already exists: ${target}\nNothing was changed. Delete it yourself only if you really want a NEW key (see the private notes about replacing a key).`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
try { chmodSync(target, 0o600); } catch { /* not supported on Windows, the user folder is private anyway */ }
const pub = rawPublicKeyBase64(publicKey);
writeFileSync(publicKeyFile(root), pub + "\n");

console.log(`Private key written to: ${target}`);
console.log("BACK IT UP now: copy the folder _private/ to your own private backup (NOT to GitHub). If it is lost, a new app version with a new key is needed.");
console.log(`Public key (also saved to signing-public-key.txt):\n${pub}`);
