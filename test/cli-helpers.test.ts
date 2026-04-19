import { describe, it, expect } from 'vitest';
import {
  mapToSchemaResult,
  extractMetricsFromResult,
  formatTimeAgo,
  compareWithPrevious,
  getTrendIcon,
  computeMultiRepoSummary
} from '../src/cli-helpers';
import { CheckResult } from '../src/scanner';

describe('cli-helpers', () => {
  // ── mapToSchemaResult ──

  describe('mapToSchemaResult', () => {
    const makeResult = (type: string, status: string, details?: any): CheckResult => ({
      type,
      status,
      message: `${type} ${status}`,
      details: details || {},
      duration: 100
    } as CheckResult);

    it('maps error status to critical severity', () => {
      const result = mapToSchemaResult(makeResult('ci', 'error'));
      expect(result.severity).toBe('critical');
    });

    it('maps warning status to medium severity', () => {
      const result = mapToSchemaResult(makeResult('ci', 'warning'));
      expect(result.severity).toBe('medium');
    });

    it('maps success status to low severity', () => {
      const result = mapToSchemaResult(makeResult('ci', 'success'));
      expect(result.severity).toBe('low');
    });

    it('includes check type in result', () => {
      const result = mapToSchemaResult(makeResult('deps', 'error'));
      expect(result.check).toBe('deps');
    });

    it('includes actionable and context for deps error', () => {
      const result = mapToSchemaResult(makeResult('deps', 'error'));
      expect(result.actionable).toContain('npm audit fix');
      expect(result.context).toBeTruthy();
    });

    it('includes actionable and context for CI warning', () => {
      const result = mapToSchemaResult(makeResult('ci', 'warning'));
      expect(result.actionable).toContain('flakiness');
    });

    it('handles all check types with error status', () => {
      ['deps', 'ci', 'git', 'issues', 'prs', 'coverage', 'health', 'deploy'].forEach(type => {
        const result = mapToSchemaResult(makeResult(type, 'error'));
        expect(result.actionable).toBeTruthy();
        expect(result.context).toBeTruthy();
        expect(result.severity).toBe('critical');
      });
    });

    it('handles all check types with success status', () => {
      ['deps', 'ci', 'git', 'issues', 'prs', 'coverage', 'health', 'deploy'].forEach(type => {
        const result = mapToSchemaResult(makeResult(type, 'success'));
        expect(result.actionable).toContain('No action needed');
        expect(result.severity).toBe('low');
      });
    });

    it('handles unknown check type', () => {
      const result = mapToSchemaResult(makeResult('custom', 'error'));
      expect(result.actionable).toContain('Investigate');
    });

    it('preserves duration', () => {
      const result = mapToSchemaResult(makeResult('ci', 'success'));
      expect(result.duration).toBe(100);
    });

    it('sets confidence to high by default', () => {
      const result = mapToSchemaResult(makeResult('ci', 'success'));
      expect(result.confidence).toBe('high');
    });
  });

  // ── extractMetricsFromResult ──

  describe('extractMetricsFromResult', () => {
    it('extracts CI metrics', () => {
      const result = extractMetricsFromResult({
        type: 'ci',
        details: { runCount: 10, failCount: 2, flakinessScore: 20 }
      } as CheckResult);
      expect(result.runCount).toBe(10);
      expect(result.failCount).toBe(2);
      expect(result.flakinessScore).toBe(20);
    });

    it('extracts deps metrics', () => {
      const result = extractMetricsFromResult({
        type: 'deps',
        details: { outdated: 5, vulnerable: 2, total: 50 }
      } as CheckResult);
      expect(result.outdated).toBe(5);
      expect(result.vulnerable).toBe(2);
      expect(result.total).toBe(50);
    });

    it('extracts issues metrics', () => {
      const result = extractMetricsFromResult({
        type: 'issues',
        details: { open: 15, closed: 30 }
      } as CheckResult);
      expect(result.open).toBe(15);
      expect(result.closed).toBe(30);
    });

    it('extracts coverage percentage', () => {
      const result = extractMetricsFromResult({
        type: 'coverage',
        details: { percentage: 78.5 }
      } as CheckResult);
      expect(result.percentage).toBe(78.5);
    });

    it('extracts health endpoint metrics from array details', () => {
      const result = extractMetricsFromResult({
        type: 'health',
        details: [{ url: 'https://api.example.com', responseTime: 150, status: 'ok' }]
      } as CheckResult);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0].latency).toBe(150);
    });

    it('extracts git metrics', () => {
      const result = extractMetricsFromResult({
        type: 'git',
        details: { uncommitted: 3 }
      } as CheckResult);
      expect(result.uncommitted).toBe(3);
    });

    it('extracts PRs metrics', () => {
      const result = extractMetricsFromResult({
        type: 'prs',
        details: { open: 5, needsReview: 2 }
      } as CheckResult);
      expect(result.open).toBe(5);
      expect(result.needsReview).toBe(2);
    });

    it('returns empty object for no details', () => {
      const result = extractMetricsFromResult({
        type: 'ci'
      } as CheckResult);
      expect(result).toEqual({});
    });
  });

  // ── formatTimeAgo ──

  describe('formatTimeAgo', () => {
    it('returns seconds ago for recent timestamps', () => {
      const now = new Date();
      const result = formatTimeAgo(now.toISOString());
      expect(result).toContain('s ago');
    });

    it('returns minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = formatTimeAgo(fiveMinAgo.toISOString());
      expect(result).toContain('m ago');
    });

    it('returns hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const result = formatTimeAgo(twoHoursAgo.toISOString());
      expect(result).toContain('h ago');
    });

    it('returns days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(threeDaysAgo.toISOString());
      expect(result).toContain('d ago');
    });
  });

  // ── getTrendIcon ──

  describe('getTrendIcon', () => {
    it('returns up arrow for improvement', () => {
      expect(getTrendIcon('error', 'success')).toBe('↑');
    });

    it('returns down arrow for degradation', () => {
      expect(getTrendIcon('success', 'error')).toBe('↓');
    });

    it('returns right arrow for no change', () => {
      expect(getTrendIcon('success', 'success')).toBe('→');
    });

    it('returns up arrow for error to warning', () => {
      expect(getTrendIcon('error', 'warning')).toBe('↑');
    });

    it('returns down arrow for warning to error', () => {
      expect(getTrendIcon('warning', 'error')).toBe('↓');
    });
  });

  // ── computeMultiRepoSummary ──

  describe('computeMultiRepoSummary', () => {
    it('returns healthy for all healthy repos', () => {
      const results = [
        { repo: 'repo1', results: [{ status: 'success' } as CheckResult] },
        { repo: 'repo2', results: [{ status: 'success' } as CheckResult] }
      ];
      const summary = computeMultiRepoSummary(results);
      expect(summary.overallStatus).toBe('healthy');
      expect(summary.reposWithErrors).toBe(0);
    });

    it('returns critical for repos with errors', () => {
      const results = [
        { repo: 'repo1', results: [{ status: 'error' } as CheckResult] },
        { repo: 'repo2', results: [{ status: 'success' } as CheckResult] }
      ];
      const summary = computeMultiRepoSummary(results);
      expect(summary.overallStatus).toBe('critical');
      expect(summary.reposWithErrors).toBe(1);
    });

    it('returns degraded for repos with only warnings', () => {
      const results = [
        { repo: 'repo1', results: [{ status: 'warning' } as CheckResult] },
        { repo: 'repo2', results: [{ status: 'success' } as CheckResult] }
      ];
      const summary = computeMultiRepoSummary(results);
      expect(summary.overallStatus).toBe('degraded');
      expect(summary.reposWithWarnings).toBe(1);
    });

    it('counts repos with errors field as error repos', () => {
      const results = [
        { repo: 'repo1', results: [], error: 'Connection failed' }
      ];
      const summary = computeMultiRepoSummary(results);
      expect(summary.reposWithErrors).toBe(1);
    });

    it('aggregates total counts correctly', () => {
      const results = [
        { repo: 'repo1', results: [{ status: 'error' } as CheckResult, { status: 'warning' } as CheckResult] },
        { repo: 'repo2', results: [{ status: 'success' } as CheckResult] }
      ];
      const summary = computeMultiRepoSummary(results);
      expect(summary.totalCritical).toBe(1);
      expect(summary.totalWarnings).toBe(1);
      expect(summary.totalHealthy).toBe(1);
    });
  });

  // ── compareWithPrevious ──

  describe('compareWithPrevious', () => {
    it('returns no comparison message when no history', () => {
      const result = compareWithPrevious([], []);
      expect(result).toContain('No previous runs');
    });

    it('detects status changes', () => {
      const current = [{ type: 'ci', status: 'error', message: 'broken' } as CheckResult];
      const history = [{
        timestamp: new Date().toISOString(),
        results: [{ type: 'ci', status: 'success', message: 'ok' }]
      }] as any;
      const result = compareWithPrevious(current, history);
      expect(result).toContain('ci');
      expect(result).toContain('success');
      expect(result).toContain('error');
    });

    it('reports no changes when status is same', () => {
      const current = [{ type: 'ci', status: 'success', message: 'ok' } as CheckResult];
      const history = [{
        timestamp: new Date().toISOString(),
        results: [{ type: 'ci', status: 'success', message: 'ok' }]
      }] as any;
      const result = compareWithPrevious(current, history);
      expect(result).toContain('No significant changes');
    });
  });
});