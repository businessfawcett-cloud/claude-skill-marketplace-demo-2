#!/usr/bin/env node
// Reconciles one project's granted-skills declaration (projects/<repo>.yml)
// into that repo's .claude/settings.json enabledPlugins. Additive only --
// this is the rare, PR-worthy "grant a new skill" event (see FINDINGS.md),
// not a revocation mechanism. Never removes or disables an existing entry.
//
// Hand-rolled parser instead of a YAML library: no package.json/dependency
// exists in this repo yet, and the format here is intentionally flat
// (`key: value` pairs plus one `key:` / `- item` list), well short of
// needing a real YAML parser.
const fs = require("node:fs");
const path = require("node:path");

function parseSimpleYaml(text) {
  const result = {};
  let currentListKey = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && currentListKey) {
      result[currentListKey].push(listItem[1].trim());
      continue;
    }
    const pair = line.match(/^(\S+):\s*(.*)$/);
    if (pair) {
      const [, key, value] = pair;
      if (value === "") {
        result[key] = [];
        currentListKey = key;
      } else {
        result[key] = value.trim();
        currentListKey = null;
      }
      continue;
    }
    throw new Error(`Could not parse line: "${rawLine}"`);
  }
  return result;
}

const [, , projectYamlPath, downstreamRepoPath] = process.argv;
if (!projectYamlPath || !downstreamRepoPath) {
  console.error("Usage: node sync-enabled-plugins.js <projects/repo.yml> <path-to-downstream-repo>");
  process.exit(1);
}

const project = parseSimpleYaml(fs.readFileSync(projectYamlPath, "utf8"));
if (!Array.isArray(project.skills) || !project.marketplace) {
  console.error(`"${projectYamlPath}" is missing a "marketplace" key or a "skills" list`);
  process.exit(1);
}

const settingsPath = path.join(downstreamRepoPath, ".claude", "settings.json");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
settings.enabledPlugins ??= {};

const added = [];
for (const skill of project.skills) {
  const pluginId = `${skill}@${project.marketplace}`;
  if (settings.enabledPlugins[pluginId] !== true) {
    settings.enabledPlugins[pluginId] = true;
    added.push(pluginId);
  }
}

if (added.length === 0) {
  console.log(`${downstreamRepoPath}: already up to date, no grant needed`);
  process.exit(0);
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`${downstreamRepoPath}: granted ${added.length} skill(s): ${added.join(", ")}`);
