/**
 * Pure-logic helper functions extracted from index.ts for testability.
 * These have no side effects (no console.log, no process.exit, no fs writes).
 */

import { CheckResult } from './scanner';
import { HistoryEntry } from './trends';
import { VERSION } from './version';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

export interface FixResult {
  target: string;
  status: 'success' | 'partial' | 'failed';
  success: boolean;
  partial?: boolean;
  message: string;
  changes?: string[];
  dryRun?: boolean;
  details?: any;
}

// ── Schema mapping ──

export function mapToSchemaResult(result: CheckResult): any {
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  switch (result.status) {
    case 'error':
      severity = 'critical';
      break;
    case 'warning':
      severity = 'medium';
      break;
    case 'success':
      severity = 'low';
      break;
  }

  let actionable = '';
  let context = '';

  switch (result.type) {
    case 'deps':
      if (result.status === 'error') {
        actionable = 'Run npm audit fix to address critical vulnerabilities';
        context = 'Vulnerable dependencies pose security risks';
      } else if (result.status === 'warning') {
        actionable = 'Update outdated packages and review vulnerabilities';
        context = 'Outdated or vulnerable dependencies are security and stability risks';
      } else {
        actionable = 'No action needed - dependencies are up to date';
        context = 'All dependencies are current and secure';
      }
      break;
    case 'ci':
      if (result.status === 'error') {
        actionable = 'Investigate CI failures and flaky tests';
        context = 'CI failures block deployments and indicate quality issues';
      } else if (result.status === 'warning') {
        actionable = 'Review CI flakiness and test stability';
        context = 'Flaky tests reduce confidence in CI results';
      } else {
        actionable = 'No action needed - CI is healthy';
        context = 'CI pipeline is running successfully';
      }
      break;
    case 'git':
      if (result.status === 'error') {
        actionable = 'Commit changes and push to remote';
        context = 'Uncommitted changes may be lost';
      } else if (result.status === 'warning') {
        actionable = 'Review branch status and uncommitted changes';
        context = 'Branch divergence may indicate outdated local state';
      } else {
        actionable = 'No action needed - Git status is clean';
        context = 'Repository is in sync with remote';
      }
      break;
    case 'issues':
      if (result.status === 'error') {
        actionable = 'Address critical open issues';
        context = 'Open issues indicate unresolved problems';
      } else if (result.status === 'warning') {
        actionable = 'Review and prioritize open issues';
        context = 'Open issues should be managed and prioritized';
      } else {
        actionable = 'No action needed - no critical issues';
        context = 'Issue backlog is under control';
      }
      break;
    case 'prs':
      if (result.status === 'error') {
        actionable = 'Review and merge pending pull requests';
        context = 'Stale pull requests block progress';
      } else if (result.status === 'warning') {
        actionable = 'Review pull requests needing attention';
        context = 'Pull requests require code review and feedback';
      } else {
        actionable = 'No action needed - pull requests are up to date';
        context = 'Pull request workflow is healthy';
      }
      break;
    case 'coverage':
      if (result.status === 'error') {
        actionable = 'Improve test coverage to meet threshold';
        context = 'Low test coverage increases risk of bugs';
      } else if (result.status === 'warning') {
        actionable = 'Review test coverage and add missing tests';
        context = 'Test coverage helps prevent regressions';
      } else {
        actionable = 'No action needed - coverage meets requirements';
        context = 'Test coverage is at acceptable levels';
      }
      break;
    case 'health':
      if (result.status === 'error') {
        actionable = 'Investigate endpoint failures and performance issues';
        context = 'Endpoint failures indicate service problems';
      } else if (result.status === 'warning') {
        actionable = 'Monitor endpoint performance and latency';
        context = 'Endpoint latency may affect user experience';
      } else {
        actionable = 'No action needed - endpoints are healthy';
        context = 'All endpoints are responding normally';
      }
      break;
    case 'deploy':
      if (result.status === 'error') {
        actionable = 'Investigate deployment failures';
        context = 'Deployment failures prevent updates from reaching users';
      } else if (result.status === 'warning') {
        actionable = 'Review deployment status and logs';
        context = 'Deployment issues may affect service availability';
      } else {
        actionable = 'No action needed - deployments are successful';
        context = 'Deployments are working correctly';
      }
      break;
    default:
      actionable = result.status === 'error' ? 'Investigate and resolve issues' : 'No action needed';
      context = result.message;
  }

  return {
    check: result.type,
    status: result.status,
    severity: severity,
    confidence: 'high',
    actionable: actionable,
    context: context,
    message: result.message,
    details: result.details,
    duration: result.duration
  };
}

// ── Metrics extraction ──

export function extractMetricsFromResult(result: CheckResult): any {
  const metrics: any = {};
  if (!result.details) return metrics;

  switch (result.type) {
    case 'ci':
      if (result.details.runCount !== undefined) metrics.runCount = result.details.runCount;
      if (result.details.failCount !== undefined) metrics.failCount = result.details.failCount;
      if (result.details.flakinessScore !== undefined) metrics.flakinessScore = result.details.flakinessScore;
      break;
    case 'deps':
      if (result.details.outdated !== undefined) metrics.outdated = result.details.outdated;
      if (result.details.vulnerable !== undefined) metrics.vulnerable = result.details.vulnerable;
      if (result.details.total !== undefined) metrics.total = result.details.total;
      break;
    case 'issues':
      if (result.details.open !== undefined) metrics.open = result.details.open;
      if (result.details.closed !== undefined) metrics.closed = result.details.closed;
      break;
    case 'coverage':
      if (result.details.percentage !== undefined) metrics.percentage = result.details.percentage;
      break;
    case 'health':
      if (Array.isArray(result.details)) {
        metrics.endpoints = result.details.map((ep: any) => ({
          url: ep.url || ep.name,
          latency: ep.responseTime,
          status: ep.status
        }));
      }
      break;
    case 'git':
      if (result.details.uncommitted !== undefined) metrics.uncommitted = result.details.uncommitted;
      break;
    case 'prs':
      if (result.details.open !== undefined) metrics.open = result.details.open;
      if (result.details.needsReview !== undefined) metrics.needsReview = result.details.needsReview;
      break;
  }

  return metrics;
}

// ── Time formatting ──

export function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMin > 0) {
    return `${diffMin}m ago`;
  } else {
    return `${diffSec}s ago`;
  }
}

// ── Comparison ──

export function compareWithPrevious(currentResults: CheckResult[], history?: HistoryEntry[]): string {
  try {
    const historyToUse = history || loadHistory();

    if (historyToUse.length === 0) {
      return 'No previous runs available for comparison';
    }

    historyToUse.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const previousRun = historyToUse[0];

    let comparison = 'COMPARISON WITH PREVIOUS RUN\n';
    comparison += '=============================\n\n';

    const previousMap: Record<string, any> = {};
    previousRun.results.forEach((result: any) => {
      previousMap[result.type] = result;
    });

    let hasChanges = false;

    currentResults.forEach((currentResult: CheckResult) => {
      const previousResult = previousMap[currentResult.type];

      if (previousResult && previousResult.status !== currentResult.status) {
        hasChanges = true;
        const trendIcon = getTrendIcon(previousResult.status, currentResult.status);
        comparison += `${trendIcon} ${currentResult.type}: ${previousResult.status} → ${currentResult.status}\n`;
        comparison += `   Previous: ${previousResult.message}\n`;
        comparison += `   Current:  ${currentResult.message}\n\n`;
      }
    });

    if (!hasChanges) {
      return 'No significant changes detected since previous run';
    }

    return comparison;
  } catch {
    return 'Comparison failed';
  }
}

export function getTrendIcon(previousStatus: string, currentStatus: string): string {
  const statusOrder: Record<string, number> = { 'error': 1, 'warning': 2, 'success': 3 };
  const previousScore = statusOrder[previousStatus] || 0;
  const currentScore = statusOrder[currentStatus] || 0;

  if (currentScore > previousScore) return '↑';
  if (currentScore < previousScore) return '↓';
  return '→';
}

// ── Multi-repo summary ──

export function computeMultiRepoSummary(results: Array<{ repo: string; results: CheckResult[]; error?: string }>): any {
  let reposWithErrors = 0;
  let reposWithWarnings = 0;
  let totalCritical = 0;
  let totalWarnings = 0;
  let totalHealthy = 0;

  for (const result of results) {
    if (result.error) {
      reposWithErrors++;
      continue;
    }

    const critical = result.results.filter(r => r.status === 'error').length;
    const warnings = result.results.filter(r => r.status === 'warning').length;
    const healthy = result.results.filter(r => r.status === 'success').length;

    totalCritical += critical;
    totalWarnings += warnings;
    totalHealthy += healthy;

    if (critical > 0) {
      reposWithErrors++;
    } else if (warnings > 0) {
      reposWithWarnings++;
    }
  }

  const overallStatus = reposWithErrors > 0 ? 'critical' : reposWithWarnings > 0 ? 'degraded' : 'healthy';

  return {
    reposWithErrors,
    reposWithWarnings,
    totalCritical,
    totalWarnings,
    totalHealthy,
    overallStatus
  };
}

// ── History I/O (has side effects but is still useful to test) ──

export function loadHistory(historyDir: string = '.pulselive-history'): HistoryEntry[] {
  try {
    if (!existsSync(historyDir)) {
      return [];
    }

    const files = readdirSync(historyDir);
    const history: HistoryEntry[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(historyDir, file);
        const content = readFileSync(filePath, 'utf8');
        history.push(JSON.parse(content));
      }
    }

    return history;
  } catch {
    return [];
  }
}

export function saveHistory(results: CheckResult[]): void {
  try {
    const historyDir = '.pulselive-history';

    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }

    const historyEntry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      pulselive_version: VERSION,
      results: results.map((result: CheckResult) => ({
        type: result.type,
        status: result.status,
        message: result.message,
        duration: result.duration,
        metrics: extractMetricsFromResult(result)
      }))
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(historyDir, `run-${timestamp}.json`);
    writeFileSync(filePath, JSON.stringify(historyEntry, null, 2));
  } catch {
    // Silent fail - history is best-effort
  }
}