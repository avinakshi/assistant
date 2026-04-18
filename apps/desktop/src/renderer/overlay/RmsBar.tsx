import { useOverlayStore } from './store';
import { rmsDbToBarLevel } from './rms';
import { cn } from '../lib/cn';

export function RmsBar() {
  const stats = useOverlayStore((s) => s.latestStats);
  const level = rmsDbToBarLevel(stats?.rmsDb ?? -Infinity);
  const fps = stats?.framesPerSecond ?? 0;
  const hot = fps > 45;

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-overlay-dim">
        <span>system audio</span>
        <span className={cn('font-mono', hot ? 'text-overlay-accent' : 'text-overlay-dim')}>
          {fps.toFixed(0)} fps
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-overlay-accent/70 to-overlay-accent transition-[width] duration-75"
          style={{ width: `${(level * 100).toFixed(1)}%` }}
          data-testid="rms-fill"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-overlay-dim">
        <span>{stats ? `${stats.rmsDb.toFixed(1)} dBFS` : 'no signal'}</span>
        <span>frames {stats?.framesReceived ?? 0}</span>
      </div>
    </div>
  );
}
