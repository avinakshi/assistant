// Runs a command with the repo's .env merged into process.env. No shell tricks —
// spawns the executable directly with its args so Windows pathing is consistent.
// Usage: node scripts/smoke/run-with-env.cjs <absolute-exe> [...args]
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const env = { ...process.env };
try {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\r$/, '');
  }
} catch (e) {
  console.error('no .env found:', e.message);
}

// Optional --cwd <dir> positional override so scripts that need to be launched from a
// specific workspace directory (e.g. Next dev server) can be. Everything after is the
// command + args.
let cwd = process.cwd();
let rest = process.argv.slice(2);
if (rest[0] === '--cwd') {
  cwd = resolve(rest[1]);
  rest = rest.slice(2);
}
const [cmd, ...args] = rest;
if (!cmd) {
  console.error('usage: node run-with-env.cjs <exe> [...args]');
  process.exit(2);
}
console.error(
  `[run-with-env] cmd=${cmd}\n[run-with-env] WS_SHARED_SECRET len=${(env.WS_SHARED_SECRET || '').length}, DEEPGRAM_API_KEY set=${!!env.DEEPGRAM_API_KEY}, GOOGLE_API_KEY set=${!!env.GOOGLE_API_KEY}`,
);
// On Windows, spawning .CMD requires shell:true (Node 24+ rejects raw EINVAL). We wrap
// in cmd.exe /c explicitly to avoid the shell-true DeprecationWarning.
// Only .CMD/.BAT need the cmd.exe wrap. .exe binaries (electron.exe, node.exe) spawn directly.
const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
const child = useShell
  ? spawn('cmd.exe', ['/s', '/c', [cmd, ...args].map((a) => `"${a}"`).join(' ')], {
      stdio: 'inherit',
      env,
      windowsHide: false,
      cwd,
    })
  : spawn(cmd, args, { stdio: 'inherit', env, windowsHide: false, cwd });
child.on('error', (e) => {
  console.error('spawn failed:', e.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
