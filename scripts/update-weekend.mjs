// Builds data/weekend.json — the Race Brief's "this weekend" data — from the FIA's public
// event documents: Pirelli's tyre prescriptions (compounds, pressures, stint limit), the
// Race Director's notes, the stewards' decisions (grid drops, fines, reprimands) and open
// summonses. Run by .github/workflows/weekend-data.yml, which publishes the result on the
// `weekend-data` branch for every copy of Pit Wall to fetch.
//
//   node scripts/update-weekend.mjs [--season 2026] [--prev old.json] [--out weekend.json]
//
// --prev is the last published file: documents already parsed there are reused, so a run
// only downloads what's new. Needs `pdftotext` (poppler) on PATH.
//
// Some things the PDFs don't carry as text (the stint limit is drawn as a graphic), and the
// plain-English rule summaries are written by a person: both come from
// data/weekend-overrides.json and are merged in.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIA = "https://www.fia.com";
const INDEX = `${FIA}/documents/championships/fia-formula-one-world-championship-14`;
const UA = { "User-Agent": "Mozilla/5.0" };

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const wantSeason = Number(arg("season")) || new Date().getUTCFullYear();
const outPath = arg("out") ?? join(ROOT, "data", "weekend.json");
const prev = readJson(arg("prev")) ?? {};
const overrides = readJson(join(ROOT, "data", "weekend-overrides.json")) ?? {};
const tmp = mkdtempSync(join(tmpdir(), "weekend-"));

function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r;
    if (attempt >= 2 || r.status < 500) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
}
const html = async (url) => (await get(url)).text();

async function pdfText(url) {
  const file = join(tmp, `${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, Buffer.from(await (await get(url)).arrayBuffer()));
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 16 << 20 });
}

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** "27.11.26 17:38" + "CET" → ISO (CET is UTC+1, CEST UTC+2) */
function publishedIso(stamp, zone) {
  const m = /(\d\d)\.(\d\d)\.(\d\d) (\d\d):(\d\d)/.exec(stamp);
  if (!m) return null;
  const off = zone === "CEST" ? 2 : 1;
  return new Date(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]) - off, Number(m[5]))).toISOString();
}

/** The documents listed for the event a page shows expanded */
function parseDocs(page) {
  const docs = [];
  const re = /<a href="(\/system\/files\/decision-document\/[^"]+\.pdf)"[^>]*>[\s\S]*?<div class="title">([\s\S]*?)<\/div>[\s\S]*?date-display-single">([^<]+)<\/span>\s*([A-Z]{3,4})?/g;
  for (const m of page.matchAll(re)) {
    const full = decode(m[2]);
    const num = Number(/^Doc (\d+)/i.exec(full)?.[1]) || null;
    docs.push({ num, title: full.replace(/^Doc \d+\s*-\s*/i, ""), url: FIA + m[1], published: publishedIso(m[3], m[4]) });
  }
  return docs;
}

// ---- Pirelli prescriptions --------------------------------------------------------------

const ROLE = { W: "hard", Y: "medium", R: "soft" };

function parsePirelli(text) {
  const tyres = {};
  const mandatory = [];
  for (const line of text.split("\n")) {
    // "  C1    A1W   A2W   A3W   A4W        C1"  (the W/Y/R marking says hard/medium/soft)
    const m = /^\s*(C[1-6])\s+[A-Z]\d([WYR])\s+\S+\s+\S+\s+\S+(?:\s+(C[1-6]))?\s*$/.exec(line);
    if (m) {
      tyres[ROLE[m[2]]] = m[1];
      if (m[3]) mandatory.push(m[3]);
    }
  }
  // "Q3 tyre" heads its column on the Intermediate row; the compound sits on the next line
  const q3 = /Q3 tyre\s*\n[^\n]*?\b(C[1-6])\s*$/m.exec(text)?.[1] ?? null;
  const front = /Front\s+([\d.]+)\s*psi/.exec(text)?.[1];
  const rear = /Rear\s+([\d.]+)\s*psi/.exec(text)?.[1];
  const cap = /maximum number of laps permitted[^:\n]*:\s*(\d{1,2})\b/i.exec(text)?.[1] ?? /maximum (?:of )?(\d{1,2}) laps/i.exec(text)?.[1];
  if (!tyres.hard || !tyres.medium || !tyres.soft) return null;
  return {
    ...tyres,
    mandatory: mandatory.length ? mandatory : undefined,
    q3: q3 ?? undefined,
    pressures: front && rear ? { front: Number(front), rear: Number(rear) } : undefined,
    stintCap: cap ? Number(cap) : undefined,
  };
}

// ---- Race Director's notes --------------------------------------------------------------

function parseNotes(text) {
  const sections = [];
  for (const line of text.split("\n")) {
    // Top-level headings only: "1. Laps during Qualifying Session" (not "6.1 During ...")
    const m = /^\s{0,8}(\d{1,2})\.\s+([A-Z][^\n]{3,90}?)\s*$/.exec(line);
    if (m && !/[.;,]$/.test(m[2]) && m[2].split(" ").length <= 12) sections.push(m[2].trim());
  }
  return [...new Set(sections)];
}

// ---- Stewards' decisions ----------------------------------------------------------------

const FIELD = /^\s{0,3}(No \/ Driver|Competitor|Time|Session|Fact|Infringement|Decision|Reason)\s+(.*)$/;

function parseDecision(text) {
  const f = {};
  let cur = null;
  for (const raw of text.split("\n")) {
    const m = FIELD.exec(raw);
    if (m) {
      cur = m[1];
      if (cur === "Reason") break; // the reasoning is long; the outcome is all we show
      f[cur] = m[2].trim();
    } else if (cur && /^\s{6,}\S/.test(raw)) {
      f[cur] += " " + raw.trim();
    } else if (cur && raw.trim()) {
      cur = null; // a non-indented line ends the field (signatures, footers)
    }
  }
  const nd = /^(\d+)\s*-\s*(.+)$/.exec(f["No / Driver"] ?? "");
  return {
    car: nd?.[1],
    driver: nd?.[2]?.trim(),
    team: f.Competitor,
    session: f.Session,
    fact: f.Fact,
    decision: f.Decision,
  };
}

const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s) => Number(s) || WORD[s?.toLowerCase()] || null;

/** A grid penalty in a decision's text: places, back of the grid or a pit-lane start */
function gridPenalty(decision) {
  if (!decision) return null;
  let m = /drop of (\w+) grid positions?/i.exec(decision) ?? /(\w+)[- ]place grid (?:penalty|drop)/i.exec(decision);
  if (m && num(m[1])) return { kind: "places", places: num(m[1]) };
  if (/back of the (?:starting )?grid/i.test(decision)) return { kind: "back" };
  if (/(?:start|starts) (?:the race )?from the pit ?lane/i.test(decision)) return { kind: "pitlane" };
  return null;
}

/** A short label for a decision, and how serious it is */
function outcome(decision, title) {
  const d = decision ?? "";
  const parts = [];
  let kind = "info";
  const grid = gridPenalty(d);
  if (grid) {
    kind = "grid";
    parts.push(grid.kind === "places" ? `−${grid.places} grid places` : grid.kind === "back" ? "Back of the grid" : "Pit lane start");
  }
  const secs = /(\d+)[- ]seconds? (?:time )?penalty/i.exec(d);
  if (secs) (kind = "penalty"), parts.push(`${secs[1]}s penalty`);
  if (/drive[- ]through/i.test(d)) (kind = "penalty"), parts.push("Drive-through");
  if (/stop[- ](?:and|&)[- ]go/i.test(d)) (kind = "penalty"), parts.push("Stop-go");
  if (/disqualif/i.test(d)) (kind = "penalty"), parts.push("Disqualified");
  const fine = /fined? (?:of )?€\s?([\d,.]+)/i.exec(d) ?? /€\s?([\d,.]+)/.exec(d);
  if (fine) {
    if (kind === "info") kind = "fine";
    const amount = (s) => {
      const n = Number(s.replace(/[,.](?=\d{3}\b)/g, "").replace(",", "."));
      return n >= 1000 ? `€${Math.round(n / 1000)}k` : `€${n}`;
    };
    const susp = /€\s?([\d,.]+)[^.]*?suspended/i.exec(d.slice(fine.index + fine[0].length));
    parts.push(`${amount(fine[1])} fine${susp ? ` (${amount(susp[1])} suspended)` : ""}`);
  }
  if (/reprimand/i.test(d)) {
    if (kind === "info") kind = "reprimand";
    parts.push(/driving/i.test(d) ? "Reprimand (driving)" : "Reprimand");
  }
  if (/\bwarning\b/i.test(d) && !parts.length) (kind = "warning"), parts.push("Warning");
  const pts = /(\d+) penalty points?/i.exec(d);
  if (pts) parts.push(`+${pts[1]} pts`);
  if (!parts.length && /no (?:further )?(?:penalty|action)|no breach|not (?:been )?breach|take no further/i.test(d)) (kind = "cleared"), parts.push("No penalty");
  if (!parts.length && /permitted to start|allowed to start|permission/i.test(d + title)) parts.push("Allowed to start");
  if (!parts.length && d) parts.push(d.length > 60 ? d.slice(0, 57).trimEnd() + "…" : d);
  return { kind, label: parts.join(" · ") };
}

const carsIn = (title) => [...title.matchAll(/Car (\d+)/gi)].map((m) => m[1]);
const codeOf = (driver) => {
  const last = driver?.trim().split(/\s+/).at(-1);
  return last ? last.normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 3).toUpperCase() : undefined;
};
const docRef = (d) => ({ num: d.num, title: d.title, url: d.url, published: d.published });

// ---- One event ------------------------------------------------------------------------

async function buildEvent(name, docs, before) {
  const reuse = new Map();
  for (const s of before?.stewards ?? []) reuse.set(s.url, s);
  const latest = (re) => docs.filter((d) => re.test(d.title)).sort((a, b) => (b.num ?? 0) - (a.num ?? 0))[0];

  const ev = { name, documents: docs.slice(0, 40).map(docRef) };

  // Tyres: the newest Pirelli preview (V2 supersedes the first)
  const pirelli = latest(/pirelli preview/i);
  if (pirelli) {
    ev.tyres = before?.tyres?.doc?.url === pirelli.url ? before.tyres : { ...(parsePirelli(await pdfText(pirelli.url)) ?? {}), doc: docRef(pirelli) };
    if (!ev.tyres.hard) delete ev.tyres;
  }

  const notes = latest(/race director'?s (?:competition|event) notes/i);
  if (notes) ev.notes = before?.notes?.doc?.url === notes.url ? before.notes : { doc: docRef(notes), sections: parseNotes(await pdfText(notes.url)) };

  const pu = latest(/pu elements used/i) ?? latest(/new pu elements/i);
  if (pu) ev.puReport = docRef(pu);

  // Stewards: every infringement / decision / offence, parsed for who and what
  const stewards = [];
  for (const d of docs) {
    if (!/^(infringement|decision|offence)\b/i.test(d.title)) continue;
    if (reuse.has(d.url)) {
      stewards.push(reuse.get(d.url));
      continue;
    }
    const entry = { ...docRef(d), cars: carsIn(d.title) };
    if (/deleted lap times/i.test(d.title)) {
      Object.assign(entry, { kind: "laps-deleted", label: "Lap times deleted", session: /^Infringement - (.+?) Deleted/i.exec(d.title)?.[1] });
    } else {
      try {
        const p = parseDecision(await pdfText(d.url));
        const o = outcome(p.decision, d.title);
        Object.assign(entry, p, { code: codeOf(p.driver), kind: o.kind, label: o.label, grid: gridPenalty(p.decision) ?? undefined });
        if (p.car && !entry.cars.includes(p.car)) entry.cars.unshift(p.car);
      } catch (e) {
        console.warn(`Couldn't read ${d.url}: ${e.message}`);
        Object.assign(entry, { kind: "info", label: "" });
      }
    }
    stewards.push(entry);
  }
  ev.stewards = stewards;

  // Summonses no later decision has answered yet (matched by car number)
  const decided = stewards.map((s) => ({ num: s.num ?? 0, cars: s.cars }));
  ev.pending = docs
    .filter((d) => /^summons\b/i.test(d.title))
    .filter((d) => {
      const cars = carsIn(d.title);
      return !decided.some((s) => s.num > (d.num ?? 0) && (cars.length === 0 || cars.some((c) => s.cars.includes(c))));
    })
    .map((d) => ({ ...docRef(d), cars: carsIn(d.title) }));

  // Grid penalties. One decided in the Race applies at the next event; anything decided
  // earlier in the weekend applies to this event's Race.
  ev.grid = stewards.filter((s) => s.grid && !/^race$/i.test(s.session ?? "")).map(gridEntry);
  ev.nextRaceGrid = stewards.filter((s) => s.grid && /^race$/i.test(s.session ?? "")).map(gridEntry);

  const ov = overrides[String(wantSeason)]?.[norm(name)];
  if (ov) {
    if (ov.stintCap && ev.tyres && ev.tyres.stintCap == null) ev.tyres.stintCap = ov.stintCap;
    if (ov.stintCap && ev.tyres) ev.tyres.stintCapSource = ev.tyres.stintCapSource ?? "manual";
    if (ov.rules) ev.rules = ov.rules;
  }
  if (ev.tyres?.stintCap != null && !ev.tyres.stintCapSource) ev.tyres.stintCapSource = "pirelli";

  const stamps = docs.map((d) => d.published).filter(Boolean).sort();
  ev.firstDocAt = stamps[0];
  ev.lastDocAt = stamps.at(-1);
  return ev;
}

const gridEntry = (s) => ({ car: s.car, driver: s.driver, code: s.code, team: s.team, ...s.grid, fact: s.fact, decision: s.decision, num: s.num, url: s.url });

// ---- Main ------------------------------------------------------------------------------

const index = await html(INDEX);
const seasons = [...index.matchAll(/season-(\d{4})-(\d+)/g)].map((m) => ({ year: Number(m[1]), path: m[0] }));
const season = seasons.filter((s) => s.year === wantSeason).sort((a, b) => Number(b.path.split("-").at(-1)) - Number(a.path.split("-").at(-1)))[0];
if (!season) {
  console.error(`No ${wantSeason} season on the FIA documents page yet.`);
  process.exit(0);
}
const seasonUrl = `${INDEX}/season/${season.path}`;
const seasonPage = await html(seasonUrl);
// Newest first: the latest event is an expanded <div>, the rest are <a> links
const eventNames = [...seasonPage.matchAll(/class="event-title[^"]*"[^>]*>\s*([^<]+?)\s*<\/(?:div|a)>/g)].map((m) => decode(m[1]));
if (!eventNames.length) {
  console.error("No events listed yet.");
  process.exit(0);
}

const prevEvents = new Map((prev.season === wantSeason ? prev.events ?? [] : []).map((e) => [e.name, e]));
const events = [];
for (const [i, name] of eventNames.slice(0, 2).entries()) {
  const page = i === 0 ? seasonPage : await html(`${seasonUrl}/event/${encodeURIComponent(name)}`);
  const docs = parseDocs(page);
  if (!docs.length) continue;
  const ev = await buildEvent(name, docs, prevEvents.get(name));
  ev.docsUrl = `${seasonUrl}/event/${encodeURIComponent(name)}`;
  events.push(ev);
}

const next = { season: wantSeason, events };
const strip = (o) => JSON.stringify({ ...o, generatedAt: undefined });
if (strip(next) === strip(prev)) {
  console.log("No change.");
  if (outPath !== arg("prev")) writeFileSync(outPath, JSON.stringify(prev, null, 1) + "\n");
} else {
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...next }, null, 1) + "\n");
  for (const e of events)
    console.log(
      `${e.name}: ${e.documents.length} docs · tyres ${e.tyres ? `${e.tyres.hard}/${e.tyres.medium}/${e.tyres.soft}${e.tyres.stintCap ? ` cap ${e.tyres.stintCap}` : ""}` : "—"} · ${e.stewards.length} decisions · ${e.pending.length} pending · grid ${e.grid.length} (+${e.nextRaceGrid.length} next race)`
    );
}
