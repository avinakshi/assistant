/**
 * Thin wrapper around chrome.storage.local. Extension code uses `token` and
 * `apiBaseUrl` — both optional until the user pastes them in the popup.
 */

export interface ExtensionConfig {
  readonly token?: string;
  readonly apiBaseUrl?: string;
}

const DEFAULT_API = 'http://localhost:3001';

export async function readConfig(): Promise<ExtensionConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['token', 'apiBaseUrl'], (items) => {
      const token = typeof items['token'] === 'string' ? (items['token'] as string) : undefined;
      const apiBaseUrl =
        typeof items['apiBaseUrl'] === 'string' ? (items['apiBaseUrl'] as string) : DEFAULT_API;
      resolve({ ...(token ? { token } : {}), apiBaseUrl });
    });
  });
}

export async function writeConfig(cfg: ExtensionConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        ...(cfg.token !== undefined ? { token: cfg.token } : {}),
        ...(cfg.apiBaseUrl !== undefined ? { apiBaseUrl: cfg.apiBaseUrl } : {}),
      },
      () => resolve(),
    );
  });
}

export async function clearToken(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['token'], () => resolve());
  });
}
