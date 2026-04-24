import { describe, it, expect } from 'vitest';
import {
  VALID_TOOLS,
  validateDir,
  getRequiredParamsForTool,
  statusToSeverity,
  enrichResult,
  errorActionable,
  warningActionable,
  trendActionable,
  trendContext,
  anomalyActionable,
  anomalyContext,
  computeSummary,
  computeOverallTrend
} from '../src/mcp-helpers';
import { CheckResult } from '../src/scanner';

describe('mcp-helpers', () => {
  // ── VALID_TOOLS ──

  describe('VALID_TOOLS', () => {
    it('includes all expected MCP tools', () => {
      expect(VALID_TOOLS).toContain('pulsetel_check');
      expect(VALID_TOOLS).toContain('pulsetel_quick');
      expect(VALID_TOOLS).toContain('pulsetel_ci');
      expect(VALID_TOOLS).toContain('pulsetel_health');
      expect(VALID_TOOLS).toContain('pulsetel_deps');
      expect(VALID_TOOLS).toContain('pulsetel_summary');
      expect(VALID_TOOLS).toContain('pulsetel_trends');
      expect(VALID_TOOLS).toContain('pulsetel_correlate');
      expect(VALID_TOOLS).toContain('pulsetel_gate');
      expect(VALID_TOOLS).toContain('pulsetel_anomalies');
      expect(VALID_TOOLS).toContain('pulsetel_metrics');
      expect(VALID_TOOLS).toContain('pulsetel_status');
    });

    it('has 13 tools total', () => {
      expect(VALID_TOOLS).toHaveLength(13);
    });
  });

  // ── validateDir ──

  describe('validateDir', () => {
    it('blocks null bytes', () => {
      expect(() => validateDir('/home/user\0/etc')).toThrow('null bytes not allowed');
    });

    it('blocks path traversal with ..', () => {
      expect(() => validateDir('/home/user/../../etc', '/home/user/project')).toThrow('path traversal');
    });

    it('allows paths within project root', () => {
      const root = process.cwd();
      expect(validateDir(root, root)).toBe(root);
    });

    it('allows subdirectories within project root', () => {
      const root = process.cwd();
      expect(validateDir(`${root}/src`, root)).toBe(`${root}/src`);
    });

    it('blocks paths that escape project root', () => {
      const root = '/home/user/project';
      expect(() => validateDir('/etc/passwd', root)).toThrow('escapes project root');
    });
  });

  // ── getRequiredParamsForTool ──

  describe('getRequiredParamsForTool', () => {
    it('returns dir for check tool (dir is now optional)', () => {
      expect(getRequiredParamsForTool('pulsetel_check')).toEqual([]);
    });

    it('returns dir for quick tool (dir is now optional)', () => {
      expect(getRequiredParamsForTool('pulsetel_quick')).toEqual([]);
    });

    it('returns empty for trends tool', () => {
      expect(getRequiredParamsForTool('pulsetel_trends')).toEqual([]);
    });

    it('returns empty for anomalies tool', () => {
      expect(getRequiredParamsForTool('pulsetel_anomalies')).toEqual([]);
    });

    it('returns empty for unknown tool', () => {
      expect(getRequiredParamsForTool('unknown_tool')).toEqual([]);
    });

    it('returns empty for all directory-based tools (dir is optional)', () => {
      const dirTools = ['pulsetel_check', 'pulsetel_quick', 'pulsetel_ci', 'pulsetel_health', 'pulsetel_deps', 'pulsetel_summary', 'pulsetel_correlate', 'pulsetel_gate'];
      dirTools.forEach(tool => {
        expect(getRequiredParamsForTool(tool)).toEqual([]);
      });
    });
  });

  // ── statusToSeverity ──

  describe('statusToSeverity', () => {
    it('maps error to critical', () => {
      expect(statusToSeverity('error')).toBe('critical');
    });

    it('maps warning to warning', () => {
      expect(statusToSeverity('warning')).toBe('warning');
    });

    it('maps success to info', () => {
      expect(statusToSeverity('success')).toBe('info');
    });

    it('maps unknown to info', () => {
      expect(statusToSeverity('unknown')).toBe('info');
    });
  });

  // ── enrichResult ──

  describe('enrichResult', () => {
    const makeResult = (type: string, status: string, details?: any): CheckResult => ({
      type,
      status,
      message: `${type} ${status}`,
      details: details || {},
      duration: 100
    } as CheckResult);

    it('adds severity field', () => {
      const result = enrichResult(makeResult('ci', 'error'));
      expect(result.severity).toBe('critical');
    });

    it('adds actionable and context for CI error', () => {
      const result = enrichResult(makeResult('ci', 'error'));
      expect(result.actionable).toContain('CI');
      expect(result.context).toBeTruthy();
    });

    it('adds actionable and context for deps warning', () => {
      const result = enrichResult(makeResult('deps', 'warning'));
      expect(result.actionable).toContain('npm update');
    });

    it('handles CI flakiness score', () => {
      const result = enrichResult(makeResult('ci', 'warning', { flakinessScore: 50 }));
      expect(result.severity).toBe('warning');
      expect(result.confidence).toBe('medium');
    });

    it('handles coverage with percentage details', () => {
      const result = enrichResult(makeResult('coverage', 'warning', { percentage: 65, threshold: 80 }));
      expect(result.actionable).toContain('65');
    });

    it('handles health error', () => {
      const result = enrichResult(makeResult('health', 'error'));
      expect(result.actionable).toContain('down');
    });

    it('handles PRs warning', () => {
      const result = enrichResult(makeResult('prs', 'warning', { needsReview: 5 }));
      expect(result.actionable).toContain('5');
    });

    it('handles deploy error', () => {
      const result = enrichResult(makeResult('deploy', 'error'));
      expect(result.actionable).toContain('Deployment failed');
    });

    it('handles success status for all types', () => {
      ['ci', 'deps', 'issues', 'coverage', 'health', 'git', 'prs', 'deploy'].forEach(type => {
        const result = enrichResult(makeResult(type, 'success'));
        expect(result.severity).toBe('info');
        expect(result.actionable).toBeTruthy();
      });
    });

    it('handles unknown check type', () => {
      const result = enrichResult(makeResult('unknown_type', 'warning'));
      expect(result.actionable).toContain('Review check output');
    });
  });

  // ── errorActionable ──

  describe('errorActionable', () => {
    it('returns CI action for CI error', () => {
      const result = errorActionable({ type: 'ci', message: 'build failed' } as CheckResult);
      expect(result).toContain('CI');
    });

    it('returns deps action for deps error', () => {
      const result = errorActionable({ type: 'deps', message: 'vulnerabilities found' } as CheckResult);
      expect(result).toContain('npm audit fix');
    });

    it('returns health action for health error', () => {
      const result = errorActionable({ type: 'health', message: 'endpoint down' } as CheckResult);
      expect(result).toContain('restart');
    });

    it('returns coverage action for coverage error', () => {
      const result = errorActionable({ type: 'coverage', message: 'low coverage' } as CheckResult);
      expect(result).toContain('add tests');
    });

    it('returns deploy action for deploy error', () => {
      const result = errorActionable({ type: 'deploy', message: 'deploy failed' } as CheckResult);
      expect(result).toContain('rollback');
    });

    it('returns generic action for unknown type', () => {
      const result = errorActionable({ type: 'custom', message: 'something broke' } as CheckResult);
      expect(result).toContain('something broke');
    });
  });

  // ── warningActionable ──

  describe('warningActionable', () => {
    it('returns CI flaky action', () => {
      const result = warningActionable({ type: 'ci', message: 'flaky' } as CheckResult);
      expect(result).toContain('flaky');
    });

    it('returns issues review action', () => {
      const result = warningActionable({ type: 'issues', message: 'open issues' } as CheckResult);
      expect(result).toContain('Review open issues');
    });

    it('returns PRs review action', () => {
      const result = warningActionable({ type: 'prs', message: 'needs review' } as CheckResult);
      expect(result).toContain('review queue');
    });

    it('returns generic action for unknown type', () => {
      const result = warningActionable({ type: 'custom', message: 'check this' } as CheckResult);
      expect(result).toContain('custom');
    });
  });

  // ── trendActionable ──

  describe('trendActionable', () => {
    it('returns degrading action for CI', () => {
      expect(trendActionable('ci', { direction: 'degrading' })).toContain('test stability');
    });

    it('returns degrading action for deps', () => {
      expect(trendActionable('deps', { direction: 'degrading' })).toContain('update cycle');
    });

    it('returns improving action', () => {
      expect(trendActionable('ci', { direction: 'improving' })).toContain('No action needed');
    });

    it('returns stable action', () => {
      expect(trendActionable('ci', { direction: 'stable' })).toContain('no action needed');
    });

    it('returns generic degrading action for unknown type', () => {
      expect(trendActionable('custom', { direction: 'degrading' })).toContain('degrading');
    });
  });

  // ── trendContext ──

  describe('trendContext', () => {
    it('returns CI context', () => {
      expect(trendContext('ci', {})).toContain('merge gating');
    });

    it('returns deps context', () => {
      expect(trendContext('deps', {})).toContain('technical debt');
    });

    it('returns generic context for unknown type', () => {
      expect(trendContext('custom', {})).toContain('health trajectory');
    });
  });

  // ── anomalyActionable ──

  describe('anomalyActionable', () => {
    it('returns CI anomaly action', () => {
      expect(anomalyActionable({ checkType: 'ci', zScore: 3.5 })).toContain('infrastructure changes');
    });

    it('returns deps anomaly action', () => {
      expect(anomalyActionable({ checkType: 'deps', zScore: 2.8 })).toContain('supply chain');
    });

    it('returns generic anomaly action', () => {
      expect(anomalyActionable({ checkType: 'custom', zScore: 4.0 })).toContain('Investigate custom');
    });
  });

  // ── anomalyContext ──

  describe('anomalyContext', () => {
    it('formats numeric values', () => {
      const ctx = anomalyContext({ metric: 'latency', value: 150, zScore: 3.2, mean: 50 });
      expect(ctx).toContain('150.00');
      expect(ctx).toContain('3.2');
    });

    it('handles string values', () => {
      const ctx = anomalyContext({ metric: 'status', value: 'error', zScore: 5.0, mean: 0 });
      expect(ctx).toContain('error');
    });
  });

  // ── computeSummary ──

  describe('computeSummary', () => {
    it('returns healthy when all pass', () => {
      const results = [
        { status: 'success' } as CheckResult,
        { status: 'success' } as CheckResult
      ];
      const summary = computeSummary(results);
      expect(summary.overallStatus).toBe('healthy');
      expect(summary.passing).toBe(2);
      expect(summary.critical).toBe(0);
    });

    it('returns critical when errors exist', () => {
      const results = [
        { status: 'error' } as CheckResult,
        { status: 'success' } as CheckResult
      ];
      const summary = computeSummary(results);
      expect(summary.overallStatus).toBe('critical');
      expect(summary.critical).toBe(1);
    });

    it('returns degraded when only warnings', () => {
      const results = [
        { status: 'warning' } as CheckResult,
        { status: 'success' } as CheckResult
      ];
      const summary = computeSummary(results);
      expect(summary.overallStatus).toBe('degraded');
      expect(summary.warnings).toBe(1);
    });

    it('counts total checks correctly', () => {
      const results = [
        { status: 'success' } as CheckResult,
        { status: 'warning' } as CheckResult,
        { status: 'error' } as CheckResult
      ];
      const summary = computeSummary(results);
      expect(summary.totalChecks).toBe(3);
    });

    it('handles empty results', () => {
      const summary = computeSummary([]);
      expect(summary.overallStatus).toBe('healthy');
      expect(summary.totalChecks).toBe(0);
    });
  });

  // ── computeOverallTrend ──

  describe('computeOverallTrend', () => {
    const makeTrendAnalyzer = (direction: string) => ({
      analyze: () => ({ direction })
    } as any);

    it('returns unknown with insufficient history', () => {
      const result = computeOverallTrend([], [{} as any], makeTrendAnalyzer('stable'));
      expect(result.direction).toBe('unknown');
    });

    it('returns improving when most checks improve', () => {
      const history = [
        { results: [{ type: 'ci' }] } as any,
        { results: [{ type: 'ci' }] } as any
      ];
      const results = [{ type: 'ci' } as CheckResult];
      const analyzer = makeTrendAnalyzer('improving');
      const trend = computeOverallTrend(results, history, analyzer);
      expect(trend.direction).toBe('improving');
    });

    it('returns degrading when most checks degrade', () => {
      const history = [
        { results: [{ type: 'ci' }, { type: 'deps' }] } as any,
        { results: [{ type: 'ci' }, { type: 'deps' }] } as any
      ];
      const results = [{ type: 'ci' } as CheckResult];
      const analyzer = makeTrendAnalyzer('degrading');
      const trend = computeOverallTrend(results, history, analyzer);
      expect(trend.direction).toBe('degrading');
    });

    it('returns stable when improving and degrading are equal', () => {
      const history = [
        { results: [{ type: 'ci' }] } as any,
        { results: [{ type: 'ci' }] } as any
      ];
      const results = [{ type: 'ci' } as CheckResult];
      const analyzer = makeTrendAnalyzer('stable');
      const trend = computeOverallTrend(results, history, analyzer);
      expect(trend.direction).toBe('stable');
    });
  });
});