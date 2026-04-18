// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useOverlayStore } from './store';
import { RmsBar } from './RmsBar';

afterEach(() => {
  cleanup();
  useOverlayStore.setState({ connected: false, latestStats: null });
});

describe('RmsBar', () => {
  it('shows "no signal" before any stats arrive', () => {
    const { getByText } = render(<RmsBar />);
    expect(getByText('no signal')).toBeTruthy();
  });

  it('reflects incoming stats: RMS fill width + fps label', () => {
    useOverlayStore.getState().pushStats({
      framesReceived: 100,
      framesPerSecond: 50,
      rmsDb: -30, // halfway between floor (-60) and ceiling (0) → 50% bar
      windowMs: 1000,
    });
    const { getByTestId, getByText } = render(<RmsBar />);
    const fill = getByTestId('rms-fill') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo(50, 1);
    expect(getByText('50 fps')).toBeTruthy();
    expect(getByText('-30.0 dBFS')).toBeTruthy();
  });

  it('clamps negative-infinity RMS to 0 width', () => {
    useOverlayStore.getState().pushStats({
      framesReceived: 0,
      framesPerSecond: 0,
      rmsDb: -Infinity,
      windowMs: 1000,
    });
    const { getByTestId } = render(<RmsBar />);
    const width = (getByTestId('rms-fill') as HTMLElement).style.width;
    expect(parseFloat(width)).toBe(0);
  });
});

// jsdom helpers for Zustand + React Testing Library.
beforeEach(() => {
  // noop — state is reset in afterEach.
});
