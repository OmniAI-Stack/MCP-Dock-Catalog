// Shared helpers for keygen.mjs and sign.mjs.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the private key lives: the folder `_private/` of this project (ignored by git). MCP_DOCK_SIGNING_KEY overrides it. */
export const privateDir = (root) => join(root, "_private");
export const keyPath = (root) => process.env.MCP_DOCK_SIGNING_KEY || join(privateDir(root), "signing-key.pem");
export const publicKeyFile = (root) => join(root, "signing-public-key.txt");

/** Raw 32-byte Ed25519 public key as base64 (the form the app embeds). */
export function rawPublicKeyBase64(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

export const loadPrivateKey = (root) => createPrivateKey(readFileSync(keyPath(root)));

/** Public key object from the base64 raw form. */
export function publicKeyFromBase64(b64) {
  const raw = Buffer.from(b64.trim(), "base64");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
}
