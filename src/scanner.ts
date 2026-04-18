import { ConfigLoader, PulseliveConfig } from './config';
import { CICheck } from './checks/ci';
import { DeployCheck } from './checks/deploy';
import { HealthCheck } from './checks/health';
import { GitCheck } from './checks/git';
import { IssuesCheck } from './checks/issues';
import { DepsCheck } from './checks/deps';
import { CoverageCheck } from './checks/coverage';
import { PRsCheck } from './checks/prs';
import { WebhookNotifier } from './webhooks';

export interface CheckResult {
  type: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: any;
  duration?: number;  // milliseconds
}

/**
 * Retry wrapper for checks that make HTTP calls.
 * Retries up to 2 times on 5xx or rate-limit (429) errors.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 2): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Only retry on network errors or rate limits
      const isRetryable = !error.status || error.status >= 500 || error.status === 429;
      if (!isRetryable || attempt === maxRetries) throw error;
      // Exponential backoff: 1s, 2s
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

export class Scanner {
  private config: PulseliveConfig;
  private workingDir: string;

  constructor(config: PulseliveConfig, workingDir: string = process.cwd()) {
    this.config = config;
    this.workingDir = workingDir;
  }

  async runAllChecks(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    const checks: Array<{ type: string; enabled: boolean; run: () => Promise<CheckResult> }> = [
      { type: 'ci', enabled: this.config.checks?.ci !== false, run: () => withRetry(() => new CICheck(this.config).run()) },
      { type: 'deploy', enabled: this.config.checks?.deploy !== false, run: () => withRetry(() => new DeployCheck(this.config).run()) },
      { type: 'health', enabled: this.config.checks?.health !== false, run: () => new HealthCheck(this.config).run() },
      { type: 'git', enabled: this.config.checks?.git !== false, run: () => withRetry(() => new GitCheck(this.config, this.workingDir).run()) },
      { type: 'issues', enabled: this.config.checks?.issues !== false, run: () => withRetry(() => new IssuesCheck(this.config).run()) },
      { type: 'prs', enabled: this.config.checks?.prs !== false, run: () => withRetry(() => new PRsCheck(this.config).run()) },
      { type: 'coverage', enabled: this.config.checks?.coverage?.enabled !== false, run: () => new CoverageCheck(this.config).run() },
      { type: 'deps', enabled: this.config.checks?.deps !== false, run: () => new DepsCheck(this.config).run() },
    ];

    for (const check of checks) {
      if (!check.enabled) continue;
      const startTime = Date.now();
      try {
        const result = await check.run();
        result.duration = Date.now() - startTime;
        results.push(result);
      } catch (error) {
        results.push({
          type: check.type,
          status: 'error',
          message: 'Check failed after retries',
          duration: Date.now() - startTime
        });
      }
    }

    // Fire webhook notifications (non-blocking)
    const notifier = new WebhookNotifier(this.config);
    notifier.notify(results).catch(() => {
      // Webhook failures should not affect check results
    });

    return results;
  }

  async runSingleCheck(checkType: string): Promise<CheckResult> {
    const validTypes = ['ci', 'deploy', 'health', 'git', 'issues', 'prs', 'deps', 'coverage'];
    if (!validTypes.includes(checkType)) {
      return {
        type: checkType,
        status: 'error',
        message: `Unknown check type: ${checkType}. Valid types: ${validTypes.join(', ')}`
      };
    }

    // Respect config enable/disable flags
    if (this.config.checks?.[checkType as keyof typeof this.config.checks] === false) {
      return {
        type: checkType,
        status: 'warning',
        message: `${checkType} check is disabled in configuration`
      };
    }

    const startTime = Date.now();
    let result: CheckResult;

    const retryableCheck = (fn: () => Promise<CheckResult>) => withRetry(fn);

    switch (checkType) {
      case 'ci':
        result = await retryableCheck(() => new CICheck(this.config).run());
        break;
      case 'deploy':
        result = await retryableCheck(() => new DeployCheck(this.config).run());
        break;
      case 'health':
        result = await new HealthCheck(this.config).run();
        break;
      case 'git':
        result = await new GitCheck(this.config, this.workingDir).run();
        break;
      case 'issues':
        result = await retryableCheck(() => new IssuesCheck(this.config).run());
        break;
      case 'prs':
        result = await retryableCheck(() => new PRsCheck(this.config).run());
        break;
      case 'coverage':
        result = await new CoverageCheck(this.config).run();
        break;
      default:
        result = { type: checkType, status: 'error', message: `Unknown check type: ${checkType}` };
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Quick triage — runs fast checks only, skips deps and coverage.
   * Returns in ~1-2s instead of ~8-12s for the full check.
   * Adds placeholder entries for skipped checks so agents know what was omitted.
   */
  async runQuickChecks(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    const checks: Array<{ type: string; enabled: boolean; run: () => Promise<CheckResult> }> = [
      { type: 'ci', enabled: this.config.checks?.ci !== false, run: () => withRetry(() => new CICheck(this.config).run()) },
      { type: 'deploy', enabled: this.config.checks?.deploy !== false, run: () => withRetry(() => new DeployCheck(this.config).run()) },
      { type: 'health', enabled: this.config.checks?.health !== false, run: () => new HealthCheck(this.config).run() },
      { type: 'git', enabled: this.config.checks?.git !== false, run: () => new GitCheck(this.config, this.workingDir).run() },
      { type: 'issues', enabled: this.config.checks?.issues !== false, run: () => withRetry(() => new IssuesCheck(this.config).run()) },
      { type: 'prs', enabled: this.config.checks?.prs !== false, run: () => withRetry(() => new PRsCheck(this.config).run()) },
    ];

    for (const check of checks) {
      if (!check.enabled) continue;
      const startTime = Date.now();
      try {
        const result = await check.run();
        result.duration = Date.now() - startTime;
        results.push(result);
      } catch (error) {
        results.push({
          type: check.type,
          status: 'error',
          message: 'Check failed after retries',
          duration: Date.now() - startTime
        });
      }
    }

    // Add skipped check placeholders so agents know what was omitted
    const skipped: Array<{ type: string; enabled: boolean }> = [
      { type: 'deps', enabled: this.config.checks?.deps !== false },
      { type: 'coverage', enabled: this.config.checks?.coverage?.enabled !== false },
    ];

    for (const skip of skipped) {
      if (skip.enabled) {
        results.push({
          type: skip.type,
          status: 'warning',
          message: `${skip.type} check skipped in quick mode — run full check for details`,
          duration: 0
        });
      }
    }

    return results;
  }
}