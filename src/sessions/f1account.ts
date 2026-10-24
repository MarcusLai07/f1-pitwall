// F1 TV sign-in, borrowed from the browser. formula1.com keeps the login in a cookie
// (URL-encoded JSON whose data.subscriptionToken is a JWT); F1's timing archive and its
// live feed take that token as a Bearer header, the way FastF1 sends it. You sign in on
// formula1.com itself, and the token never leaves this browser. Signing out only stops
// Pit Wall using it: formula1.com stays signed in.

import { create } from "zustand";
import { loadValue, saveValue } from "../lib/storage";

export const SIGN_IN_URL = "https://account.formula1.com/#/en/login?redirect=https%3A%2F%2Ff1tv.formula1.com%2F";

export type AccountState = "unavailable" | "signed-out" | "expired" | "no-subscription" | "signed-in";

interface F1Account {
  state: AccountState;
  expires?: number; // epoch ms
  product?: string; // "F1 TV Pro", "F1 TV Access"
  /** formula1.com's sign-in window is open and Pit Wall is waiting for the login */
  waiting?: boolean;
  /** Why a login that's there couldn't be used */
  problem?: string;
}

// The dev page can't read cookies; only the extension can sign in
const hasCookies = typeof chrome !== "undefined" && !!chrome.cookies;

export const useF1Account = create<F1Account>(() => ({ state: hasCookies ? "signed-out" : "unavailable" }));

let token: string | null = null;
let expires = 0;
let signedOut = false; // signed out of Pit Wall (not of formula1.com)
const SIGNED_OUT_KEY = "f1tv:signedOut";
let signInWindow: number | undefined; // the formula1.com window Pit Wall opened

function claims(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
}

function tokenFrom(value: string): string | null {
  try {
    const t = JSON.parse(decodeURIComponent(value))?.data?.subscriptionToken;
    return typeof t === "string" && t.split(".").length === 3 ? t : null;
  } catch {
    return null;
  }
}

async function readCookie() {
  if (signedOut) {
    token = null;
    useF1Account.setState({ state: "signed-out", expires: undefined, product: undefined });
    return;
  }
  const all = await chrome.cookies.getAll({ domain: "formula1.com" });
  // "login-session" on today's site, "loginSession" on older ones
  const logins = all.filter((c) => /^login-?session$/i.test(c.name));
  const t = logins.map((c) => tokenFrom(c.value)).find(Boolean);
  const c = t ? claims(t) : null;
  expires = typeof c?.exp === "number" ? c.exp * 1000 : 0;
  const status = typeof c?.SubscriptionStatus === "string" ? c.SubscriptionStatus : undefined;
  const live = !!t && (!expires || expires > Date.now());
  token = live && status !== "inactive" ? t : null;
  const state: AccountState = !t ? "signed-out" : !live ? "expired" : status === "inactive" ? "no-subscription" : "signed-in";
  useF1Account.setState({
    state,
    expires: expires || undefined,
    product: typeof c?.SubscribedProduct === "string" ? c.SubscribedProduct : undefined,
    problem: logins.length && !t ? "formula1.com has a login, but no F1 TV token in it" : undefined,
  });
  if (state === "signed-in" && signInWindow !== undefined) {
    // Signed in: close the window Pit Wall opened and come back
    const id = signInWindow;
    signInWindow = undefined;
    useF1Account.setState({ waiting: false });
    chrome.windows.remove(id).catch(() => {});
    chrome.windows.getCurrent().then((w) => {
      if (w.id !== undefined) chrome.windows.update(w.id, { focused: true });
    });
  }
}

let ready: Promise<void> | null = null;

/** Read the sign-in and follow it as formula1.com changes it; resolves once it's known */
export function watchF1Account(): Promise<void> {
  if (!hasCookies) return Promise.resolve();
  ready ??= (async () => {
    signedOut = (await loadValue<boolean>(SIGNED_OUT_KEY)) ?? false;
    await readCookie();
    chrome.cookies.onChanged.addListener(({ cookie }) => {
      if (cookie.domain.endsWith("formula1.com") && /^login-?session$/i.test(cookie.name)) readCookie();
    });
    chrome.windows.onRemoved.addListener((id) => {
      if (id !== signInWindow) return;
      signInWindow = undefined;
      useF1Account.setState({ waiting: false });
    });
  })();
  return ready;
}

/**
 * Use the browser's formula1.com login. Without one, formula1.com's sign-in page opens
 * in its own window (a tab would land behind Pit Wall's window, in the main browser
 * window) and closes again once the login shows up.
 */
export async function signIn() {
  signedOut = false;
  saveValue(SIGNED_OUT_KEY, false);
  if (!hasCookies) {
    window.open(SIGN_IN_URL, "_blank");
    return;
  }
  await readCookie();
  if (useF1Account.getState().state === "signed-in") return;
  if (signInWindow !== undefined) {
    // Already open: bring it back to the front
    chrome.windows.update(signInWindow, { focused: true }).catch(() => (signInWindow = undefined));
    return;
  }
  const win = await chrome.windows.create({ url: SIGN_IN_URL, type: "normal", width: 520, height: 820, focused: true });
  signInWindow = win?.id;
  useF1Account.setState({ waiting: true });
}

/** Stop using the F1 TV login in Pit Wall (formula1.com itself stays signed in) */
export function signOut() {
  signedOut = true;
  saveValue(SIGNED_OUT_KEY, true);
  readCookie();
}

/** The F1 TV token for archive requests, or null when not signed in (or it ran out) */
export function f1Token(): string | null {
  if (token && expires && expires <= Date.now()) {
    token = null;
    useF1Account.setState({ state: "expired" });
  }
  return token;
}
