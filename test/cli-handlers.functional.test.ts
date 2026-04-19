import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLIHandlers, HandlersDeps } from '../src/cli-handlers';
import * as cliHelpers from '../src/cli-helpers';
import { CLIDeps } from '../src/cli-helpers';
import { CheckResult } from '../src/scanner';

function makeMockDeps(): HandlersDeps {
  const mockScanner = {
    runAllChecks: vi.fn().mockResolvedValue([
      { type: 'ci', status: 'success', message: 'CI passing' }
    ] as CheckResult[]),
    runQuickChecks: vi.fn().mockResolvedValue([]),
  };
  return {
    exit: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    execFile: vi.fn(),
    cwd: vi.fn().mockReturnValue('/test/project'),
    createScanner: vi.fn().mockReturnValue(mockScanner),
    createConfigLoader: vi.fn().mockReturnValue({
      autoDetect: vi.fn().mockReturnValue({
        github: { repo: 'test/repo' },
        checks: { ci: true },
      }),
      getConfig: vi.fn().mockReturnValue({}),
    }),
  };
}

// Helper to build fake history entries
function makeHistory(count: number, checkType: string = 'ci', status: 'success' | 'warning' | 'error' = 'success'): any[] {
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      timestamp: new Date(2024, 0, i + 1).toISOString(),
      results: [
        { type: checkType, status, message: `${checkType} ${status}`, duration: 100 + i * 10 }
      ]
    });
  }
  return entries;
}

// Build history with anomaly-worthy data (one value way off)
function makeAnomalousHistory(): any[] {
  const entries = [];
  for (let i = 0; i < 8; i++) {
    entries.push({
      timestamp: new Date(2024, 0, i + 1).toISOString(),
      results: [
        { type: 'ci', status: 'success' as const, message: 'CI passing', duration: 100, metrics: { flakinessScore: 10 + i } }
      ]
    });
  }
  // Add an anomalous entry (much higher flakiness)
  entries.push({
    timestamp: new Date(2024, 0, 9).toISOString(),
    results: [
      { type: 'ci', status: 'error' as const, message: 'CI flaky', duration: 500, metrics: { flakinessScore: 200 } }
    ]
  });
  return entries;
}

describe('CLIHandlers — Functional Tests', () => {
  let mockDeps: ReturnType<typeof makeMockDeps>;
  let handlers: CLIHandlers;

  beforeEach(() => {
    mockDeps = makeMockDeps();
    handlers = new CLIHandlers(mockDeps);
  });

  // ── handleInitCommand ──

  describe('handleInitCommand', () => {
    it('writes .pulsetel.yml file', () => {
      handlers.handleInitCommand();
      expect(mockDeps.writeFile).toHaveBeenCalledWith('.pulsetel.yml', expect.any(String));
    });

    it('logs generation confirmation', () => {
      handlers.handleInitCommand();
      expect(mockDeps.log).toHaveBeenCalledWith('Generated .pulsetel.yml configuration file');
    });

    it('logs gitignore suggestions', () => {
      handlers.handleInitCommand();
      expect(mockDeps.log).toHaveBeenCalledWith('  .pulsetel-history/');
      expect(mockDeps.log).toHaveBeenCalledWith('  coverage/');
    });

    it('writes YAML content with checks config', () => {
      handlers.handleInitCommand();
      const writtenContent = mockDeps.writeFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain('checks');
    });
  });

  // ── handleHistoryCommand ──

  describe('handleHistoryCommand', () => {
    it('shows message when no history', () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue([]);

      handlers.handleHistoryCommand({ json: false });
      expect(mockDeps.log).toHaveBeenCalledWith('No history available. Run `pulsetel check` first.');
    });

    it('shows history entries in text mode', () => {
      const history = makeHistory(3);
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(history);

      handlers.handleHistoryCommand({ json: false, limit: '10' });
      expect(mockDeps.log).toHaveBeenCalledWith('PULSETEL HISTORY\n');
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Showing last 3 runs'));
    });

    it('respects limit option', () => {
      const history = makeHistory(10);
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(history);

      handlers.handleHistoryCommand({ json: false, limit: '3' });
      // Should only show 3 runs (6 log calls: header + 3 entries × 2 calls each approximately)
      const showingCall = mockDeps.log.mock.calls.find((c: any) => c[0]?.includes?.('Showing last 3 runs'));
      expect(showingCall).toBeDefined();
    });

    it('outputs JSON when json flag is set', () => {
      const history = makeHistory(2);
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(history);

      handlers.handleHistoryCommand({ json: true, limit: '10' });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.history).toHaveLength(2);
    });
  });

  // ── handleTrendsCommand ──

  describe('handleTrendsCommand', () => {
    it('shows insufficient data when history is empty', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue([]);

      await handlers.handleTrendsCommand({ json: false });
      expect(mockDeps.log).toHaveBeenCalledWith('📊 Insufficient data - need at least 3 data points for trend analysis');
    });

    it('shows insufficient data when history has < 3 entries', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(2));

      await handlers.handleTrendsCommand({ json: false });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Insufficient data for trend analysis'));
    });

    it('outputs JSON trends for all check types', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(5));

      await handlers.handleTrendsCommand({ json: true });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.trends).toBeDefined();
    });

    it('outputs JSON trend for specific check type', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(5));

      await handlers.handleTrendsCommand({ json: true, type: 'ci' });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.check_type).toBe('ci');
      expect(parsed.trend).toBeDefined();
    });

    it('outputs text trends when not JSON mode', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(5));

      await handlers.handleTrendsCommand({ json: false });
      // Should print TREND ANALYSIS header
      expect(mockDeps.log).toHaveBeenCalledWith('TREND ANALYSIS');
    });

    it('respects window option', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(10));

      await handlers.handleTrendsCommand({ json: true, window: '3' });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
    });
  });

  // ── handleAnomaliesCommand ──

  describe('handleAnomaliesCommand', () => {
    it('shows insufficient data when history is empty', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue([]);

      await handlers.handleAnomaliesCommand({ json: false });
      expect(mockDeps.log).toHaveBeenCalledWith('📊 Insufficient data - need at least 3 data points for anomaly detection');
    });

    it('shows insufficient data when history has < 5 entries', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(4));

      await handlers.handleAnomaliesCommand({ json: false });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('need at least 5 data points'));
    });

    it('outputs no anomalies when data is stable', async () => {
      // All same values — no anomalies
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeHistory(6));

      await handlers.handleAnomaliesCommand({ json: false });
      expect(mockDeps.log).toHaveBeenCalledWith('✅ No anomalies detected');
    });

    it('outputs JSON anomalies', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeAnomalousHistory());

      await handlers.handleAnomaliesCommand({ json: true });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(Array.isArray(parsed.anomalies)).toBe(true);
    });

    it('outputs text anomalies when detected', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(makeAnomalousHistory());

      await handlers.handleAnomaliesCommand({ json: false });
      // Should print header if anomalies found, or "No anomalies" if not
      const logCalls = mockDeps.log.mock.calls.map((c: any) => c[0]);
      const hasHeader = logCalls.some((c: string) => c.includes('DETECTED ANOMALIES'));
      const hasNoAnomalies = logCalls.some((c: string) => c.includes('No anomalies detected'));
      expect(hasHeader || hasNoAnomalies).toBe(true);
    });
  });

  // ── handleBadgeCommand ──

  describe('handleBadgeCommand', () => {
    it('outputs passing badge when all checks succeed', async () => {
      await handlers.handleBadgeCommand('/test', { json: false });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('brightgreen'));
    });

    it('outputs failing badge when checks have errors', async () => {
      (mockDeps.createScanner!.mockReturnValue({
        runAllChecks: vi.fn().mockResolvedValue([
          { type: 'ci', status: 'error', message: 'CI failed' }
        ])
      }));
      const h = new CLIHandlers(mockDeps);
      await h.handleBadgeCommand('/test', { json: false });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('red'));
    });

    it('outputs JSON badge data', async () => {
      await handlers.handleBadgeCommand('/test', { json: true });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.status).toBeDefined();
      expect(parsed.markdown).toBeDefined();
    });
  });

  // ── handleReportCommand ──

  describe('handleReportCommand', () => {
    it('outputs markdown report', async () => {
      await handlers.handleReportCommand('/test', { format: 'markdown' });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('# PulseTel Project Health Report'));
    });

    it('includes summary table in markdown', async () => {
      await handlers.handleReportCommand('/test', { format: 'markdown' });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('## Summary'));
    });

    it('outputs text report when format is not markdown', async () => {
      await handlers.handleReportCommand('/test', { format: 'text' });
      // Falls through to Reporter.format()
      expect(mockDeps.log).toHaveBeenCalled();
    });

    it('handles error results in markdown report', async () => {
      (mockDeps.createScanner!.mockReturnValue({
        runAllChecks: vi.fn().mockResolvedValue([
          { type: 'ci', status: 'error', message: 'CI failed', details: { runCount: 10 } },
          { type: 'deps', status: 'warning', message: 'Outdated', details: { outdated: 3 } },
          { type: 'git', status: 'success', message: 'Clean' }
        ])
      }));
      const h = new CLIHandlers(mockDeps);
      await h.handleReportCommand('/test', { format: 'markdown' });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Critical Issues'));
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Warnings'));
    });
  });

  // ── handleStatusCommand ──

  describe('handleStatusCommand', () => {
    it('shows no history message in text mode', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue([]);

      await handlers.handleStatusCommand(undefined, { json: false });
      expect(mockDeps.log).toHaveBeenCalledWith('No status history found. Run `pulsetel check` first to establish a baseline.');
    });

    it('shows no history in JSON mode with healthy null', async () => {
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue([]);

      await handlers.handleStatusCommand(undefined, { json: true });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.healthy).toBeNull();
    });

    it('shows healthy status when latest run has no errors', async () => {
      const history = makeHistory(3, 'ci', 'success');
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(history);

      await handlers.handleStatusCommand(undefined, { json: false });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Healthy'));
    });

    it('shows unhealthy status when latest run has errors', async () => {
      const history = [
        { timestamp: '2024-01-03T00:00:00Z', results: [{ type: 'ci', status: 'error', message: 'CI failed' }] },
        { timestamp: '2024-01-02T00:00:00Z', results: [{ type: 'ci', status: 'success', message: 'CI passing' }] },
      ];
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(history);

      await handlers.handleStatusCommand(undefined, { json: false });
      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Unhealthy'));
    });

    it('outputs JSON status with health data', async () => {
      const history = makeHistory(3, 'ci', 'success');
      vi.spyOn(cliHelpers, 'loadHistory').mockReturnValue(history);

      await handlers.handleStatusCommand(undefined, { json: true });
      const jsonCall = mockDeps.log.mock.calls.find((c: any) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.healthy).toBe(true);
      expect(parsed.critical).toBe(0);
    });
  });

  // ── handleCheckCommand (via helper spies) ──

  describe('handleCheckCommand', () => {
    it('calls runSingleRepoCheck and formats output', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        results: [{ type: 'ci', status: 'success', message: 'CI passing' }],
        duration: 500,
        config: {},
        workingDir: '/test'
      });
      vi.spyOn(cliHelpers, 'runSingleRepoCheck').mockImplementation(mockRun);
      vi.spyOn(cliHelpers, 'formatCheckOutput').mockImplementation(() => {});
      vi.spyOn(cliHelpers, 'handleHistory').mockImplementation(() => {});
      vi.spyOn(cliHelpers, 'handleComparison').mockImplementation(() => {});
      vi.spyOn(cliHelpers, 'handleCheckExitCodes').mockImplementation(() => {});

      await handlers.handleCheckCommand('/test', { json: true });
      expect(mockRun).toHaveBeenCalledWith('/test', { json: true });
    });

    it('handles multi-repo mode', async () => {
      const mockMulti = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(cliHelpers, 'handleMultiRepoCheck').mockImplementation(mockMulti);

      await handlers.handleCheckCommand(undefined, { repos: 'org/repo1,org/repo2', json: false });
      expect(mockMulti).toHaveBeenCalledWith('org/repo1,org/repo2', { repos: 'org/repo1,org/repo2', json: false }, mockDeps);
    });
  });

  // ── handleFixCommand ──

  describe('handleFixCommand', () => {
    it('calls fix helpers and skips exit codes in JSON mode', async () => {
      vi.spyOn(cliHelpers, 'runFixCommand').mockResolvedValue({
        results: [{ target: 'deps', status: 'success', success: true, message: 'Fixed' }],
        duration: 1000
      });
      vi.spyOn(cliHelpers, 'formatFixOutput').mockImplementation(() => {});
      vi.spyOn(cliHelpers, 'handleFixExitCodes').mockImplementation(() => {});

      await handlers.handleFixCommand('/test', { json: true, deps: true });
      expect(cliHelpers.formatFixOutput).toHaveBeenCalled();
      expect(cliHelpers.handleFixExitCodes).not.toHaveBeenCalled();
    });

    it('calls exit codes when not JSON mode', async () => {
      vi.spyOn(cliHelpers, 'runFixCommand').mockResolvedValue({
        results: [{ target: 'deps', status: 'failed', success: false, message: 'Failed' }],
        duration: 500
      });
      vi.spyOn(cliHelpers, 'formatFixOutput').mockImplementation(() => {});
      vi.spyOn(cliHelpers, 'handleFixExitCodes').mockImplementation(() => {});

      await handlers.handleFixCommand('/test', { json: false, deps: true });
      expect(cliHelpers.handleFixExitCodes).toHaveBeenCalled();
    });
  });

  // ── handleQuickCommand ──

  describe('handleQuickCommand', () => {
    it('calls quick check helpers', async () => {
      vi.spyOn(cliHelpers, 'runQuickCheck').mockResolvedValue({
        results: [{ type: 'ci', status: 'success', message: 'CI passing' }],
        duration: 200
      });
      vi.spyOn(cliHelpers, 'formatQuickOutput').mockImplementation(() => {});
      vi.spyOn(cliHelpers, 'handleQuickExitCodes').mockImplementation(() => {});

      await handlers.handleQuickCommand('/test', { json: true });
      expect(cliHelpers.runQuickCheck).toHaveBeenCalled();
      expect(cliHelpers.formatQuickOutput).toHaveBeenCalled();
    });
  });
});