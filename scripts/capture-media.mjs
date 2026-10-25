// Records the README screenshots and demo video: the built extension (dist) in headless
// Chrome for Testing, playing back a saved session recording. F1's sign-in requests are
// answered here with stand-ins, so nothing is sent to F1. The schedule (OpenF1, which
// shuts out free users while a session is live) is served from a baked fixture so the
// Calendar and Race brief always fill in; the championship, weather, Pirelli nomination
// and strategy come from their real sources (Jolpica, Open-Meteo, GitHub).
//
//   npm run build && node scripts/capture-media.mjs recordings/2026-us-gp-fp3.ndjson.gz
//
// Writes docs/media/*.png, docs/media/demo.mp4 and docs/media/demo.gif (needs ffmpeg).
// CHROME=/path/to/chrome picks the browser (default: Playwright's cached Chrome for Testing).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.join(import.meta.dirname, "..");
const out = path.join(root, "docs/media");
const dist = path.join(root, "dist");
const recording = path.resolve(process.argv[2] ?? "recordings/2026-us-gp-fp3.ndjson.gz");
const CHROME =
  process.env.CHROME ??
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
// Served under its own name, which the replay bar shows
const REC_URL = `https://pitwall-media.invalid/${path.basename(recording)}`;
const W = 1440, H = 900;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(dist, "manifest.json"))) throw new Error("Build first: npm run build");
if (!fs.existsSync(recording)) throw new Error(`No recording at ${recording}`);
fs.mkdirSync(out, { recursive: true });

// Baked OpenF1 schedule for the current season, so the Calendar and Race brief fill in
// even when OpenF1 is shut (it refuses free users while any session is live). Built from
// Jolpica with scripts/media/season-<year>.json; falls through to the network if absent.
const seasonFixture = path.join(root, "scripts/media", `season-${new Date().getFullYear()}.json`);
const season = fs.existsSync(seasonFixture) ? JSON.parse(fs.readFileSync(seasonFixture, "utf8")) : null;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-media-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--headless=new", "--hide-scrollbars", "--force-color-profile=srgb"],
});

// The recording, served from a made-up address the extension can fetch
const recordingBytes = fs.readFileSync(recording);
await ctx.route(REC_URL, (r) =>
  r.fulfill({ body: recordingBytes, headers: { "content-type": "application/octet-stream", "access-control-allow-origin": "*" } })
);
// Stand-in F1 sign-in: enough for the email/password form to show; nothing reaches F1
await ctx.route("https://account.formula1.com/**", (r) =>
  r.request().url().endsWith("/scripts/main.min.js")
    ? r.fulfill({ contentType: "application/javascript", body: 'var c={davinci:{clientId:"media",acrValues:"media"}};' })
    : r.abort()
);
await ctx.route("https://id.formula1.com/**", (r) =>
  new URL(r.request().url()).pathname === "/as/authorize"
    ? r.fulfill({ json: { id: "media", eventName: "continue", interactionId: "media", _links: { next: { href: "https://id.formula1.com/media" } } } })
    : r.abort()
);
// The season schedule, from the fixture (Jolpica, Open-Meteo and GitHub stay live)
if (season)
  await ctx.route("https://api.openf1.org/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    const body = p.endsWith("/meetings") ? season.meetings : p.endsWith("/sessions") ? season.sessions : null;
    return body ? r.fulfill({ json: body, headers: { "access-control-allow-origin": "*" } }) : r.continue();
  });

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent("serviceworker");
const base = `chrome-extension://${new URL(sw.url()).host}`;

// Headless has no cursor: draw one so the video shows where clicks land (as in Lumen's demo)
const CURSOR = `(() => {
  if (window.__cursor) return;
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 6px rgba(0,0,0,.5);pointer-events:none;opacity:0;transition:transform .12s,opacity .3s";
  document.documentElement.append(c);
  addEventListener("mousemove", (e) => { c.style.opacity = 1; c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => (c.style.transform = "scale(.7)"), true);
  addEventListener("mouseup", () => (c.style.transform = ""), true);
  window.__cursor = c;
})()`;

async function openBoard(page, file = "window.html") {
  await page.goto(`${base}/${file}?replay=${encodeURIComponent(REC_URL)}`);
  await page.locator('[title="Play"]').waitFor({ timeout: 120_000 });
  await page.evaluate(CURSOR);
  // Well into the session, when most cars are running
  await page.evaluate(() => {
    const s = document.querySelector('input[type="range"]');
    const at = Number(s.min) + (Number(s.max) - Number(s.min)) * 0.55;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(s, String(at));
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "4×" }).click();
  await page.locator('[title="Play"]').click();
  await wait(2500);
}

let mouse = { x: W / 2, y: H / 2 };
async function glide(page, x, y, ms = 450) {
  await page.mouse.move(x, y, { steps: Math.max(2, Math.round(ms / 16)) });
  mouse = { x, y };
}
async function clickOn(page, locator, ms) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`Not on the page: ${locator}`);
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, ms);
  await page.mouse.down();
  await wait(80);
  await page.mouse.up();
}
// Top-bar pop-ups (Championship, Calendar) sit under a full-screen catcher; a click
// anywhere closes the open one. Drop the cursor on the map to dismiss before the next.
async function dismissTop(page, ms = 300) {
  await glide(page, W * 0.4, H * 0.42, ms);
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
  await wait(250);
}
// Tower rows carry "Name · Team" titles; the k-th one is the k-th car on the board
const driver = (page, k) => page.locator('[title*=" · "]').nth(k);
const tyre = (page, k) => page.locator('[title="Tyre history"]').nth(k);

/** Bounding box (CSS px) around the elements matching a page-side expression, padded */
async function around(page, expr, pad = 16) {
  const r = await page.evaluate(`(() => {
    const els = (${expr}).filter(Boolean);
    const rs = els.map((e) => e.getBoundingClientRect());
    return { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) };
  })()`);
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  return { x, y, width: Math.min(W, r.r + pad) - x, height: Math.min(H, r.b + pad) - y };
}
const shot = async (page, name, clip) => {
  // Hidden at once: the fade-out transition would still be showing in the screenshot
  await page.evaluate(() => window.__cursor && Object.assign(window.__cursor.style, { transition: "none", opacity: 0 }));
  await page.screenshot({ path: path.join(out, name), clip });
  await page.evaluate(() => window.__cursor && (window.__cursor.style.transition = "transform .12s,opacity .3s"));
  console.log("saved", name);
};

// ---------- screenshots ----------
const page = await ctx.newPage();
await openBoard(page);
await driver(page, 0).click();
await driver(page, 1).click();
await wait(1500);
await shot(page, "window.png");

await driver(page, 2).click();
await driver(page, 3).click();
await wait(1500);
await shot(
  page,
  "telemetry.png",
  await around(page, `[...document.querySelector("#pitwall-root .flex-row-reverse").children, document.querySelector("#pitwall-root .flex-row-reverse").parentElement]`, 14)
);

await tyre(page, 0).click();
await wait(800);
await shot(page, "tyres.png", await around(page, `[document.querySelector("#pitwall-root .fixed.z-50.rounded-xl"), document.querySelector('[title="Tyre history"]')]`, 24));
await page.keyboard.press("Escape");

await page.getByRole("button", { name: "Race control", exact: true }).click();
await wait(1200);
// The open panel and its tab bar (the drawer's top part only holds pop-up messages)
await shot(page, "drawer.png", await around(page, `[...document.querySelector("#pitwall-root .pointer-events-none.absolute.bottom-0.z-40").children].slice(-2)`, 0));
await page.getByRole("button", { name: "Race control", exact: true }).click();

// Race brief: the next race's weather, stakes, Pirelli compounds, strategy, tyres, circuit
await page.getByRole("button", { name: "Race brief" }).click();
await wait(4500);
await shot(page, "racebrief.png", await around(page, `[...document.querySelector("#pitwall-root .pointer-events-none.absolute.bottom-0.z-40").children].slice(-2)`, 0));
await page.getByRole("button", { name: "Race brief" }).click();

// Championship: standings, the title race, with a driver's season expanded
await page.getByRole("button", { name: "Championship", exact: true }).click();
await wait(4500);
await page.locator('[aria-expanded]').nth(2).click(); // a driver's per-race results
await wait(2600);
await shot(page, "championship.png", await around(page, `[document.querySelector('[class*="w-[min(560px"]')]`, 14));
await dismissTop(page);

// Calendar: the season in a month grid, the next round's sessions beside it
await page.getByRole("button", { name: "Calendar", exact: true }).click();
await wait(4500);
await shot(page, "calendar.png", await around(page, `[document.querySelector('[class*="w-[min(660px"]')]`, 14));
await dismissTop(page);

await page.getByRole("button", { name: "Sessions", exact: true }).click();
await wait(4000); // the season's schedule
await page.getByRole("button", { name: /Sign in to F1 TV/ }).click();
await page.locator('input[name="email"]').waitFor();
await wait(500);
await shot(page, "sessions.png", await around(page, `[document.querySelector('[class*="max-h-[min(640px"]')]`, 16));
await page.close();

const panel = await ctx.newPage();
await panel.setViewportSize({ width: 420, height: 900 });
await openBoard(panel, "sidepanel.html");
await driver(panel, 0).click();
await wait(1500);
await shot(panel, "sidepanel.png");
await panel.close();

// ---------- demo video ----------
const frames = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-frames-"));
const demo = await ctx.newPage();
await openBoard(demo);
const cdp = await ctx.newCDPSession(demo);
const shots = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = path.join(frames, `${String(shots.length).padStart(5, "0")}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  shots.push({ file, t: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H });

await glide(demo, W * 0.55, H * 0.45, 600);
await wait(1600);
// Pick drivers: telemetry cards appear, the extras open out to the left
for (const k of [0, 1, 2]) {
  await clickOn(demo, driver(demo, k), 450);
  await wait(k < 2 ? 650 : 1900);
}
// Tyre history
await clickOn(demo, tyre(demo, 1), 550);
await wait(2300);
await demo.keyboard.press("Escape");
await wait(400);
// The 3D map
await clickOn(demo, demo.getByRole("button", { name: "3d", exact: true }), 650);
await wait(2000);
await clickOn(demo, demo.getByRole("button", { name: "top", exact: true }), 400);
await wait(1400);
// Race brief
await clickOn(demo, demo.getByRole("button", { name: "Race brief" }), 650);
await wait(3600);
await clickOn(demo, demo.getByRole("button", { name: "Race brief" }), 300);
await wait(400);
// Championship, expanding a driver's season
await clickOn(demo, demo.getByRole("button", { name: "Championship", exact: true }), 650);
await wait(2200);
await clickOn(demo, demo.locator('[aria-expanded]').nth(2), 450);
await wait(2400);
await dismissTop(demo);
// Calendar
await clickOn(demo, demo.getByRole("button", { name: "Calendar", exact: true }), 550);
await wait(2800);
await dismissTop(demo);
await wait(400);
await cdp.send("Page.stopScreencast");
await wait(300);
await ctx.close();

// Each frame shown until the next arrived, as recorded
const list = shots
  .map((s, i) => `file '${s.file}'\nduration ${Math.max(0.001, ((shots[i + 1]?.t ?? s.t + 0.5) - s.t)).toFixed(3)}`)
  .join("\n");
fs.writeFileSync(path.join(frames, "list.txt"), `${list}\nfile '${shots.at(-1).file}'\n`);
const ff = (...a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" });
ff("-f", "concat", "-safe", "0", "-i", path.join(frames, "list.txt"), "-vf", "fps=30,scale=1440:-2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", path.join(out, "demo.mp4"));
ff("-i", path.join(out, "demo.mp4"), "-vf", "fps=8,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", path.join(out, "demo.gif"));
fs.rmSync(frames, { recursive: true, force: true });
console.log(`saved demo.mp4, demo.gif (${shots.length} frames)`);
