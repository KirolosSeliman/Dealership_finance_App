import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Deep Capture legal constants are versioned and legally cautious", () => {
  const policyPath = join(repoRoot, "src/lib/market-snap/deep-capture-policy.ts");
  assert.equal(existsSync(policyPath), true);
  const policy = readFileSync(policyPath, "utf8");

  for (const marker of [
    "DEEP_CAPTURE_CONSENT_VERSION",
    "DEEP_CAPTURE_TERMS_VERSION",
    "DEEP_CAPTURE_PRIVACY_VERSION",
    "Authorized Browser Data Capture",
    "Market Snap and Deep Capture",
    "qualified legal counsel",
    "affirmative consent",
    "withdraw",
    "CAPTCHA bypass",
    "anti-bot bypass",
    "credential",
    "cookie",
    "session token",
    "model improvement",
    "Active current bids are not training labels",
  ]) {
    assert.match(policy, new RegExp(marker, "i"));
  }
});

test("Terms and Privacy pages publish Deep Capture policy language in product", () => {
  const termsPath = join(repoRoot, "src/app/terms/page.tsx");
  const privacyPath = join(repoRoot, "src/app/privacy/page.tsx");
  assert.equal(existsSync(termsPath), true);
  assert.equal(existsSync(privacyPath), true);

  const terms = readFileSync(termsPath, "utf8");
  const privacy = readFileSync(privacyPath, "utf8");
  const policy = readFileSync(join(repoRoot, "src/lib/market-snap/deep-capture-policy.ts"), "utf8");
  const legalCopy = `${terms}\n${privacy}\n${policy}`;

  assert.match(terms, /Authorized Browser Data Capture/);
  assert.match(legalCopy, /third-party platform protections/i);
  assert.match(legalCopy, /affirmative consent/i);
  assert.match(legalCopy, /withdraw/i);
  assert.match(privacy, /Market Snap and Deep Capture/);
  assert.match(legalCopy, /vehicle identity/i);
  assert.match(legalCopy, /listing economics/i);
  assert.match(legalCopy, /media metadata/i);
  assert.match(legalCopy, /retention/i);
  assert.match(legalCopy, /model improvement/i);
});

test("Market Snap extension options show Deep Capture consent disclosure before network capture", () => {
  const optionsHtml = readFileSync(join(repoRoot, "browser-extension/options.html"), "utf8");
  const storage = readFileSync(join(repoRoot, "browser-extension/src/storage.js"), "utf8");

  assert.match(optionsHtml, /Deep Capture Mode/);
  assert.match(optionsHtml, /requires affirmative consent/i);
  assert.match(optionsHtml, /client is authorized/i);
  assert.match(optionsHtml, /No CAPTCHA bypass/i);
  assert.match(optionsHtml, /No credential, cookie, token, or session capture/i);
  assert.match(optionsHtml, /normal capture/i);
  assert.match(optionsHtml, /model improvement/i);
  assert.match(optionsHtml, /can be withdrawn/i);
  assert.match(storage, /observePageNetworkData:\s*false/);
});
