/**
 * Small AES-256-GCM wrapper for encrypting OAuth tokens at rest.
 * Requires AGENT_ENCRYPTION_KEY (base64 32 bytes) or a 64-char hex string.
 * Falls back to plaintext with a loud console warning if no key is set —
 * acceptable only in local dev.
 */

import crypto from "node:crypto";

function getKey(): Buffer | null {
  const raw = process.env.AGENT_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch {}
  return null;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AGENT_ENCRYPTION_KEY missing in production — refusing to store plaintext OAuth token",
      );
    }
    console.warn(
      "[crypto] AGENT_ENCRYPTION_KEY not set, storing token in plaintext (dev only)",
    );
    return "plain:" + plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(blob: string): string {
  if (blob.startsWith("plain:")) return blob.slice("plain:".length);
  if (!blob.startsWith("v1:"))
    throw new Error("Unknown ciphertext format");
  const key = getKey();
  if (!key) throw new Error("AGENT_ENCRYPTION_KEY not set");
  const buf = Buffer.from(blob.slice("v1:".length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
