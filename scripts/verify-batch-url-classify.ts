/**
 * Smoke check for batch_website_check URL classification (no network).
 * Run: npx tsx scripts/verify-batch-url-classify.ts
 */
import assert from "node:assert/strict";
import { classifyWebsiteCheckInput } from "../lib/agent/tools/batch-website-check";

const ok = (raw: string) => {
  const r = classifyWebsiteCheckInput(raw);
  assert(r && r.ok === true, `expected ok for ${JSON.stringify(raw)}`);
  return r.url;
};

const bad = (raw: string, err: string) => {
  const r = classifyWebsiteCheckInput(raw);
  assert(r && r.ok === false && r.error === err, `expected ${err} for ${JSON.stringify(raw)}`);
};

bad("javascript:alert(1)", "blocked_scheme");
bad("data:text/html,hi", "blocked_scheme");
bad("ftp://x.com", "unsupported_protocol");
bad("not a url", "invalid_url");

assert(ok("example.com").includes("example.com"));
assert(ok("https://a.com/path").startsWith("https://"));

console.log("verify-batch-url-classify: ok");
