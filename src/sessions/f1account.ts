// F1 TV sign-in, borrowed from the browser. formula1.com keeps the login in a cookie
// (URL-encoded JSON whose data.subscriptionToken is a JWT); since 15 Oct 2026 F1's
// timing archive wants that token as a Bearer header, the way FastF1 sends it. You sign
// in on formula1.com itself, and the token never leaves this browser.

import { create } from "zustand";

export const SIGN_IN_URL = "https://account.formula1.com/#/en/login?redirect=https%3A%2F%2Ff1tv.formula1.com%2F";

export type AccountState = "unavailable" | "signed-out" | "expired" | "no-subscription" | "signed-in";

interface F1Account {
  state: AccountState;
  expires?: number; // epoch ms
  product?: string; // "F1 TV Pro", "F1 TV Access"
}

// The dev page can't read cookies; only the extension can sign in
const hasCookies = typeof chrome !== "undefined" && !!chrome.cookies;

export const useF1Account = create<F1Account>(() => ({ state: hasCookies ? "signed-out" : "unavailable" }));

let token: string | null = null;
let expires = 0;

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
  const all = await chrome.cookies.getAll({ domain: "formula1.com" });
  // "login-session" on today's site, "loginSession" on older ones
  const t = all
    .filter((c) => /^login-?session$/i.test(c.name))
    .map((c) => tokenFrom(c.value))
    .find(Boolean);
  const c = t ? claims(t) : null;
  expires = typeof c?.exp === "number" ? c.exp * 1000 : 0;
  const status = typeof c?.SubscriptionStatus === "string" ? c.SubscriptionStatus : undefined;
  const live = !!t && (!expires || expires > Date.now());
  token = live && status !== "inactive" ? t : null;
  useF1Account.setState({
    state: !t ? "signed-out" : !live ? "expired" : status === "inactive" ? "no-subscription" : "signed-in",
    expires: expires || undefined,
    product: typeof c?.SubscribedProduct === "string" ? c.SubscribedProduct : undefined,
  });
}

let watching = false;

/** Read the sign-in now and follow it as formula1.com changes it */
export function watchF1Account() {
  if (!hasCookies || watching) return;
  watching = true;
  readCookie();
  chrome.cookies.onChanged.addListener(({ cookie }) => {
    if (cookie.domain.endsWith("formula1.com") && /^login-?session$/i.test(cookie.name)) readCookie();
  });
}

/** Opens formula1.com's sign-in page in a tab */
export function openSignIn() {
  if (hasCookies) chrome.tabs.create({ url: SIGN_IN_URL });
  else window.open(SIGN_IN_URL, "_blank");
}

/** The F1 TV token for archive requests, or null when not signed in (or it ran out) */
export function f1Token(): string | null {
  if (token && expires && expires <= Date.now()) {
    token = null;
    useF1Account.setState({ state: "expired" });
  }
  return token;
}
