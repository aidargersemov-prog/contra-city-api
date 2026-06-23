"use strict";

// CommonJS is required because the workspace root is configured as ESM.

const fs = require("fs");
const path = require("path");

const battleRoot = path.resolve(__dirname, "..");
const sourcePath = path.resolve(
  battleRoot,
  "..",
  "resources_textures_export",
  "TextAsset",
  "default.txt",
);
const outputPath = path.join(battleRoot, "wear-bonus-texts.json");

const wearTypes = new Map([
  ["Hats", 1],
  ["Masks", 2],
  ["Gloves", 3],
  ["Shirts", 4],
  ["Pants", 5],
  ["Boots", 6],
  ["Backpacks", 7],
  ["Others", 8],
  ["Heads", 9],
]);

const source = fs.readFileSync(sourcePath, "utf8");
const entries = {};
const entryPattern = /^wear_(Hats|Masks|Gloves|Shirts|Backpacks|Boots|Pants|Others|Heads)_(.+)_desca$/;

function gettextValue(lines, field) {
  const index = lines.findIndex((line) => line.startsWith(`${field} `));
  if (index < 0) return "";
  const fragments = [lines[index].slice(field.length + 1)];
  for (let cursor = index + 1; cursor < lines.length && lines[cursor].startsWith('"'); cursor += 1) {
    fragments.push(lines[cursor]);
  }
  return fragments.map((fragment) => {
    const body = fragment.startsWith('"') && fragment.endsWith('"')
      ? fragment.slice(1, -1)
      : fragment;
    return body.replace(/\\(n|r|t|"|\\)/g, (match, escaped) => ({
      n: "\n",
      r: "\r",
      t: "\t",
      '"': '"',
      "\\": "\\",
    })[escaped]);
  }).join("");
}

for (const block of source.split(/\r?\n\r?\n/)) {
  const lines = block.split(/\r?\n/);
  const idMatch = gettextValue(lines, "msgid").match(entryPattern);
  if (!idMatch) continue;
  const value = gettextValue(lines, "msgstr").trim();
  if (!value) continue;
  entries[`${wearTypes.get(idMatch[1])}:${idMatch[2].toLowerCase()}`] = value;
}

if (Object.keys(entries).length !== 315) {
  throw new Error(`Expected 315 non-empty wear bonuses, got ${Object.keys(entries).length}`);
}

fs.writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
console.log(`Generated ${Object.keys(entries).length} wear bonuses: ${outputPath}`);
