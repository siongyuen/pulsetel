/**
 * Pure-logic helper functions extracted from MCPServer for testability.
 * These have no side effects and no dependency on server state.
 */

import { CheckResult } from './scanner';
import { HistoryEntry, TrendAnalyzer } from './trends';

const VALID_TOOLS = [
  'pulsetel_check',
  'pulsetel_quick',
  'pulsetel_ci',
  'pulsetel_health',
  'pulsetel_deps',
  'pulsetel_summary',
  'pulsetel_trends',
  'pulsetel_anomalies',
  'pulsetel_metrics',
  'pulsetel_recommend',
  'pulsetel_status',
  'pulsetel_sentry'
];

export { VALID_TOOLS };

// ── Validation helpers ──

export function validateDir(dir: string, projectRoot: string = process.cwd()): string {
  if (dir.includes('\0')) {
    throw new Error('Invalid directory path - null bytes not allowed');
  }

  const { normalize, resolve } = require('path');
  const normalized = normalize(dir);
  const resolved = resolve(normalized);

  if (dir.includes('..') || normalized.includes('..')) {
    throw new Error('Directory path traversal not allowed');
  }

  if (!resolved.startsWith('/')) {
    throw new Error('Directory must be an absolute path');
  }

  if (!resolved.startsWith(projectRoot + '/') && resolved !== projectRoot) {
    throw new Error(`Directory path escapes project root boundary: ${projectRoot}`);
  }

  return resolved;
}

export function getRequiredParamsForTool(tool: string): string[] {
  const toolParams: Record<string, string[]> = {
    'pulsetel_check': ['dir'],
    'pulsetel_quick': ['dir'],
    'pulsetel_ci': ['dir'],
    'pulsetel_health': ['dir'],
    'pulsetel_deps': ['dir'],
    'pulsetel_summary': ['dir'],
    'pulsetel_recommend': ['dir'],
    'pulsetel_trends': [],
    'pulsetel_anomalies': [],
    'pulsetel_metrics': [],
    'pulsetel_status': [],
    'pulsetel_sentry': []
  };

  return toolParams[tool] || [];
}

// ── Result enrichment ──

export function statusToSeverity(status: string): 'critical' | 'warning' | 'info' {
  if (status === 'error') return 'critical';
  if (status === 'warning') return 'warning';
  return 'info';
}

export function enrichResult(result: CheckResult): any {
  const base: any = {
    type: result.type,
    status: result.status,
    message: result.message,
    details: result.details,
    duration: result.duration,
    severity: statusToSeverity(result.status),
    confidence: 'high' as const,
    actionable: '',
    context: ''
  };

  switch (result.type) {
    case 'ci':
      base.actionable = result.status === 'error'
        ? 'Investigate CI failure — check workflow logs for root cause'
        : result.status === 'warning'
          ? 'CI may be flaky — review recent run history for patterns'
          : 'No action needed';
      base.context = 'CI status gates merges and deployments';
      if (result.details?.flakinessScore > 30) {
        base.severity = 'warning';
        base.confidence = 'medium';
        base.context = `CI flakiness at ${result.details.flakinessScore}% — test results are unreliable for gating merges`;
      }
      break;
    case 'deps':
      base.actionable = result.status === 'error'
        ? 'Run npm audit fix to address vulnerabilities'
        : result.status === 'warning'
          ? `Update ${result.details?.outdated || 'outdated'} packages — run npm update`
          : 'Dependencies are up to date';
      base.context = 'Outdated or vulnerable dependencies are security and stability risks';
      break;
    case 'issues':
      base.actionable = result.status === 'warning'
        ? 'Review open issues — prioritise critical bugs and security reports'
        : 'No action needed';
      base.context = 'Open issues indicate known problems that may affect users';
      break;
    case 'coverage':
      base.actionable = result.status === 'error'
        ? 'Coverage critically low — add tests for core paths before shipping'
        : result.status === 'warning'
          ? `Coverage at ${result.details?.percentage?.toFixed(1) || '?'}% — target ${result.details?.threshold || 80}%`
          : 'Coverage is healthy';
      base.context = 'Low coverage means untested code paths and higher regression risk';
      break;
    case 'health':
      base.actionable = result.status === 'error'
        ? 'Endpoint is down — check service health and logs immediately'
        : result.status === 'warning'
          ? 'Endpoint responding slowly — investigate resource usage or load'
          : 'Endpoints are healthy';
      base.context = 'Endpoint health directly impacts user experience';
      break;
    case 'git':
      base.actionable = 'No action needed';
      base.context = 'Git status tracks uncommitted changes and branch divergence';
      break;
    case 'prs':
      base.actionable = result.status === 'warning'
        ? `${result.details?.needsReview || 'Some'} PRs need review — clear the review queue to unblock merges`
        : 'No action needed';
      base.context = 'Stale PRs slow delivery and increase merge conflict risk';
      break;
    case 'deploy':
      base.actionable = result.status === 'error'
        ? 'Deployment failed — check deployment logs and rollback if needed'
        : 'No action needed';
      base.context = 'Deployment status indicates whether latest code is live';
      break;
    default:
      base.actionable = 'Review check output';
      base.context = '';
  }

  return base;
}

// ── Actionable/Context generators ──

export function errorActionable(r: CheckResult): string {
  const actions: Record<string, string> = {
    ci: 'Check CI workflow logs — resolve build/test failures before merging',
    deps: 'Run npm audit fix — address critical vulnerabilities immediately',
    health: 'Endpoint is down — check service logs and restart if needed',
    coverage: 'Coverage critically low — add tests for core paths before shipping',
    deploy: 'Deployment failed — check logs and rollback if needed'
  };
  return actions[r.type] || `Resolve ${r.type} check failure: ${r.message}`;
}

export function warningActionable(r: CheckResult): string {
  const actions: Record<string, string> = {
    ci: 'CI may be flaky — review recent run history for patterns and fix unstable tests',
    deps: 'Update outdated packages — run npm update && npm audit fix',
    issues: 'Review open issues — prioritise critical bugs and security reports',
    coverage: 'Coverage below threshold — add tests for uncovered paths',
    health: 'Endpoint slow — investigate resource usage or scale up',
    prs: 'Clear PR review queue to unblock merges'
  };
  return actions[r.type] || `Review ${r.type} warning: ${r.message}`;
}

export function trendActionable(checkType: string, trend: any): string {
  if (trend.direction === 'degrading') {
    const actions: Record<string, string> = {
      ci: 'CI degrading — investigate test stability and flakiness trends',
      deps: 'Dependencies accumulating — schedule update cycle',
      issues: 'Issues growing — allocate sprint capacity for bug triage',
      coverage: 'Coverage declining — add tests for new code paths',
      health: 'Latency increasing — investigate resource bottlenecks',
      prs: 'PRs accumulating — increase review capacity'
    };
    return actions[checkType] || `${checkType} trend is degrading — investigate and address`;
  }
  if (trend.direction === 'improving') {
    return `No action needed — ${checkType} trend is improving`;
  }
  return `${checkType} trend is stable — no action needed`;
}

export function trendContext(checkType: string, trend: any): string {
  const contexts: Record<string, string> = {
    ci: 'CI stability is critical for reliable merge gating and deployment confidence',
    deps: 'Dependency drift accumulates technical debt and security exposure over time',
    issues: 'Growing issue count signals unresolved problems affecting users',
    coverage: 'Coverage trends predict regression risk — declining coverage = higher risk',
    health: 'Latency trends indicate infrastructure health and user experience',
    prs: 'PR accumulation slows delivery velocity and increases conflict risk'
  };
  return contexts[checkType] || `Trend direction for ${checkType} indicates overall health trajectory`;
}

export function anomalyActionable(anomaly: any): string {
  const actions: Record<string, string> = {
    ci: 'CI anomaly — check for infrastructure changes, flaky tests, or config drift',
    deps: 'Dependency spike — review for forced updates or supply chain concerns',
    issues: 'Issue spike — may indicate regression from recent release',
    coverage: 'Coverage anomaly — verify test infrastructure is healthy',
    health: 'Health endpoint anomaly — possible incident, check monitoring',
    prs: 'PR volume anomaly — may indicate team capacity issues'
  };
  return actions[anomaly.checkType] || `Investigate ${anomaly.checkType} anomaly (z-score: ${anomaly.zScore?.toFixed(2)})`;
}

export function anomalyContext(anomaly: any): string {
  return `${anomaly.metric} at ${typeof anomaly.value === 'number' ? anomaly.value.toFixed(2) : anomaly.value} is ${(anomaly.zScore || 0).toFixed(1)}σ from mean ${typeof anomaly.mean === 'number' ? anomaly.mean.toFixed(2) : anomaly.mean} — unexpected deviation`;
}

// ── Summary helpers ──

export function computeSummary(results: CheckResult[]): any {
  const critical = results.filter(r => r.status === 'error').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const passing = results.filter(r => r.status === 'success').length;

  return {
    critical,
    warnings,
    passing,
    totalChecks: results.length,
    overallStatus: critical > 0 ? 'critical' : warnings > 0 ? 'degraded' : 'healthy'
  };
}

export function computeOverallTrend(results: CheckResult[], history: HistoryEntry[], trendAnalyzer: TrendAnalyzer): any {
  if (history.length < 2) return { direction: 'unknown', reason: 'insufficient_history' };

  const checkTypes = new Set<string>();
  history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
  results.forEach(r => checkTypes.add(r.type));

  let improving = 0;
  let degrading = 0;
  let stable = 0;

  for (const ct of checkTypes) {
    const trend = trendAnalyzer.analyze(ct, history);
    if (trend.direction === 'improving') improving++;
    else if (trend.direction === 'degrading') degrading++;
    else stable++;
  }

  return {
    direction: degrading > improving ? 'degrading' : improving > degrading ? 'improving' : 'stable',
    breakdown: { improving, degrading, stable }
  };
}