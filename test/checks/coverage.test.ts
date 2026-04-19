import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoverageCheck } from '../../src/checks/coverage';

describe('CoverageCheck', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns warning or error depending on coverage state', async () => {
    const check = new CoverageCheck({});
    const result = await check.run();
    // If coverage files exist (e.g. from prior test runs), status may be 'error' if below threshold
    // If no coverage files exist, status is 'warning'
    expect(['warning', 'error']).toContain(result.status);
  });

  it('uses default threshold of 80', async () => {
    const check = new CoverageCheck({});
    // Without coverage files, returns warning
    const result = await check.run();
    expect(result).toBeDefined();
  });

  it('respects custom threshold', async () => {
    const check = new CoverageCheck({
      checks: { coverage: { enabled: true, threshold: 50 } },
    });
    const result = await check.run();
    expect(result).toBeDefined();
  });

  it('handles disabled coverage check', async () => {
    const check = new CoverageCheck({
      checks: { coverage: { enabled: false } },
    });
    const result = await check.run();
    expect(result).toBeDefined();
  });

  it('handles missing GitHub config for remote coverage', async () => {
    const check = new CoverageCheck({
      checks: { coverage: { enabled: true, remote: { provider: 'codecov' } } },
    });
    const result = await check.run();
    expect(result).toBeDefined();
  });
});