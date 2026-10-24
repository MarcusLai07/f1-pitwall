// The F1 TV login Pit Wall uses. F1's timing archive and live feed take the F1 TV
// "subscription token" (a JWT) as a Bearer header, the way FastF1 sends it. Pit Wall
// gets one by signing in to F1 itself (f1login.ts, F1's OAuth flow as FastF1 does it)
// and keeps only that token. It also still looks in this browser's formula1.com
// cookies, where older versions of the site left one. Every token is checked with
// F1's archive before use, and nothing is sent anywhere but F1.

import { create } from "zustand";
import { loadValue, removeValue, saveValue } from "../lib/storage";
import { finishLogin, LoginError, loginDone, startLogin, submitCredentials, type LoginFlow } from "./f1login";

export type AccountState = "unavailable" | "signed-out" | "expired" | "no-subscription" | "refused" | "signed-in";

/** What Pit Wall made of one token-holding cookie */
export interface TokenCheck {
  cookie: string;
  verdict: "accepted" | "unverified" | "expired" | "inactive" | "refused";
  expires?: number;
}

interface F1Account {
  state: AccountState;
  expires?: number; // epoch ms
  product?: string; // "F1 TV Pro", "F1 TV Access"
  /** The sign-in form is open */
  formOpen?: boolean;
  /** Why a login that's there couldn't be used */
  problem?: string;
  /** F1's word on the subscription, from the token ("active", "inactive", …) */
  status?: string;
  /** What the last look turned up: formula1.com cookie names (never values), each token's verdict, and the one used */
  scan?: { names: string[]; checks: TokenCheck[]; from?: string };
}

// The dev page can't read cookies; only the extension can sign in
const hasCookies = typeof chrome !== "undefined" && !!chrome.cookies;

export const useF1Account = create<F1Account>(() => ({ state: hasCookies ? "signed-out" : "unavailable" }));

let token: string | null = null;
let expires = 0;
let signedOut = false; // signed out of Pit Wall (not of formula1.com)
const SIGNED_OUT_KEY = "f1tv:signedOut";
// The F1 TV token from signing in inside Pit Wall (never the password)
let ownToken: string | null = null;
const OWN_TOKEN_KEY = "f1tv:token";
const OWN = "Pit Wall sign-in";

function claims(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
}

const JWT = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/** An F1 TV token is a JWT carrying F1's subscription claims */
function isF1Token(v: string): boolean {
  if (!JWT.test(v)) return false;
  const c = claims(v);
  return !!c && ("SubscriptionStatus" in c || "SubscribedProduct" in c);
}

function dig(o: unknown, depth = 0): string | null {
  if (depth > 6 || !o || typeof o !== "object") return null;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && /subscriptiontoken/i.test(k) && JWT.test(v)) return v;
  }
  for (const v of Object.values(o)) {
    if (typeof v === "string" && v.startsWith("{")) {
      try {
        const t = dig(JSON.parse(v), depth + 1);
        if (t) return t;
      } catch {
        // not JSON after all
      }
    }
    const t = dig(v, depth + 1);
    if (t) return t;
  }
  return null;
}

/**
 * The F1 TV token in a cookie value: today it's URL-encoded JSON with
 * data.subscriptionToken, but any nesting, or a bare token, is accepted too.
 */
function tokenFrom(value: string): string | null {
  let v = value;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(v);
      if (d === v) break;
      v = d;
    } catch {
      break;
    }
  }
  v = v.trim().replace(/^"|"$/g, "");
  if (isF1Token(v)) return v;
  try {
    return dig(JSON.parse(v));
  } catch {
    return null;
  }
}

async function formula1Cookies(): Promise<chrome.cookies.Cookie[]> {
  const all = await chrome.cookies.getAll({ domain: "formula1.com" });
  try {
    // Partitioned cookies only come back when asked for (Chrome 119+)
    const partitioned = await chrome.cookies.getAll({ domain: "formula1.com", partitionKey: {} });
    for (const c of partitioned) if (!all.some((a) => a.name === c.name && a.domain === c.domain && a.value === c.value)) all.push(c);
  } catch {
    // Older browsers don't take a partition key
  }
  return all;
}

// F1's verdict on each token seen: true accepted, false refused (401)
const verdicts = new Map<string, boolean>();

/** Asks F1's archive whether it takes this token; null when it couldn't say (offline, blocked) */
async function f1Accepts(t: string): Promise<boolean | null> {
  const known = verdicts.get(t);
  if (known !== undefined) return known;
  try {
    const res = await fetch(`https://livetiming.formula1.com/static/${new Date().getUTCFullYear()}/Index.json`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.status === 401) verdicts.set(t, false);
    else if (res.ok) verdicts.set(t, true);
    return verdicts.get(t) ?? null;
  } catch {
    return null;
  }
}

// Every token found on the last look, best first (kept for the F1 test below)
let candidates: { cookie: string; token: string }[] = [];

export interface LoginTest {
  cookie: string;
  /** Non-personal facts from the token: plan, status, region, dates; claim names only otherwise */
  facts: [string, string][];
  /** What F1 answered (HTTP status, or the error) */
  answers: [string, string][];
}

// Claims safe to show as values; the rest (names, IDs) are listed by name only
const SHOWN_CLAIMS = /^(SubscribedProduct|SubscriptionStatus|ExternalAuthorizationsContextData|.*country.*|exp|iat|nbf)$/i;

/** Tries the best token found against F1's archive and live feed, for diagnosing a refusal */
export async function testLogin(): Promise<LoginTest | null> {
  const c = candidates[0];
  if (!c) return null;
  const cl = claims(c.token) ?? {};
  const facts: [string, string][] = [];
  for (const [k, v] of Object.entries(cl)) {
    if (!SHOWN_CLAIMS.test(k)) continue;
    facts.push([k, /^(exp|iat|nbf)$/.test(k) && typeof v === "number" ? new Date(v * 1000).toLocaleString() : String(v)]);
  }
  facts.push(["other claims", Object.keys(cl).filter((k) => !SHOWN_CLAIMS.test(k)).join(", ") || "none"]);
  const year = new Date().getUTCFullYear();
  const bearer = { Authorization: `Bearer ${c.token}` };
  const ask = async (label: string, url: string, init?: RequestInit): Promise<[string, string]> => {
    try {
      const res = await fetch(url, { ...init, cache: "no-store" });
      return [label, `${res.status} ${res.statusText}`.trim()];
    } catch (err) {
      return [label, err instanceof Error ? err.message : String(err)];
    }
  };
  const answers = await Promise.all([
    ask(`archive ${year} index, with login`, `https://livetiming.formula1.com/static/${year}/Index.json`, { headers: bearer }),
    ask(`archive ${year - 1} index, with login`, `https://livetiming.formula1.com/static/${year - 1}/Index.json`, { headers: bearer }),
    ask(`archive ${year} index, no login`, `https://livetiming.formula1.com/static/${year}/Index.json`),
    ask("live feed, with login", "https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1", {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/json" },
    }),
  ]);
  return { cookie: c.cookie, facts, answers };
}

/** A token F1 refused elsewhere (the archive or the live feed): stop using it */
export function reportRefused(t: string) {
  if (verdicts.get(t) === false) return;
  verdicts.set(t, false);
  if (t === token) readCookie();
}

let reading: Promise<void> = Promise.resolve();

/** One look at a time: cookie events and the sign-in poll can overlap */
function readCookie(): Promise<void> {
  reading = reading.then(lookForLogin, lookForLogin);
  return reading;
}

async function lookForLogin() {
  if (signedOut) {
    token = null;
    useF1Account.setState({ state: "signed-out", expires: undefined, product: undefined, problem: undefined, status: undefined });
    return;
  }
  const all = await formula1Cookies();
  // Pit Wall's own sign-in first, then formula1.com's login cookie ("login-session",
  // "loginSession" on older sites), then tokens in other cookies, longest-lasting first
  const isLogin = (name: string) => name === OWN || /^login-?session$/i.test(name);
  const logins = all.filter((c) => isLogin(c.name));
  const found = [...(ownToken ? [{ cookie: OWN, token: ownToken as string | null }] : []), ...all.map((c) => ({ cookie: c.name, token: tokenFrom(c.value) }))]
    .filter((f): f is { cookie: string; token: string } => !!f.token)
    .map((f) => {
      const c = claims(f.token);
      return { ...f, exp: typeof c?.exp === "number" ? c.exp * 1000 : 0, status: typeof c?.SubscriptionStatus === "string" ? c.SubscriptionStatus : undefined, product: c?.SubscribedProduct };
    })
    .sort((a, b) => Number(b.cookie === OWN) - Number(a.cookie === OWN) || Number(isLogin(b.cookie)) - Number(isLogin(a.cookie)) || b.exp - a.exp);

  const checks: TokenCheck[] = [];
  let pick: (typeof found)[number] | undefined;
  for (const f of found) {
    const check: TokenCheck = { cookie: f.cookie, verdict: "unverified", expires: f.exp || undefined };
    checks.push(check);
    if (pick) continue;
    if (f.exp && f.exp <= Date.now()) check.verdict = "expired";
    else if (f.status === "inactive") check.verdict = "inactive";
    else {
      const ok = await f1Accepts(f.token);
      check.verdict = ok === false ? "refused" : ok ? "accepted" : "unverified";
      if (ok !== false) pick = f;
    }
  }

  candidates = found.map((f) => ({ cookie: f.cookie, token: f.token }));
  token = pick?.token ?? null;
  expires = pick?.exp ?? 0;
  const verdicts_ = checks.map((c) => c.verdict);
  const state: AccountState = pick
    ? "signed-in"
    : checks.some((c) => c.verdict === "expired" && isLogin(c.cookie)) || verdicts_.includes("expired")
      ? "expired"
      : verdicts_.includes("refused")
        ? "refused"
        : verdicts_.includes("inactive")
          ? "no-subscription"
          : "signed-out";
  const shown = pick ?? found[0];
  useF1Account.setState({
    state,
    expires: shown?.exp || undefined,
    product: typeof shown?.product === "string" ? shown.product : undefined,
    status: shown?.status,
    problem: logins.length && !found.some((f) => isLogin(f.cookie)) ? "formula1.com's login cookie has no F1 TV token in it" : undefined,
    scan: { names: [...new Set(all.map((x) => x.name))].sort(), checks, from: pick?.cookie },
  });
  if (state === "signed-in") useF1Account.setState({ formOpen: false });
}

let ready: Promise<void> | null = null;

/** Loads the sign-in and follows formula1.com's cookies; resolves once it's known */
export function watchF1Account(): Promise<void> {
  if (!hasCookies) return Promise.resolve();
  ready ??= (async () => {
    signedOut = (await loadValue<boolean>(SIGNED_OUT_KEY)) ?? false;
    ownToken = (await loadValue<string>(OWN_TOKEN_KEY)) ?? null;
    await readCookie();
    chrome.cookies.onChanged.addListener(({ cookie }) => {
      if (cookie.domain.endsWith("formula1.com") && /^login-?session$/i.test(cookie.name)) readCookie();
    });
  })();
  return ready;
}

/** Look for the login again */
export function checkF1Account(): Promise<void> {
  return hasCookies ? readCookie() : Promise.resolve();
}

export function openSignInForm(open = true) {
  useF1Account.setState({ formOpen: open });
}

let flow: LoginFlow | null = null;
let flowAt = 0;
// F1's sign-in interactions don't last long; older ones are started again
const FLOW_FRESH_MS = 120_000;

async function useOwnToken(t: string) {
  ownToken = t;
  signedOut = false;
  await Promise.all([saveValue(OWN_TOKEN_KEY, t), saveValue(SIGNED_OUT_KEY, false)]);
  await readCookie();
  if (verdicts.get(t) === false) {
    throw new LoginError("F1 signed you in, but its timing service refused the F1 TV token it gave out");
  }
}

/**
 * Starts signing in. When this browser is already signed in to F1 it can finish
 * without a password ("done"); otherwise the form asks for one.
 */
export async function beginSignIn(): Promise<"done" | "password"> {
  flow = await startLogin();
  flowAt = Date.now();
  if (!loginDone(flow)) return "password";
  await useOwnToken(await finishLogin(flow));
  flow = null;
  return "done";
}

/** Signs in with an F1 account's email and password; the password isn't kept */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  // Sent once only: a resend after a wrong password could lock the account
  const current = flow && Date.now() - flowAt < FLOW_FRESH_MS ? flow : await startLogin();
  flow = null;
  await useOwnToken(await finishLogin(await submitCredentials(current, email, password)));
}

/** Stop using the F1 TV login in Pit Wall (formula1.com itself stays signed in) */
export async function signOut() {
  ownToken = null;
  signedOut = true;
  flow = null;
  await Promise.all([removeValue(OWN_TOKEN_KEY), saveValue(SIGNED_OUT_KEY, true)]);
  await readCookie();
}

/** The F1 TV token for archive requests, or null when not signed in (or it ran out) */
export function f1Token(): string | null {
  if (token && expires && expires <= Date.now()) {
    token = null;
    useF1Account.setState({ state: "expired" });
  }
  return token;
}
