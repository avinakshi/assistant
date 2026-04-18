import React from 'react';
import ReactDOM from 'react-dom/client';
import '../globals.css';

function SettingsApp() {
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-overlay-border px-6 py-4">
        <h1 className="text-base font-semibold">Settings</h1>
        <p className="mt-1 text-xs text-overlay-dim">
          Configuration lands in later phases. Phase 2 ships this window as a stub so we can
          verify multi-window + tray navigation works.
        </p>
      </header>
      <nav className="flex gap-3 border-b border-overlay-border px-6 py-3 text-sm text-overlay-dim">
        {['Account', 'General', 'Overlay', 'Audio', 'Hotkeys', 'Data &amp; Privacy'].map((tab) => (
          <span
            key={tab}
            className="cursor-not-allowed rounded px-2 py-1 opacity-50"
            title="Coming in Phase 6/7"
            dangerouslySetInnerHTML={{ __html: tab }}
          />
        ))}
      </nav>
      <main className="flex-1 overflow-auto px-6 py-6 text-sm text-overlay-dim">
        <p>No settings to configure yet.</p>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <SettingsApp />
    </React.StrictMode>,
  );
}
