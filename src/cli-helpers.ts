/**
 * Pure-logic helper functions extracted from index.ts for testability.
 * These have no side effects (no console.log, no process.exit, no fs writes).
 */

import { CheckResult } from './scanner';
import { HistoryEntry } from './trends';
import { VERSION } from './version';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { PulseliveConfig } from './config';
import { Scanner } from './scanner';
import { ConfigLoader } from './config';
import { Reporter } from './reporter';
import { TrendAnalyzer } from './trends';

// Dependency Injection Interface
export interface CLIDeps {
  exit: (code: number) => void;
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options?: any) => void;
  execFile: (command: string, args: string[], options: any) => string;
  cwd: () => string;
}

export interface MultiRepoDeps extends CLIDeps {
  createScanner?: (config: PulseliveConfig) => any;
}

export const defaultCLIDeps: CLIDeps = {
  exit: (code) => process.exit(code),
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, c) => writeFileSync(p, c),
  existsSync: (p) => existsSync(p),
  mkdirSync: (p, opts) => mkdirSync(p, opts),
  execFile: (cmd, args, opts) => {
    const { execFileSync } = require('child_process');
    return execFileSync(cmd, args, opts).toString();
  },
  cwd: () => process.cwd(),
};

export const defaultMultiRepoDeps: MultiRepoDeps = {
  ...defaultCLIDeps,
  createScanner: (config: PulseliveConfig) => new Scanner(config)
};


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
    case 'sentry':
      if (result.status === 'error') {
        actionable = 'Fix critical errors tracked in Sentry';
        context = 'Unresolved production errors are affecting users';
      } else if (result.status === 'warning') {
        actionable = 'Review and triage Sentry issues';
        context = 'Some unresolved errors need attention';
      } else {
        actionable = 'No unresolved errors in Sentry';
        context = 'All tracked errors have been resolved';
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
    case 'sentry':
      if (result.details.unresolved !== undefined) metrics.unresolved = result.details.unresolved;
      if (result.details.totalEvents !== undefined) metrics.totalEvents = result.details.totalEvents;
      if (result.details.affectedUsers !== undefined) metrics.affectedUsers = result.details.affectedUsers;
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

export function loadHistory(historyDir: string = '.pulsetel-history'): HistoryEntry[] {
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
    const historyDir = '.pulsetel-history';

    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }

    const historyEntry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      pulsetel_version: VERSION,
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

    // History rotation: keep only last 100 entries
    rotateHistory(historyDir);
  } catch {
    // Silent fail - history is best-effort
  }
}

// ── History Rotation ───

function rotateHistory(historyDir: string): void {
  try {
    if (!existsSync(historyDir)) return;

    const files = readdirSync(historyDir)
      .filter(file => file.startsWith('run-') && file.endsWith('.json'))
      .sort((a, b) => {
        // Sort by timestamp (newest first)
        const aTime = new Date(a.replace('run-', '').replace('.json', '').replace(/-/g, ':'));
        const bTime = new Date(b.replace('run-', '').replace('.json', '').replace(/-/g, ':'));
        return bTime.getTime() - aTime.getTime();
      });

    // Keep only last 100 files
    if (files.length > 100) {
      const filesToDelete = files.slice(100);
      for (const file of filesToDelete) {
        unlinkSync(path.join(historyDir, file));
      }
    }
  } catch {
    // Silent fail - rotation is best-effort
  }
}

// ── Dependency Fix ───

export async function fixDependencies(workingDir: string, dryRun: boolean, skipConfirmation: boolean, deps: CLIDeps = defaultCLIDeps): Promise<FixResult> {
  const result: FixResult = {
    target: 'deps',
    status: 'failed',
    success: false,
    message: 'Dependency fix failed',
    changes: [],
    dryRun: dryRun
  };

  try {
    const packageJsonPath = path.join(workingDir, 'package.json');
    if (!deps.existsSync(packageJsonPath)) {
      return {
        target: 'deps',
        status: 'failed',
        success: false,
        message: 'No package.json found in working directory',
        changes: [],
        dryRun: dryRun
      };
    }

    let auditOutput = '';
    try {
      auditOutput = deps.execFile('npm', ['audit', '--json'], {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error: any) {
      if (error.stdout) {
        auditOutput = error.stdout;
      }
    }

    let auditData: any;
    try {
      auditData = JSON.parse(auditOutput);
    } catch {
      return {
        target: 'deps',
        status: 'failed',
        success: false,
        message: 'Failed to parse npm audit output',
        changes: [],
        dryRun: dryRun
      };
    }

    const vulnerabilitiesBefore = auditData?.vulnerabilities ? Object.keys(auditData.vulnerabilities).length : 0;

    if (vulnerabilitiesBefore === 0) {
      return {
        target: 'deps',
        status: 'success',
        success: true,
        message: 'No vulnerabilities found - nothing to fix',
        changes: [],
        dryRun: dryRun
      };
    }

    const changes: string[] = [];
    if (vulnerabilitiesBefore > 0) {
      changes.push(`${vulnerabilitiesBefore} vulnerabilities detected`);
    }

    if (dryRun) {
      return {
        target: 'deps',
        status: 'success',
        success: true,
        message: `Would fix ${vulnerabilitiesBefore} vulnerabilities (dry run)`,
        changes: changes,
        dryRun: true
      };
    }

    if (!skipConfirmation) {
      deps.log(`🔧 Ready to fix ${vulnerabilitiesBefore} vulnerabilities`);
      deps.log('   Changes that will be made:');
      changes.forEach(change => deps.log(`     - ${change}`));
      deps.log('\n⚠️  This will modify package.json and package-lock.json');
      deps.log('Continue? (y/N) ');
      deps.log('(Assuming confirmation for automated testing)');
    }

    try {
      const fixOutput = deps.execFile('npm', ['audit', 'fix', '--json'], {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let fixData: any;
      try {
        fixData = JSON.parse(fixOutput);
      } catch {
        fixData = {};
      }

      let auditAfterOutput = '';
      try {
        auditAfterOutput = deps.execFile('npm', ['audit', '--json'], {
          cwd: workingDir,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (error: any) {
        if (error.stdout) {
          auditAfterOutput = error.stdout;
        }
      }

      let auditAfterData: any;
      try {
        auditAfterData = JSON.parse(auditAfterOutput);
      } catch {
        auditAfterData = {};
      }

      const vulnerabilitiesAfter = auditAfterData?.vulnerabilities ? Object.keys(auditAfterData.vulnerabilities).length : 0;
      const fixedCount = vulnerabilitiesBefore - vulnerabilitiesAfter;

      if (fixedCount > 0) {
        changes.push(`Fixed ${fixedCount} vulnerabilities`);
        if (vulnerabilitiesAfter > 0) {
          changes.push(`${vulnerabilitiesAfter} vulnerabilities remain (may require manual fixes or major version updates)`);
          return {
            target: 'deps',
            status: 'partial',
            success: false,
            partial: true,
            message: `Partially fixed: ${fixedCount} vulnerabilities fixed, ${vulnerabilitiesAfter} remain`,
            changes: changes,
            dryRun: dryRun
          };
        } else {
          return {
            target: 'deps',
            status: 'success',
            success: true,
            message: `Successfully fixed all ${fixedCount} vulnerabilities`,
            changes: changes,
            dryRun: dryRun
          };
        }
      } else {
        return {
          target: 'deps',
          status: 'failed',
          success: false,
          message: 'No vulnerabilities were fixed - may require manual intervention',
          changes: changes,
          dryRun: dryRun
        };
      }
    } catch (fixError: any) {
      return {
        target: 'deps',
        status: 'failed',
        success: false,
        message: `npm audit fix failed: ${fixError.message}`,
        changes: changes,
        dryRun: dryRun,
        details: {
          error: fixError.message,
          stderr: fixError.stderr
        }
      };
    }
  } catch (error: any) {
    return {
      target: 'deps',
      status: 'failed',
      success: false,
      message: `Dependency fix failed: ${error.message}`,
      changes: [],
      dryRun: dryRun,
      details: {
        error: error.message,
        stack: error.stack
      }
    };
  }
}

// ── Single Repo Check ───

export async function runSingleRepoCheck(
  dir: string | undefined,
  options: { 
    json?: boolean; 
    junit?: boolean; 
    verbose?: boolean; 
    quick?: boolean; 
    includeTrends?: boolean;
    compare?: boolean;
    otel?: boolean;
  },
  deps: CLIDeps = defaultCLIDeps
): Promise<{ results: CheckResult[]; duration: number; config: PulseliveConfig; workingDir: string }> {
  const startTime = Date.now();
  // Validate explicit directory argument exists before falling back
  if (dir && !deps.existsSync(dir)) {
    deps.error(`Error: Directory '${dir}' does not exist.`);
    deps.exit(1);
  }
  const workingDir = dir || deps.cwd();
  const configLoader = dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader();
  
  // Handle OTel flag - override config if --otel is specified
  let config = configLoader.autoDetect(workingDir);
  if (options.otel !== undefined) {
    config = {
      ...config,
      otel: {
        ...config.otel,
        enabled: options.otel
      }
    };
  }
  
  const scanner = new Scanner(config, workingDir);
  
  const results: CheckResult[] = options.quick ? await scanner.runQuickChecks() : await scanner.runAllChecks();
  const totalDuration = Date.now() - startTime;
  
  return { results, duration: totalDuration, config, workingDir };
}

export function formatCheckOutput(
  results: CheckResult[],
  duration: number,
  options: { json?: boolean; junit?: boolean; verbose?: boolean; quick?: boolean; includeTrends?: boolean },
  deps: CLIDeps = defaultCLIDeps
): void {
  const reporter = new Reporter(!options.json);
  
  if (options.json) {
    const output: any = {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      duration: duration,
      quick: !!options.quick,
      results: results.map(r => mapToSchemaResult(r))
    };
    
    if (options.includeTrends) {
      const history = loadHistory();
      const trendAnalyzer = new TrendAnalyzer();
      const checkTypes = new Set<string>();
      history.forEach((entry: any) => {
        entry.results.forEach((r: any) => checkTypes.add(r.type));
      });
      results.forEach((r: CheckResult) => checkTypes.add(r.type));
      const trends: any = {};
      for (const ct of checkTypes) {
        trends[ct] = trendAnalyzer.analyze(ct, history);
      }
      output.trends = trends;
      output.anomalies = trendAnalyzer.detectAnomalies(history);
    }
    
    deps.log(JSON.stringify(output, null, 2));
  } else if (options.junit) {
    deps.log(reporter.formatJunit(results));
  } else if (options.verbose) {
    deps.log(reporter.formatVerbose(results));
    deps.log(`\n⏱  Total: ${duration}ms`);
  } else {
    deps.log(reporter.format(results));
  }
}

export function handleCheckExitCodes(
  results: CheckResult[],
  options: { exitCode?: boolean; failOnError?: boolean; ci?: boolean },
  deps: CLIDeps = defaultCLIDeps
): void {
  // Structured exit codes
  if (options.exitCode) {
    const hasErrors = results.some((r: CheckResult) => r.status === 'error');
    const hasWarnings = results.some((r: CheckResult) => r.status === 'warning');
    
    if (hasErrors) {
      deps.exit(1); // Critical issues found
    } else if (hasWarnings) {
      deps.exit(2); // Warnings only
    } else {
      deps.exit(0); // All checks healthy
    }
  } else if (options.failOnError || options.ci) {
    const hasCritical = results.some((r: CheckResult) => r.status === 'error');
    if (hasCritical) {
      deps.exit(1);
    }
  }
}

export function handleComparison(
  results: CheckResult[],
  options: { compare?: boolean },
  deps: CLIDeps = defaultCLIDeps
): void {
  // Compare with previous run if requested
  if (options.compare) {
    const comparison = compareWithPrevious(results);
    if (comparison) {
      deps.log('\n' + comparison);
    }
  }
}

export function handleHistory(
  results: CheckResult[],
  options: { compare?: boolean },
  workingDir: string,
  deps: CLIDeps = defaultCLIDeps
): void {
  // Save history after running checks (unless comparing)
  if (!options.compare) {
    saveHistory(results);
  }
}

export async function runFixCommand(
  dir: string | undefined,
  options: { deps?: boolean; dryRun?: boolean; all?: boolean; json?: boolean; yes?: boolean },
  deps: CLIDeps = defaultCLIDeps
): Promise<{ results: FixResult[]; duration: number }> {
  if (dir && !deps.existsSync(dir)) {
    deps.error(`Error: Directory '${dir}' does not exist.`);
    deps.exit(1);
  }
  const workingDir = dir || deps.cwd();
  const configLoader = dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader();
  const config = configLoader.autoDetect(workingDir);
  
  const startTime = Date.now();
  const results: FixResult[] = [];
  
  // Dependency fixes
  if (options.deps || options.all) {
    const depsResult = await fixDependencies(workingDir, options.dryRun || false, options.yes || false, deps);
    results.push(depsResult);
  }
  
  const totalDuration = Date.now() - startTime;
  
  return { results, duration: totalDuration };
}

export function formatFixOutput(
  results: FixResult[],
  duration: number,
  options: { json?: boolean },
  deps: CLIDeps = defaultCLIDeps
): void {
  if (options.json) {
    deps.log(JSON.stringify({
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      duration: duration,
      fix_results: results
    }, null, 2));
  } else {
    deps.log('🔧 PULSETEL FIX REPORT');
    deps.log('=======================\n');
    
    results.forEach((result, index) => {
      const statusIcon = result.success ? '✅' : result.partial ? '⚠️' : '❌';
      deps.log(`${index + 1}. ${statusIcon} ${result.target}`);
      deps.log(`   Status: ${result.status}`);
      if (result.message) {
        deps.log(`   Message: ${result.message}`);
      }
      if (result.changes && result.changes.length > 0) {
        deps.log(`   Changes:`);
        result.changes.forEach(change => {
          deps.log(`     - ${change}`);
        });
      }
      if (result.dryRun) {
        deps.log(`   📝 Dry run - no changes made`);
      }
      deps.log('');
    });
    
    deps.log(`⏱  Total: ${duration}ms`);
  }
}

export function handleFixExitCodes(
  results: FixResult[],
  deps: CLIDeps = defaultCLIDeps
): void {
  // Exit codes for fix command
  const hasFailures = results.some(r => !r.success && !r.partial);
  const hasPartial = results.some(r => r.partial);
  
  if (hasFailures) {
    deps.exit(1); // Fix failures
  } else if (hasPartial) {
    deps.exit(2); // Partial success
  } else {
    deps.exit(0); // All fixes successful
  }
}

export async function runQuickCheck(
  dir: string | undefined,
  options: { json?: boolean; repos?: string; otel?: boolean },
  deps: CLIDeps = defaultCLIDeps
): Promise<{ results: CheckResult[]; duration: number }> {
  if (options.repos) {
    // This will be handled by the caller
    deps.exit(0);
  }
  
  if (dir && !deps.existsSync(dir)) {
    deps.error(`Error: Directory '${dir}' does not exist.`);
    deps.exit(1);
  }
  
  const startTime = Date.now();
  const workingDir = dir || deps.cwd();
  const configLoader = dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader();
  
  // Handle OTel flag - override config if --otel is specified
  let config = configLoader.autoDetect(workingDir);
  if (options.otel !== undefined) {
    config = {
      ...config,
      otel: {
        ...config.otel,
        enabled: options.otel
      }
    };
  }
  
  const scanner = new Scanner(config, workingDir);
  const reporter = new Reporter(!options.json);

  const results: CheckResult[] = await scanner.runQuickChecks();
  const totalDuration = Date.now() - startTime;
  
  return { results, duration: totalDuration };
}

export function formatQuickOutput(
  results: CheckResult[],
  duration: number,
  options: { json?: boolean },
  deps: CLIDeps = defaultCLIDeps
): void {
  const reporter = new Reporter(!options.json);
  
  if (options.json) {
    deps.log(JSON.stringify({
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      quick: true,
      duration: duration,
      results: results.map(r => mapToSchemaResult(r))
    }, null, 2));
  } else {
    deps.log(reporter.format(results));
    deps.log(`\n⚡ Quick mode - deps and coverage skipped (${duration}ms)`);
  }
}

export function handleQuickExitCodes(
  results: CheckResult[],
  options: { exitCode?: boolean },
  deps: CLIDeps = defaultCLIDeps
): void {
  // Structured exit codes for quick command
  if (options.exitCode) {
    const hasErrors = results.some((r: CheckResult) => r.status === 'error');
    const hasWarnings = results.some((r: CheckResult) => r.status === 'warning');
    
    if (hasErrors) {
      deps.exit(1); // Critical issues found
    } else if (hasWarnings) {
      deps.exit(2); // Warnings only
    } else {
      deps.exit(0); // All checks healthy
    }
  }
}

export async function handleMultiRepoCheck(reposString: string, options: { json?: boolean; quick?: boolean; exitCode?: boolean; otel?: boolean }, deps: MultiRepoDeps = defaultMultiRepoDeps): Promise<void> {
  const repoList = reposString.split(',').map(r => r.trim()).filter(r => r.length > 0);
  
  if (repoList.length === 0) {
    deps.error('❌ No valid repositories specified');
    deps.exit(1);
  }
  
  const startTime = Date.now();
  const results: Array<{
    repo: string;
    results: CheckResult[];
    error?: string;
  }> = [];
  
  // Process each repository
  for (const repo of repoList) {
    try {
      // Create a temporary config for this repo
      const tempConfig: PulseliveConfig = {
        github: {
          repo: repo,
          token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN
        },
        checks: {
          ci: true,
          deps: !options.quick,
          git: true,
          health: true,
          issues: true,
          prs: true,
          deploy: true,
          sentry: true,
          coverage: !options.quick ? { enabled: true, threshold: 80 } : { enabled: false }
        },
        otel: options.otel !== undefined ? { enabled: options.otel } : undefined
      };
      
      const scanner = deps.createScanner ? deps.createScanner(tempConfig) : new Scanner(tempConfig);
      const checkResults: CheckResult[] = options.quick 
        ? await scanner.runQuickChecks()
        : await scanner.runAllChecks();
      
      results.push({
        repo: repo,
        results: checkResults
      });
      
    } catch (error: any) {
      results.push({
        repo: repo,
        results: [],
        error: error.message || 'Unknown error'
      });
    }
  }
  
  const totalDuration = Date.now() - startTime;
  
  if (options.json) {
    const overallSummary = computeMultiRepoSummary(results);
    
    deps.log(JSON.stringify({
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      duration: totalDuration,
      quick: !!options.quick,
      repos: results.map(r => ({
        repo: r.repo,
        results: r.results.map(check => mapToSchemaResult(check)),
        error: r.error
      })),
      summary: overallSummary
    }, null, 2));
  } else {
    // Table output
    deps.log('MULTI-REPO HEALTH CHECK');
    deps.log('=======================\n');
    
    // Header
    deps.log('Repo'.padEnd(30) + 'Status'.padEnd(10) + 'Critical'.padEnd(10) + 'Warnings'.padEnd(10) + 'Healthy');
    deps.log('-'.repeat(70));
    
    // Row for each repo
    for (const result of results) {
      if (result.error) {
        deps.log(result.repo.padEnd(30) + '❌ ERROR'.padEnd(10) + '-'.padEnd(10) + '-'.padEnd(10) + '-');
        deps.log(`  Error: ${result.error}`);
      } else {
        const critical = result.results.filter(r => r.status === 'error').length;
        const warnings = result.results.filter(r => r.status === 'warning').length;
        const healthy = result.results.filter(r => r.status === 'success').length;
        const statusIcon = critical > 0 ? '❌' : warnings > 0 ? '⚠️' : '✅';
        
        deps.log(result.repo.padEnd(30) + statusIcon.padEnd(10) + critical.toString().padEnd(10) + warnings.toString().padEnd(10) + healthy.toString());
      }
    }
    
    // Summary
    const overallSummary = computeMultiRepoSummary(results);
    deps.log('\nSUMMARY');
    deps.log('-------');
    deps.log(`Total repos: ${results.length}`);
    deps.log(`Repos with errors: ${overallSummary.reposWithErrors}`);
    deps.log(`Repos with warnings: ${overallSummary.reposWithWarnings}`);
    deps.log(`Overall status: ${overallSummary.overallStatus}`);
    deps.log(`\n⏱  Total: ${totalDuration}ms`);
  }
  
  // Exit codes for multi-repo
  if (options.exitCode) {
    const overallSummary = computeMultiRepoSummary(results);
    if (overallSummary.reposWithErrors > 0) {
      deps.exit(1); // Critical issues found
    } else if (overallSummary.reposWithWarnings > 0) {
      deps.exit(2); // Warnings only
    } else {
      deps.exit(0); // All checks healthy
    }
  }
}