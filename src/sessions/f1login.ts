// Signing in to F1 from Pit Wall, the way FastF1 does since formula1.com stopped
// leaving the F1 TV token in a cookie: OAuth2 authorization code + PKCE against F1's
// identity service (PingOne at id.formula1.com), driven through its JSON flow API.
// The public client id and policy come from account.formula1.com's own script. The
// password goes only to id.formula1.com and is never kept; what comes back is an
// access token whose subscriptionToken claim is the F1 TV token.

const ACCOUNT_ORIGIN = "https://account.formula1.com";
const IDP_ORIGIN = "https://id.formula1.com";
const PING = { "X-Requested-With": "ping-sdk" };

export class LoginError extends Error {}

interface Config {
  clientId: string;
  policyId: string;
}

let config: Promise<Config> | null = null;

/** F1's public sign-in settings, read from its account site like FastF1 does */
function loadConfig(): Promise<Config> {
  config ??= (async () => {
    const res = await fetch(`${ACCOUNT_ORIGIN}/scripts/main.min.js`);
    if (!res.ok) throw new LoginError(`Couldn't reach F1's account site (${res.status})`);
    const body = /\bdavinci:\{([^}]*)\}/.exec(await res.text())?.[1];
    const field = (name: string) => body && new RegExp(`\\b${name}:"([^"]+)"`).exec(body)?.[1];
    const clientId = field("clientId");
    const policyId = field("acrValues");
    if (!clientId || !policyId) throw new LoginError("F1's sign-in has changed; Pit Wall couldn't find its settings");
    return { clientId, policyId };
  })().catch((err) => {
    config = null;
    throw err;
  });
  return config;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));

function claims(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
}

interface FlowStep {
  status?: string;
  id?: string;
  eventName?: string;
  interactionId?: string;
  message?: string;
  _links?: { next?: { href?: string } };
  authorizeResponse?: { code?: string; state?: string };
  details?: { message?: string }[];
}

/** A sign-in in progress: started without credentials, finished with them (or by F1's own session) */
export interface LoginFlow {
  config: Config;
  verifier: string;
  state: string;
  step: FlowStep;
}

async function readStep(res: Response): Promise<FlowStep> {
  const step = (await res.json().catch(() => ({}))) as FlowStep;
  if (!res.ok && !step.message) step.message = `F1's sign-in answered ${res.status}`;
  return step;
}

/** Starts a sign-in. If this browser is already signed in to F1, it may finish here. */
export async function startLogin(): Promise<LoginFlow> {
  const cfg = await loadConfig();
  const verifier = random(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = random(16);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    response_mode: "pi.flow",
    scope: "openid",
    state,
    nonce: random(16),
    code_challenge: challenge,
    code_challenge_method: "S256",
    acr_values: cfg.policyId,
  });
  const res = await fetch(`${IDP_ORIGIN}/as/authorize?${params}`, { headers: PING, credentials: "include" });
  return { config: cfg, verifier, state, step: await readStep(res) };
}

/** Whether the flow has finished, i.e. F1 handed over an authorization code */
export function loginDone(flow: LoginFlow): boolean {
  return flow.step.status === "COMPLETED" && typeof flow.step.authorizeResponse?.code === "string";
}

/** Sends the email and password to F1's identity service (and nowhere else) */
export async function submitCredentials(flow: LoginFlow, username: string, password: string): Promise<LoginFlow> {
  const next = flow.step._links?.next?.href;
  if (!next || !next.startsWith(`${IDP_ORIGIN}/`)) throw new LoginError("F1's sign-in didn't offer a place to send the password");
  const res = await fetch(next, {
    method: "POST",
    headers: { ...PING, "Content-Type": "application/json", interactionId: flow.step.interactionId ?? "" },
    credentials: "include",
    body: JSON.stringify({
      id: flow.step.id,
      eventName: flow.step.eventName,
      interactionId: flow.step.interactionId,
      parameters: { eventType: "submit", data: { actionKey: "SIGNIN", formData: { username, password } } },
    }),
  });
  const step = await readStep(res);
  if (step.status !== "COMPLETED") {
    const why = step.details?.[0]?.message ?? step.message;
    throw new LoginError(why ? `F1 said: ${why}` : "F1 didn't accept the sign-in");
  }
  return { ...flow, step };
}

/** Swaps the authorization code for F1's access token and takes the F1 TV token out of it */
export async function finishLogin(flow: LoginFlow): Promise<string> {
  const { code, state } = flow.step.authorizeResponse ?? {};
  if (!code || state !== flow.state) throw new LoginError("F1's sign-in came back for a different request");
  const res = await fetch(`${IDP_ORIGIN}/as/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    credentials: "include",
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: flow.config.clientId, code, code_verifier: flow.verifier }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new LoginError(json.error_description ?? `F1's sign-in answered ${res.status}`);
  const token = claims(json.access_token)?.subscriptionToken;
  if (typeof token !== "string") throw new LoginError("Signed in, but this F1 account has no F1 TV subscription");
  return token;
}
