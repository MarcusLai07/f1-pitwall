// chrome.storage.local in the extension, localStorage on the dev page.

const hasChromeStorage = typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function loadValue<T>(key: string): Promise<T | undefined> {
  if (hasChromeStorage) {
    const got = await chrome.storage.local.get(key);
    return got[key] as T | undefined;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveValue<T>(key: string, value: T): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or quota: layouts just won't persist
  }
}

export async function removeValue(key: string): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.remove(key);
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
