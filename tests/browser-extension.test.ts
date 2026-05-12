import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Market Snap extension injects on OpenLane Canada vehicle pages", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "browser-extension/manifest.json"), "utf8"));
  const matches = manifest.content_scripts.flatMap((script: { matches: string[] }) => script.matches);

  assert.ok(matches.includes("https://*.openlane.ca/*"));
  assert.ok(matches.includes("https://*.openlane.com/*"));
});

test("Market Snap extension calls authorized extraction before analysis", () => {
  const popup = readFileSync(join(repoRoot, "browser-extension/src/popup.js"), "utf8");

  assert.match(popup, /extract-authorized-listing/);
  assert.match(popup, /MARKET_SNAP_EXTRACT/);
  assert.match(popup, /Invalid request origin/);
});
