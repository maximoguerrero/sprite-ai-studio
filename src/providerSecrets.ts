const sessionSecrets = new Map<string, string>();
const pendingSessionSecrets = new Map<string, string>();
const REMEMBERED_KEYS = "sprite-studio.remembered-provider-keys.v1";

function loadRememberedKeys(): Record<string, string> {
  try {
    const stored = localStorage.getItem(REMEMBERED_KEYS);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function persistRememberedKeys(keys: Record<string, string>) {
  try {
    if (Object.keys(keys).length) localStorage.setItem(REMEMBERED_KEYS, JSON.stringify(keys));
    else localStorage.removeItem(REMEMBERED_KEYS);
  } catch (error) {
    throw new Error("Could not remember the API key in this browser's local storage.");
  }
}

export async function saveProviderSecret(profileId: string, secret: string) {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("store_provider_secret", { profileId, secret });
    return;
  }
  sessionSecrets.set(profileId, secret);
  const remembered = loadRememberedKeys();
  if (remembered[profileId]) {
    remembered[profileId] = secret;
    persistRememberedKeys(remembered);
  }
  pendingSessionSecrets.set(profileId, secret);
}

export async function saveBrowserProviderSecret(profileId: string, secret: string, remember: boolean) {
  if (window.__TAURI_INTERNALS__) return saveProviderSecret(profileId, secret);
  sessionSecrets.set(profileId, secret);
  pendingSessionSecrets.delete(profileId);
  const remembered = loadRememberedKeys();
  if (remember) remembered[profileId] = secret;
  else delete remembered[profileId];
  persistRememberedKeys(remembered);
}

export function isProviderSecretRemembered(profileId: string) {
  if (window.__TAURI_INTERNALS__) return false;
  return Boolean(loadRememberedKeys()[profileId]);
}

export function setProviderSecretRemembered(profileId: string, remember: boolean) {
  if (window.__TAURI_INTERNALS__) return;
  const remembered = loadRememberedKeys();
  if (remember) {
    const secret = sessionSecrets.get(profileId) ?? remembered[profileId];
    if (!secret) throw new Error("Enter the API key for this session before choosing to remember it.");
    remembered[profileId] = secret;
  } else {
    delete remembered[profileId];
  }
  persistRememberedKeys(remembered);
}

export async function getProviderSecret(profileId: string) {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("get_provider_secret", { profileId });
  }
  const pending = pendingSessionSecrets.get(profileId);
  if (pending) {
    pendingSessionSecrets.delete(profileId);
    sessionSecrets.set(profileId, pending);
    return pending;
  }
  const secret = sessionSecrets.get(profileId) ?? loadRememberedKeys()[profileId];
  if (secret) sessionSecrets.set(profileId, secret);
  if (!secret) throw new Error("Enter the API key for this browser session. Browser mode does not persist provider keys.");
  return secret;
}

export async function removeProviderSecret(profileId: string) {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_provider_secret", { profileId });
    return;
  }
  sessionSecrets.delete(profileId);
  pendingSessionSecrets.delete(profileId);
  const remembered = loadRememberedKeys();
  delete remembered[profileId];
  persistRememberedKeys(remembered);
}
