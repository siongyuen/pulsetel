import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner, Check, CheckEntry, ScannerDeps, defaultCheckEntries } from '../src/scanner';
import { CheckResult } from '../src/scanner';

function mockCheck(type: string, status: 'success' | 'warning' | 'error', message: string): CheckEntry {
  return {
    type,
    factory: () => ({
      run: vi.fn().mockResolvedValue({ type, status, message }),
    }),
    retryable: false,
    configKey: type,
  };
}

describe('Scanner', () => {
  let mockDeps: Partial<ScannerDeps>;

  beforeEach(() => {
    mockDeps = {
      checks: [
        mockCheck('ci', 'warning', 'No GitHub token'),
        mockCheck('deploy', 'warning', 'No GitHub token'),
        mockCheck('health', 'warning', 'No endpoints'),
        mockCheck('git', 'success', 'Git ok'),
        mockCheck('issues', 'warning', 'No GitHub token'),
        mockCheck('prs', 'warning', 'No GitHub token'),
        mockCheck('coverage', 'warning', 'No coverage'),
        mockCheck('deps', 'success', 'Deps ok'),
      ],
      otel: {
        init: vi.fn().mockReturnValue(false),
        withSpan: vi.fn((_name: string, fn: () => Promise<any>) => fn()),
        exportResults: vi.fn(),
      },
      webhook: {
        notify: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it('runs all enabled checks and returns results with duration', async () => {
    const scanner = new Scanner({}, undefined, mockDeps);
    const results = await scanner.runAllChecks();
    expect(results.length).toBe(8);
    results.forEach(result => {
      expect(['success', 'warning', 'error']).toContain(result.status);
      expect(typeof result.duration).toBe('number');
    });
  });

  it('skips disabled checks', async () => {
    const scanner = new Scanner({ checks: { ci: false, deploy: false } }, undefined, mockDeps);
    const results = await scanner.runAllChecks();
    expect(results.filter(r => r.type === 'ci')).toHaveLength(0);
    expect(results.filter(r => r.type === 'deploy')).toHaveLength(0);
  });

  it('runSingleCheck returns a result for valid type', async () => {
    const scanner = new Scanner({}, undefined, mockDeps);
    const result = await scanner.runSingleCheck('git');
    expect(result.type).toBe('git');
    expect(result.status).toBe('success');
  });

  it('runSingleCheck returns error for invalid type', async () => {
    const scanner = new Scanner({}, undefined, mockDeps);
    const result = await scanner.runSingleCheck('nonexistent');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Unknown check type');
  });

  it('runSingleCheck returns warning when check is disabled', async () => {
    const scanner = new Scanner({ checks: { ci: false } }, undefined, mockDeps);
    const result = await scanner.runSingleCheck('ci');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('disabled');
  });

  it('runQuickChecks skips deps and coverage', async () => {
    const scanner = new Scanner({}, undefined, mockDeps);
    const results = await scanner.runQuickChecks();
    // 6 quick checks + 2 skipped placeholders
    expect(results.length).toBe(8);
    const skipped = results.filter(r => r.message.includes('skipped in quick mode'));
    expect(skipped.length).toBe(2);
    expect(skipped.map(r => r.type).sort()).toEqual(['coverage', 'deps']);
  });

  it('fires webhook notifications non-blocking', async () => {
    const scanner = new Scanner({}, undefined, mockDeps);
    await scanner.runAllChecks();
    expect(mockDeps.webhook!.notify).toHaveBeenCalled();
  });

  it('uses configurable timeout from config when provided', async () => {
    const slowCheck = {
      type: 'slow',
      factory: () => ({
        run: vi.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(() => resolve({ 
            type: 'slow', 
            status: 'success', 
            message: 'ok' 
          }), 100))
        ),
      }),
      retryable: false,
      configKey: 'slow',
    };

    mockDeps.checks = [slowCheck];
    
    // Config timeout is 50ms, but check takes 100ms → should timeout
    const scanner = new Scanner({ 
      checks: { 
        timeouts: { slow: 50 } 
      } 
    }, undefined, mockDeps);
    
    const result = await scanner.runSingleCheck('slow');
    expect(result.status).toBe('error');
    expect(result.message).toContain('timed out');
  });

  it('does not call OTel exportResults when OTel is disabled', async () => {
    (mockDeps.otel!.init as any).mockReturnValue(false);
    const scanner = new Scanner({}, undefined, mockDeps);
    await scanner.runAllChecks();
    expect(mockDeps.otel!.exportResults).not.toHaveBeenCalled();
  });

  it('handles check factory errors gracefully', async () => {
    const brokenCheck: CheckEntry = {
      type: 'broken',
      factory: () => ({
        run: vi.fn().mockRejectedValue(new Error('Something broke')),
      }),
      retryable: false,
      configKey: 'broken',
    };
    mockDeps.checks = [brokenCheck];

    const scanner = new Scanner({}, undefined, mockDeps);
    const results = await scanner.runAllChecks();
    expect(results.length).toBe(1);
    expect(results[0].status).toBe('error');
  });

  it('uses defaultCheckEntries when no custom checks provided', () => {
    // Smoke test — default entries should map to all 9 check types
    expect(defaultCheckEntries.length).toBe(9);
    expect(defaultCheckEntries.map(e => e.type).sort()).toEqual(
      ['ci', 'coverage', 'deploy', 'deps', 'git', 'health', 'issues', 'prs', 'sentry']
    );
  });

  it('coverage config uses nested enabled flag', async () => {
    const scanner = new Scanner({ checks: { coverage: { enabled: false } } }, undefined, mockDeps);
    const results = await scanner.runAllChecks();
    expect(results.filter(r => r.type === 'coverage')).toHaveLength(0);
  });
});