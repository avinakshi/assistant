import Link from 'next/link';

/**
 * Per-platform connection docs (Phase 13h). Plain text walkthroughs rather than screenshots
 * — screenshots rot every time a vendor redesigns their share picker (which is quarterly).
 * Each platform section covers both the standard flow and the most common failure mode
 * (no audio, wrong tab, etc.) because that's what support tickets are mostly about.
 */
export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Help &amp; connection guides</h1>
      <p className="mt-1 text-sm text-ink-500">
        How to share interview audio from the major platforms into Interview Copilot live
        mode. For transcription to work we need the interviewer&rsquo;s audio, which means the
        browser share picker has to be told to include tab / window / system audio.
      </p>

      <PlatformBlock
        id="google-meet"
        title="Google Meet"
        steps={[
          'Open your Google Meet tab and admit yourself into the meeting first — the share picker only shows windows that actually have content.',
          'Open Interview Copilot in a second tab and click Live → Start session.',
          'In the browser share dialog, pick the Chrome / Edge tab row (not Window / Entire screen) and choose the Google Meet tab.',
          'Critical: toggle "Share tab audio" on before clicking Share. On Chrome it’s a checkbox at the bottom-left of the picker; on Edge it’s the speaker icon next to the tab preview.',
          'If no audio shows up after 10 seconds, the share almost certainly forgot the audio toggle — stop and re-share.',
        ]}
      />

      <PlatformBlock
        id="zoom"
        title="Zoom"
        steps={[
          'Zoom has two share modes: (a) Zoom web client (runs in a browser tab), (b) Zoom desktop app.',
          'Zoom web client: Use the Chrome tab share path (same as Google Meet above) and remember to enable Share tab audio.',
          'Zoom desktop app: tab share won’t pick it up. Use Window share → pick the Zoom Meeting window. On Chrome + macOS / Windows 11, the picker offers "Also share system audio" — turn it on.',
          'Linux caveat: Chrome on Linux cannot capture system audio from the share picker. The only workaround is PulseAudio loopback, which is unsupported; switch to the Zoom web client for the interview.',
        ]}
      />

      <PlatformBlock
        id="teams"
        title="Microsoft Teams"
        steps={[
          'Teams has the same two-mode split as Zoom: web client (teams.microsoft.com) or desktop app.',
          'Web client: the Teams web audio element is inside an iframe, which means the Chrome tab share reliably captures it. Enable Share tab audio and pick the Teams tab.',
          'Desktop app: share the Teams window and enable system audio. On Edge for Windows the picker label is "Also share audio"; on Chrome it’s "Also share system audio".',
          'Teams sometimes routes interviewer audio to a virtual device named "Teams Meeting". If the browser picker offers a microphone/system selector, make sure it’s on Default — selecting the Teams Meeting device causes echo.',
        ]}
      />

      <PlatformBlock
        id="webex"
        title="Cisco Webex"
        steps={[
          'Webex only runs well on the desktop client — the web client often downgrades audio to a level the browser can’t re-capture.',
          'Share the Webex desktop app window via the browser’s window picker and enable system audio.',
          'If the other side sounds muffled or robotic, it’s a Webex codec issue, not an Interview Copilot issue — fix it by asking the interviewer to switch to Webex HD audio.',
        ]}
      />

      <PlatformBlock
        id="phone-call"
        title="Phone / dial-in interview"
        steps={[
          'Pure voice calls (no screen share on the other side) can’t stream through getDisplayMedia directly — the browser needs a tab or window to anchor the capture to.',
          'Workaround: put your phone on speaker next to your laptop, then share the Entire screen in the browser picker with system audio on. The laptop mic will pick up the speaker audio.',
          'Alternatively, use a call-forwarding tool like Google Voice on your laptop and share that tab.',
        ]}
      />

      <section id="browsers" className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
          Browser notes
        </h2>
        <div className="mt-3 grid gap-3 text-sm text-ink-700">
          <Note
            title="Chrome / Edge / Brave / Arc"
            body="Full support. Tab share + Share tab audio is the reliable path. Window share needs Also share system audio."
          />
          <Note
            title="Firefox"
            body="Limited: Firefox’s getDisplayMedia audio support landed in Firefox 116 but only for tab share, and only on Windows + macOS. If audio is silent, switch to a Chromium browser."
          />
          <Note
            title="Safari"
            body="No getDisplayMedia audio support at all as of Safari 17. Use Chrome or Edge for live mode on Mac."
          />
        </div>
      </section>

      <section id="faq" className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
          Common issues
        </h2>
        <div className="mt-3 grid gap-3 text-sm text-ink-700">
          <Note
            title="Transcript stays blank"
            body="99% of the time the share picker didn’t include audio. Stop the session, click Start again, and make sure the audio toggle is ON before clicking Share."
          />
          <Note
            title="My own voice doesn’t show up in transcripts"
            body="Interviewer audio comes from the shared tab / window. Your voice only appears if you enable the mic via the Mic button in the toolbar after the session starts."
          />
          <Note
            title="Browser picker doesn’t offer system-audio"
            body="On Linux and on older Windows 10 builds, system audio capture is unavailable. Use a browser-based meeting (web client) instead of the desktop app."
          />
          <Note
            title="Privacy"
            body="Interview Copilot runs transcription on your audio in real time. We do not record raw audio files to disk — only the text transcript if you opt into persistence on a per-session basis."
          />
        </div>
      </section>

      <section className="mt-10 rounded-xl border border-ink-100 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink-900">Still stuck?</h2>
        <p className="mt-1 text-xs text-ink-500">
          File an issue at{' '}
          <a
            href="https://github.com/anthropics/claude-code/issues"
            className="text-brand-700 hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            the support tracker
          </a>
          , include the browser + OS + which platform you were trying to capture. A short
          screencast of the share dialog helps a lot.
        </p>
        <p className="mt-3 text-xs text-ink-500">
          Want to review an old session while you troubleshoot?{' '}
          <Link href="/app/sessions" className="text-brand-700 hover:underline">
            Go to sessions
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function PlatformBlock({
  id,
  title,
  steps,
}: {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
}) {
  return (
    <section id={id} className="mt-8 rounded-xl border border-ink-100 bg-white p-5">
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      <ol className="mt-3 space-y-2 text-sm text-ink-700">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Note({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="text-xs font-semibold text-ink-900">{title}</div>
      <div className="mt-1 text-xs text-ink-600">{body}</div>
    </div>
  );
}
