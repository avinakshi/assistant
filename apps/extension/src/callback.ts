/**
 * Extension callback page. Loaded at
 *   chrome-extension://<id>/callback.html?state=...&access_token=...&refresh_token=...
 *     &expires_at=...&supabase_url=...&supabase_anon_key=...&api_base_url=...
 *
 * Verifies the state nonce against the pending value in storage, writes the session
 * bundle, reports status to the user, and closes the tab.
 *
 * Security: without the state match, we don't persist anything. Prevents a malicious
 * web page from navigating to this URL with attacker-controlled tokens while the user
 * happens to have the extension installed.
 */

interface PendingLogin {
  readonly nonce: string;
  /** Unix ms when this pending state was created. Refuse anything older than 10 min. */
  readonly createdAt: number;
}

const msgEl = document.getElementById('msg') as HTMLParagraphElement;

async function main(): Promise<void> {
  const params = new URL(window.location.href).searchParams;
  const state = params.get('state');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresAt = params.get('expires_at');
  const supabaseUrl = params.get('supabase_url');
  const supabaseAnonKey = params.get('supabase_anon_key');
  const apiBaseUrl = params.get('api_base_url');

  if (!state || !accessToken || !refreshToken || !supabaseUrl || !supabaseAnonKey) {
    fail('Missing required auth parameters. Try signing in again.');
    return;
  }

  // Look up pending-state nonce. Chrome storage is async via callback.
  const pending = await new Promise<PendingLogin | null>((resolve) => {
    chrome.storage.local.get(['pendingLogin'], (items) => {
      const p = items['pendingLogin'];
      resolve(
        p && typeof p === 'object' && typeof p.nonce === 'string' && typeof p.createdAt === 'number'
          ? (p as PendingLogin)
          : null,
      );
    });
  });

  if (!pending) {
    fail('No pending sign-in. Open the extension popup and click Sign in first.');
    return;
  }
  if (Date.now() - pending.createdAt > 10 * 60 * 1_000) {
    fail('Sign-in expired after 10 minutes. Click Sign in again.');
    await clearPending();
    return;
  }
  if (pending.nonce !== state) {
    fail('Sign-in state mismatch. Ignored for security.');
    // Don't clear pending — user may still complete the real flow.
    return;
  }

  const parsedExpires = Number(expiresAt);
  const expiresAtSec = Number.isFinite(parsedExpires)
    ? parsedExpires
    : Math.floor(Date.now() / 1_000) + 3_600;

  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      {
        accessToken,
        refreshToken,
        expiresAt: expiresAtSec,
        supabaseUrl,
        supabaseAnonKey,
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
      },
      () => resolve(),
    );
  });
  await clearPending();

  succeed(
    'Signed in ✓\nYou can close this tab. Click the Interview Copilot extension icon to continue.',
  );

  // Auto-close after a short delay so the user sees the confirmation.
  setTimeout(() => {
    try {
      window.close();
    } catch {
      /* ignore — some Chrome channels block window.close on programmatically-opened tabs */
    }
  }, 1_500);
}

async function clearPending(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['pendingLogin'], () => resolve());
  });
}

function fail(message: string): void {
  msgEl.textContent = message;
  msgEl.style.color = '#dc2626';
}

function succeed(message: string): void {
  msgEl.textContent = message;
  msgEl.style.color = '#059669';
  msgEl.style.whiteSpace = 'pre-wrap';
}

void main();
