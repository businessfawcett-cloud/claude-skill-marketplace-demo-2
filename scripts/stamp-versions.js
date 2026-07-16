#!/usr/bin/env node
// Stamps each plugin's plugin.json "version" with a content hash of that
// plugin's own files -- so a plugin's resolved version only changes when
// its own content changes, not on every commit to the marketplace repo
// (Claude Code otherwise falls back to the whole-repo commit SHA as
// "version", which flags every plugin as "updated" on any push). Since
// Claude Code checks plugin.json's version before falling back to the
// commit SHA, this fixes per-plugin version accuracy for every native
// tool (claude plugin list/update) and our check-plugins.js at once.
//
// Deterministic and self-stabilizing: the "version" field itself is
// excluded from the hash input, so re-running with no real content
// change reproduces the same hash and writes nothing -- no infinite
// commit loop in CI.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const pluginsDir = path.join(__dirname, "..", "plugins");

function normalize(content) {
  return content.replace(/\r\n/g, "\n");
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

function hashPlugin(pluginDir) {
  const hash = crypto.createHash("sha256");
  const manifestPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  for (const file of listFiles(pluginDir)) {
    const rel = path.relative(pluginDir, file).replace(/\\/g, "/");
    let content = fs.readFileSync(file, "utf8");
    if (file === manifestPath) {
      const manifest = JSON.parse(content);
      delete manifest.version;
      content = JSON.stringify(manifest, Object.keys(manifest).sort());
    }
    hash.update(rel).update("\0").update(normalize(content)).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

let changed = 0;
for (const name of fs.readdirSync(pluginsDir)) {
  const pluginDir = path.join(pluginsDir, name);
  if (!fs.statSync(pluginDir).isDirectory()) continue;
  const manifestPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) continue;

  const version = hashPlugin(pluginDir);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.version === version) continue;

  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${name}: version -> ${version}`);
  changed++;
}

if (changed === 0) console.log("No version changes needed.");
