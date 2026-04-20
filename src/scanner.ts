import { ConfigLoader, PulseliveConfig } from './config';
import { CICheck } from './checks/ci';
import { DeployCheck } from './checks/deploy';
import { HealthCheck } from './checks/health';
import { GitCheck } from './checks/git';
import { IssuesCheck } from './checks/issues';
import { DepsCheck } from './checks/deps';
import { CoverageCheck } from './checks/coverage';
import { PRsCheck } from './checks/prs';
import { SentryCheck } from './checks/sentry';
import { WebhookNotifier } from './webhooks';
import { initOtel, withOtelSpan, exportResults, shutdownOtel } from './otel';

export interface CheckResult {
  type: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: any;
  duration?: number;  // milliseconds
  severity?: 'low' | 'medium' | 'high' | 'critical';
  confidence?: 'low' | 'medium' | 'high';
  actionable?: string;
  context?: string;
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

/**
 * Interface for check instances — any check must implement run().
 */
export interface Check {
  run(): Promise<CheckResult>;
}

/**
 * Factory function type for creating check instances.
 * Takes config and workingDir, returns a Check.
 */
export type CheckFactory = (config: PulseliveConfig, workingDir: string) => Check;

/**
 * Check registry entry — defines a check type, its factory, retry behaviour, and config key.
 */
interface CheckEntry {
  type: string;
  factory: CheckFactory;
  retryable: boolean;
  configKey: string;  // e.g. 'ci', 'deps', 'coverage' — used for enable/disable check
}

/**
 * OTel dependency injection — wraps initOtel, withOtelSpan, exportResults for testability.
 */
export interface OTelDeps {
  init: (config: PulseliveConfig) => boolean;
  withSpan: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  exportResults: (results: CheckResult[]) => void;
}

export const defaultOTelDeps: OTelDeps = {
  init: initOtel,
  withSpan: withOtelSpan,
  exportResults: exportResults,
};

/**
 * Webhook dependency injection — wraps WebhookNotifier for testability.
 */
export interface WebhookDeps {
  notify: (results: CheckResult[]) => Promise<void>;
}

export const defaultWebhookDeps: (config: PulseliveConfig) => WebhookDeps = (config) => ({
  notify: (results) => new WebhookNotifier(config).notify(results),
});

/**
 * Scanner dependency injection — aggregates all injectable dependencies.
 */
export interface ScannerDeps {
  checks: CheckEntry[];
  otel: OTelDeps;
  webhook: WebhookDeps;
}

/**
 * Default check registry using real check classes.
 */
export const defaultCheckEntries: CheckEntry[] = [
  { type: 'ci', factory: (cfg) => new CICheck(cfg), retryable: true, configKey: 'ci' },
  { type: 'deploy', factory: (cfg) => new DeployCheck(cfg), retryable: true, configKey: 'deploy' },
  { type: 'health', factory: (cfg) => new HealthCheck(cfg), retryable: false, configKey: 'health' },
  { type: 'git', factory: (cfg, wd) => new GitCheck(cfg, wd), retryable: true, configKey: 'git' },
  { type: 'issues', factory: (cfg) => new IssuesCheck(cfg), retryable: true, configKey: 'issues' },
  { type: 'prs', factory: (cfg) => new PRsCheck(cfg), retryable: true, configKey: 'prs' },
  { type: 'coverage', factory: (cfg) => new CoverageCheck(cfg), retryable: false, configKey: 'coverage' },
  { type: 'deps', factory: (cfg) => new DepsCheck(cfg), retryable: false, configKey: 'deps' },
  { type: 'sentry', factory: (cfg) => new SentryCheck(cfg), retryable: true, configKey: 'sentry' },
];

export class Scanner {
  private config: PulseliveConfig;
  private workingDir: string;
  private otelEnabled: boolean;
  private deps: ScannerDeps;

  constructor(config: PulseliveConfig, workingDir: string = process.cwd(), deps?: Partial<ScannerDeps>) {
    this.config = config;
    this.workingDir = workingDir;
    
    const otel = deps?.otel || defaultOTelDeps;
    this.otelEnabled = otel.init(config);
    
    this.deps = {
      checks: deps?.checks || defaultCheckEntries,
      otel,
      webhook: deps?.webhook || defaultWebhookDeps(config),
    };
  }

  /**
   * Check if a check type is enabled based on config.
   */
  private isEnabled(entry: CheckEntry): boolean {
    const config = this.config.checks;
    if (!config) return true;
    
    // Special handling for coverage which has a nested enabled flag
    if (entry.type === 'coverage') {
      return config.coverage?.enabled !== false;
    }
    
    return (config as any)[entry.configKey] !== false;
  }

  /**
   * Run a single check entry, with optional retry and OTel wrapping.
   */
  private async runCheck(entry: CheckEntry): Promise<CheckResult> {
    const check = entry.factory(this.config, this.workingDir);
    const runFn = entry.retryable ? () => withRetry(() => check.run()) : () => check.run();
    const wrappedFn = this.otelEnabled 
      ? () => this.deps.otel.withSpan(entry.type, runFn)
      : runFn;
    return wrappedFn();
  }

  async runAllChecks(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    for (const entry of this.deps.checks) {
      if (!this.isEnabled(entry)) continue;
      const startTime = Date.now();
      try {
        const result = await this.runCheck(entry);
        result.duration = Date.now() - startTime;
        results.push(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          type: entry.type,
          status: 'error',
          message: `${entry.type} check failed: ${errorMsg}`,
          duration: Date.now() - startTime
        });
      }
    }

    // Export results to OpenTelemetry if enabled
    if (this.otelEnabled) {
      this.deps.otel.exportResults(results);
    }

    // Fire webhook notifications (non-blocking)
    this.deps.webhook.notify(results).catch(() => {
      // Webhook failures should not affect check results
    });

    return results;
  }

  async runSingleCheck(checkType: string): Promise<CheckResult> {
    const validTypes = this.deps.checks.map(e => e.type);
    if (!validTypes.includes(checkType)) {
      return {
        type: checkType,
        status: 'error',
        message: `Unknown check type: ${checkType}. Valid types: ${validTypes.join(', ')}`
      };
    }

    // Respect config enable/disable flags
    const entry = this.deps.checks.find(e => e.type === checkType);
    if (entry && !this.isEnabled(entry)) {
      return {
        type: checkType,
        status: 'warning',
        message: `${checkType} check is disabled in configuration`
      };
    }

    const startTime = Date.now();
    let result: CheckResult;

    try {
      result = await this.runCheck(entry!);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result = {
        type: checkType,
        status: 'error',
        message: `${checkType} check failed: ${errorMsg}`
      };
    }

    result.duration = Date.now() - startTime;
    
    // Export single check result if OTel is enabled
    if (this.otelEnabled) {
      this.deps.otel.exportResults([result]);
    }
    
    return result;
  }

  /**
   * Quick triage — runs fast checks only, skips deps and coverage.
   * Returns in ~1-2s instead of ~8-12s for the full check.
   * Adds placeholder entries for skipped checks so agents know what was omitted.
   */
  async runQuickChecks(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const quickTypes = new Set(['ci', 'deploy', 'health', 'git', 'issues', 'prs']);

    for (const entry of this.deps.checks) {
      if (!quickTypes.has(entry.type)) continue;
      if (!this.isEnabled(entry)) continue;
      const startTime = Date.now();
      try {
        const result = await this.runCheck(entry);
        result.duration = Date.now() - startTime;
        results.push(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          type: entry.type,
          status: 'error',
          message: `${entry.type} check failed: ${errorMsg}`,
          duration: Date.now() - startTime
        });
      }
    }

    // Add skipped check placeholders so agents know what was omitted
    const skippedTypes = ['deps', 'coverage'];
    for (const type of skippedTypes) {
      const entry = this.deps.checks.find(e => e.type === type);
      if (entry && this.isEnabled(entry)) {
        results.push({
          type,
          status: 'warning',
          message: `${type} check skipped in quick mode — run full check for details`,
          duration: 0
        });
      }
    }

    // Export results to OpenTelemetry if enabled
    if (this.otelEnabled) {
      this.deps.otel.exportResults(results);
    }

    return results;
  }
}