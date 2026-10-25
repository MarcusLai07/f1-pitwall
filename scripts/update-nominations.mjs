// Updates data/nominations.json with a race's Pirelli compound nomination.
//
//   node scripts/update-nominations.mjs --season 2026 --city "Mexico City" --compounds C3,C4,C5
//   node scripts/update-nominations.mjs --season 2026 --city "Las Vegas" --url <article-url>   # best-effort parse
//
// --compounds is hardest→softest (hard,medium,soft). With --url it fetches the article,
// pulls the distinct C-numbers it mentions and suggests them; always confirm before committing.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "nominations.json");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const season = arg("season");
const city = arg("city");
if (!season || !city) {
  console.error('Need --season and --city. e.g. --season 2026 --city "Mexico City" --compounds C3,C4,C5');
  process.exit(2);
}

let compounds = arg("compounds")?.split(",").map((c) => c.trim().toUpperCase());

const url = arg("url");
if (!compounds && url) {
  const text = await fetch(url).then((r) => r.text());
  // Strip tags, find C1..C6 tokens in order of first appearance
  const plain = text.replace(/<[^>]+>/g, " ");
  const seen = [];
  for (const m of plain.matchAll(/\bC([1-6])\b/g)) if (!seen.includes("C" + m[1])) seen.push("C" + m[1]);
  console.log(`Found compounds mentioned: ${seen.join(", ") || "none"}`);
  if (seen.length >= 3) {
    // Nominations are three consecutive-ish; hardest first (lowest number)
    compounds = seen.slice().sort().slice(0, 3);
    console.log(`Guessing hard→soft: ${compounds.join(", ")} — re-run with --compounds to override.`);
  } else {
    console.error("Couldn't read three compounds; pass --compounds C?,C?,C?");
    process.exit(1);
  }
}
if (!compounds || compounds.length !== 3) {
  console.error("Need three compounds: --compounds C2,C3,C4 (hard,medium,soft)");
  process.exit(2);
}

const doc = JSON.parse(readFileSync(FILE, "utf8"));
doc[season] ??= {};
doc[season][city.toLowerCase()] = { hard: compounds[0], medium: compounds[1], soft: compounds[2], source: url ?? "manual" };
writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n");
console.log(`Set ${season} · ${city}: hard ${compounds[0]}, medium ${compounds[1]}, soft ${compounds[2]}`);
console.log("Commit and push data/nominations.json for every copy to pick it up.");
