/**
 * CLI command handlers extracted from index.ts for testability.
 * These functions contain the core logic that was previously in Commander action handlers.
 */

import { Scanner, CheckResult } from './scanner';
import { VERSION } from './version';
import { PulseliveConfig } from './config';
import { ConfigLoader } from './config';
import { Reporter } from './reporter';
import { TrendAnalyzer } from './trends';
import { CLIDeps, defaultCLIDeps, MultiRepoDeps, defaultMultiRepoDeps } from './cli-helpers';
import {
  runSingleRepoCheck,
  formatCheckOutput, 
  handleHistory, 
  handleComparison, 
  handleCheckExitCodes,
  runFixCommand, 
  formatFixOutput,
  handleFixExitCodes,
  runQuickCheck, 
  formatQuickOutput, 
  handleQuickExitCodes,
  handleMultiRepoCheck,
  loadHistory, 
  saveHistory,
  formatTimeAgo
} from './cli-helpers';

export interface HandlersDeps extends CLIDeps {
  createScanner?: (config: PulseliveConfig, workingDir?: string) => Scanner;
  createConfigLoader?: (configPath?: string) => ConfigLoader;
}

export const defaultHandlersDeps: HandlersDeps = {
  ...defaultCLIDeps,
  createScanner: (config, _workingDir?) => new Scanner(config),
  createConfigLoader: (configPath?) => configPath ? new ConfigLoader(configPath) : new ConfigLoader(),
};

// CLI Handler Interfaces

export interface CheckCommandOptions {
  json?: boolean;
  junit?: boolean;
  verbose?: boolean;
  failOnError?: boolean;
  exitCode?: boolean;
  compare?: boolean;
  includeTrends?: boolean;
  quick?: boolean;
  repos?: string;
  otel?: boolean;
}

export interface FixCommandOptions {
  deps?: boolean;
  dryRun?: boolean;
  all?: boolean;
  json?: boolean;
  yes?: boolean;
}

export interface TrendsCommandOptions {
  type?: string;
  window?: string;
  json?: boolean;
}

export interface AnomaliesCommandOptions {
  json?: boolean;
}

export interface HistoryCommandOptions {
  limit?: string;
  json?: boolean;
}

export interface BadgeCommandOptions {
  json?: boolean;
}

export interface ReportCommandOptions {
  format?: string;
}

export interface WatchCommandOptions {
  quick?: boolean;
  json?: boolean;
  verbose?: boolean;
}

export interface HealthCommandOptions {
  json?: boolean;
}

export interface WebhooksCommandOptions {
  test?: boolean;
  json?: boolean;
}

export interface SentryCommandOptions {
  json?: boolean;
}

export interface StatusCommandOptions {
  json?: boolean;
}

// CLI Handler Functions

export class CLIHandlers {
  constructor(private deps: HandlersDeps = defaultHandlersDeps) {}

  /**
   * Validate that an explicitly-provided directory exists.
   * Prints an error and exits(1) if the dir is given but doesn't exist.
   * Returns the resolved working directory.
   */
  private validateDir(dir: string | undefined): string {
    if (dir && !this.deps.existsSync(dir)) {
      this.deps.error(`Error: Directory '${dir}' does not exist.`);
      this.deps.exit(1);
    }
    return dir || this.deps.cwd();
  }

  /**
   * Handle the check command
   */
  async handleCheckCommand(dir: string | undefined, options: CheckCommandOptions): Promise<void> {
    if (options.repos) {
      // Multi-repo mode
      await handleMultiRepoCheck(options.repos, options, this.deps);
      return;
    }

    // Single repo mode using extracted functions
    const { results, duration, config, workingDir } = await runSingleRepoCheck(dir, options);
    formatCheckOutput(results, duration, options);

    // Handle history and comparison
    handleHistory(results, options, workingDir);
    handleComparison(results, options);

    // Handle exit codes
    handleCheckExitCodes(results, options, this.deps);
  }

  /**
   * Handle the fix command
   */
  async handleFixCommand(dir: string | undefined, options: FixCommandOptions): Promise<void> {
    const { results, duration } = await runFixCommand(dir, options);
    formatFixOutput(results, duration, options);
    if (!options.json) {
      handleFixExitCodes(results);
    }
  }

  /**
   * Handle the quick command
   */
  async handleQuickCommand(dir: string | undefined, options: CheckCommandOptions): Promise<void> {
    if (options.repos) {
      // Multi-repo mode
      await handleMultiRepoCheck(options.repos, { ...options, quick: true }, this.deps);
      return;
    }

    // Single repo mode using extracted functions
    const { results, duration } = await runQuickCheck(dir, options);
    formatQuickOutput(results, duration, options);
    handleQuickExitCodes(results, options);
  }

  /**
   * Handle the init command
   */
  handleInitCommand(): void {
    const configLoader = new ConfigLoader();
    const detected = configLoader.autoDetect();

    const defaultConfig = {
      github: {
        repo: detected.github?.repo || ''
        // Token is never written to config - use GITHUB_TOKEN or GH_TOKEN env vars
      },
      health: {
        allow_local: false,
        endpoints: detected.health?.endpoints || []
      },
      checks: detected.checks || {
        ci: true,
        deps: true,
        git: true,
        health: true,
        issues: true,
        prs: true,
        deploy: true,
        coverage: { enabled: true, threshold: 80 },
        sentry: true
      },
      webhooks: [] as Array<{ url: string; events: string[]; secret?: string }>,
      sentry: {
        organization: '',
        project: ''
      }
    };

    this.deps.writeFile('.pulsetel.yml', yaml.stringify(defaultConfig));
    this.deps.log('Generated .pulsetel.yml configuration file');
    if (detected.github?.repo) {
      this.deps.log(`  Auto-detected GitHub repo: ${detected.github.repo}`);
    }
    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
      this.deps.log('  GitHub token: detected via environment variable (not written to config)');
    }
    this.deps.log('\nConsider adding these to your .gitignore:');
    this.deps.log('  .pulsetel-history/');
    this.deps.log('  coverage/');
  }

  /**
   * Handle the trends command
   */
  async handleTrendsCommand(options: TrendsCommandOptions): Promise<void> {
    const history = loadHistory();
    if (history.length === 0) {
      this.deps.log('📊 Insufficient data - need at least 3 data points for trend analysis');
      return;
    }

    // Check for insufficient data
    if (history.length < 3) {
      this.deps.log(`📊 Insufficient data for trend analysis - run \`pulsetel check\` a few more times to establish a baseline (currently have ${history.length} data points, need at least 3)`);
      return;
    }

    const trendAnalyzer = new TrendAnalyzer();
    const window = parseInt(options.window || '7') || 7;

    if (options.json) {
      if (options.type) {
        const trend = trendAnalyzer.analyze(options.type, history, window);
        this.deps.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
          version: VERSION,
          timestamp: new Date().toISOString(),
          check_type: options.type,
          trend: trend
        }, null, 2));
      } else {
        const checkTypes = new Set<string>();
        history.forEach((entry: any) => {
          entry.results.forEach((r: any) => checkTypes.add(r.type));
        });
        const allTrends: any = {};
        for (const ct of checkTypes) {
          allTrends[ct] = trendAnalyzer.analyze(ct, history, window);
        }
        this.deps.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
          version: VERSION,
          timestamp: new Date().toISOString(),
          trends: allTrends
        }, null, 2));
      }
      return;
    }

    if (options.type) {
      const trend = trendAnalyzer.analyze(options.type, history, window);
      printTrendResult(trend);
    } else {
      const checkTypes = new Set<string>();
      history.forEach((entry: any) => {
        entry.results.forEach((r: any) => checkTypes.add(r.type));
      });

      this.deps.log('TREND ANALYSIS');
      this.deps.log('==============\n');

      for (const ct of checkTypes) {
        const trend = trendAnalyzer.analyze(ct, history, window);
        printTrendResult(trend);
        this.deps.log('');
      }
    }
  }

  /**
   * Handle the anomalies command
   */
  async handleAnomaliesCommand(options: AnomaliesCommandOptions): Promise<void> {
    const history = loadHistory();
    if (history.length === 0) {
      this.deps.log('📊 Insufficient data - need at least 3 data points for anomaly detection');
      return;
    }

    // Check for insufficient data for anomaly detection
    if (history.length < 5) {
      this.deps.log(`📊 Insufficient data for anomaly detection - need at least 5 data points for statistical analysis (currently have ${history.length})`);
      return;
    }

    const trendAnalyzer = new TrendAnalyzer();
    const anomalies = trendAnalyzer.detectAnomalies(history);

    if (options.json) {
      this.deps.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        anomalies: anomalies
      }, null, 2));
      return;
    }

    if (anomalies.length === 0) {
      this.deps.log('✅ No anomalies detected');
      return;
    }

    this.deps.log('🚨 DETECTED ANOMALIES');
    this.deps.log('====================\n');

    anomalies.forEach((anomaly, index) => {
      const severityIcon = anomaly.severity === 'high' ? '🔴' :
                           anomaly.severity === 'medium' ? '🟡' : '🟢';
      this.deps.log(`${index + 1}. ${severityIcon} ${anomaly.checkType.toUpperCase()}`);
      this.deps.log(`   Metric: ${anomaly.metric}`);
      this.deps.log(`   Value: ${anomaly.value.toFixed(2)} (mean: ${anomaly.mean.toFixed(2)}, σ: ${anomaly.stdDev.toFixed(2)})`);
      this.deps.log(`   Z-Score: ${anomaly.zScore.toFixed(2)} (${anomaly.severity})`);
      this.deps.log('');
    });
  }

  /**
   * Handle the history command
   */
  handleHistoryCommand(options: HistoryCommandOptions): void {
    const limit = parseInt(options.limit || '10') || 10;
    const history = loadHistory();

    if (history.length === 0) {
      this.deps.log('No history available. Run `pulsetel check` first.');
      return;
    }

    // Sort by timestamp (newest first)
    history.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const limitedHistory = history.slice(0, limit);

    if (options.json) {
      this.deps.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        history: limitedHistory
      }, null, 2));
      return;
    }

    this.deps.log('PULSETEL HISTORY\n');
    this.deps.log(`Showing last ${limitedHistory.length} runs (of ${history.length} total)\n`);

    limitedHistory.forEach((run: any, index: number) => {
      this.deps.log(`${index + 1}. ${new Date(run.timestamp).toLocaleString()}`);
      run.results.forEach((result: any) => {
        const statusIcon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
        this.deps.log(`   ${statusIcon} ${result.type}: ${result.message}`);
      });
      this.deps.log("");
    });
  }

  /**
   * Handle the badge command
   */
  async handleBadgeCommand(dir: string | undefined, options: BadgeCommandOptions): Promise<void> {
    const workingDir = this.validateDir(dir);
    const configLoader = this.deps.createConfigLoader
      ? this.deps.createConfigLoader(dir ? dir + '/.pulsetel.yml' : undefined)
      : (dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader());
    const config = configLoader.autoDetect(workingDir);
    const scanner = this.deps.createScanner
      ? this.deps.createScanner(config, workingDir)
      : new Scanner(config, workingDir);

    // Run checks to determine status
    const results: CheckResult[] = await scanner.runAllChecks();

    // Determine overall status
    const hasErrors = results.some(r => r.status === 'error');
    const hasWarnings = results.some(r => r.status === 'warning');

    let status = 'passing';
    let color = 'brightgreen';

    if (hasErrors) {
      status = 'failing';
      color = 'red';
    } else if (hasWarnings) {
      status = 'warning';
      color = 'yellow';
    }

    const badgeUrl = `https://img.shields.io/badge/pulsetel-${status}-${color}`;
    const markdown = `![pulsetel](${badgeUrl})`;

    if (options.json) {
      this.deps.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        status,
        color,
        url: badgeUrl,
        markdown
      }, null, 2));
    } else {
      this.deps.log(markdown);
    }
  }

  /**
   * Handle the sentry command
   */
  async handleSentryCommand(dir: string | undefined, options: SentryCommandOptions): Promise<void> {
    const workingDir = this.validateDir(dir);
    const configLoader = this.deps.createConfigLoader
      ? this.deps.createConfigLoader(dir ? dir + '/.pulsetel.yml' : undefined)
      : (dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader());
    const config = configLoader.autoDetect(workingDir);
    
    const { SentryCheck } = await import('./checks/sentry.js');
    const sentryCheck = new SentryCheck(config);
    const result = await sentryCheck.run();

    if (options.json) {
      this.deps.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        type: result.type,
        status: result.status,
        message: result.message,
        details: result.details
      }, null, 2));
    } else {
      const statusIcon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      this.deps.log(`${statusIcon} Sentry: ${result.message}`);
      if (result.details) {
        const details = result.details;
        if (details.unresolved !== undefined) {
          this.deps.log(`  Unresolved issues: ${details.unresolved}`);
        }
        if (details.totalEvents !== undefined) {
          this.deps.log(`  Total events: ${details.totalEvents}`);
        }
        if (details.affectedUsers !== undefined) {
          this.deps.log(`  Affected users: ${details.affectedUsers}`);
        }
      }
    }
  }

  /**
   * Handle the webhooks command
   */
  async handleWebhooksCommand(options: WebhooksCommandOptions): Promise<void> {
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    const webhooks = (config as any).webhooks || [];

    if (webhooks.length === 0) {
      if (options.json) {
        this.deps.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
          version: VERSION,
          timestamp: new Date().toISOString(),
          webhooks: [],
          message: "No webhooks configured"
        }, null, 2));
      } else {
        this.deps.log('No webhooks configured');
      }
      return;
    }

    if (options.test) {
      // Test webhook delivery
      const { WebhookNotifier } = await import('./webhooks.js');
      const notifier = new WebhookNotifier(config);
      
      // Create a test payload
      const testPayload = {
        event: 'test',
        checkType: 'test',
        details: { message: 'This is a test webhook from PulseTel' },
        timestamp: new Date().toISOString(),
        project: config.github?.repo || 'test-project',
        severity: 'info' as const,
        confidence: 'high' as const,
        actionable: 'Webhook test successful',
        context: 'Test notification from PulseTel CLI'
      };

      try {
        await notifier.notify([{
          type: 'test',
          status: 'success',
          message: 'Test webhook',
          details: testPayload
        }]);
        
        if (options.json) {
          this.deps.log(JSON.stringify({
            schema_version: "1.0.0",
            schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
            version: VERSION,
            timestamp: new Date().toISOString(),
            webhooks: webhooks,
            test_status: "success",
            message: "Webhook test completed"
          }, null, 2));
        } else {
          this.deps.log('✅ Webhook test completed successfully');
        }
      } catch (error: any) {
        if (options.json) {
          this.deps.log(JSON.stringify({
            schema_version: "1.0.0",
            schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
            version: VERSION,
            timestamp: new Date().toISOString(),
            webhooks: webhooks,
            test_status: "error",
            message: "Webhook test failed",
            error: error.message
          }, null, 2));
        } else {
          this.deps.log('❌ Webhook test failed:', error.message);
        }
      }
    } else {
      // List configured webhooks
      if (options.json) {
        this.deps.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
          version: VERSION,
          timestamp: new Date().toISOString(),
          webhooks: webhooks
        }, null, 2));
      } else {
        this.deps.log('Configured Webhooks:');
        webhooks.forEach((webhook: any, index: number) => {
          this.deps.log(`${index + 1}. ${webhook.url}`);
          this.deps.log(`   Events: ${webhook.events.join(', ')}`);
          if (webhook.secret) {
            this.deps.log(`   Secret: [configured]`);
          }
          this.deps.log('');
        });
      }
    }
  }

  /**
   * Handle the health command
   */
  async handleHealthCommand(dir: string | undefined, options: HealthCommandOptions): Promise<void> {
    const workingDir = this.validateDir(dir);
    const configLoader = this.deps.createConfigLoader
      ? this.deps.createConfigLoader(dir ? dir + '/.pulsetel.yml' : undefined)
      : (dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader());
    const config = configLoader.autoDetect(workingDir);
    const scanner = this.deps.createScanner
      ? this.deps.createScanner(config, workingDir)
      : new Scanner(config, workingDir);

    // Run checks to determine health score
    const results: CheckResult[] = await scanner.runAllChecks();

    // Calculate health score (0-100)
    const critical = results.filter(r => r.status === 'error').length;
    const warnings = results.filter(r => r.status === 'warning').length;
    const totalChecks = results.length;
    const successChecks = results.filter(r => r.status === 'success').length;

    // Health score calculation: base score based on success rate, penalize for critical/warnings
    const successRate = totalChecks > 0 ? successChecks / totalChecks : 0;
    const baseScore = Math.round(successRate * 100);
    
    // Penalize for critical issues (20 points each, max 80)
    const criticalPenalty = Math.min(critical * 20, 80);
    // Penalize for warnings (5 points each, max 40)
    const warningPenalty = Math.min(warnings * 5, 40);
    
    const healthScore = Math.max(0, baseScore - criticalPenalty - warningPenalty);

    // Determine status
    const status = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical';
    const statusIcon = healthScore >= 80 ? '✅' : healthScore >= 50 ? '⚠️' : '❌';

    if (options.json) {
      this.deps.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        health_score: healthScore,
        status: status,
        critical: critical,
        warnings: warnings,
        total_checks: totalChecks,
        success_checks: successChecks
      }, null, 2));
    } else {
      this.deps.log(`${statusIcon} Health Score: ${healthScore}/100 (${status})`);
      this.deps.log(`  Critical: ${critical}, Warnings: ${warnings}, Success: ${successChecks}/${totalChecks}`);
    }
  }

  /**
   * Handle the status command
   */
  async handleStatusCommand(dir: string | undefined, options: StatusCommandOptions): Promise<void> {
    const workingDir = this.validateDir(dir);
    const historyDir = workingDir + '/.pulsetel-history';

    const history = loadHistory(historyDir);

    if (history.length === 0) {
      if (options.json) {
        this.deps.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
          version: VERSION,
          timestamp: new Date().toISOString(),
          healthy: null,
          message: "No status history found. Run `pulsetel check` first to establish a baseline."
        }, null, 2));
      } else {
        this.deps.log('No status history found. Run `pulsetel check` first to establish a baseline.');
      }
      return;
    }

    // Sort by timestamp (newest first)
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const latestRun = history[0];

    const startTime = Date.now();
    const critical = latestRun.results.filter(r => r.status === 'error').length;
    const warnings = latestRun.results.filter(r => r.status === 'warning').length;
    const healthy = critical === 0;
    const totalDuration = Date.now() - startTime;

    if (options.json) {
      this.deps.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        healthy: healthy,
        critical: critical,
        warnings: warnings,
        last_check: latestRun.timestamp,
        duration_ms: totalDuration
      }, null, 2));
    } else {
      const statusIcon = healthy ? '✅' : '❌';
      const lastChecked = formatTimeAgo(latestRun.timestamp);
      this.deps.log(`${statusIcon} ${healthy ? 'Healthy' : 'Unhealthy'} (${critical} critical, ${warnings} warnings) - last checked ${lastChecked}`);
    }
  }

  /**
   * Handle the report command
   */
  async handleReportCommand(dir: string | undefined, options: ReportCommandOptions): Promise<void> {
    const workingDir = this.validateDir(dir);
    const configLoader = this.deps.createConfigLoader
      ? this.deps.createConfigLoader(dir ? dir + '/.pulsetel.yml' : undefined)
      : (dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader());
    const config = configLoader.autoDetect(workingDir);
    const scanner = this.deps.createScanner
      ? this.deps.createScanner(config, workingDir)
      : new Scanner(config, workingDir);
    const reporter = new Reporter(false);

    // Run checks
    const results: CheckResult[] = await scanner.runAllChecks();

    if (options.format === 'markdown') {
      // Generate markdown report
      let report = '# PulseTel Project Health Report\n\n';

      // Summary table
      report += '## Summary\n\n';
      report += '| Check | Status | Message |\n';
      report += '|-------|--------|---------|\n';

      results.forEach(result => {
        const statusIcon = result.status === 'success' ? '✅' :
                          result.status === 'warning' ? '⚠️' : '❌';
        report += `| ${result.type} | ${statusIcon} ${result.status} | ${result.message} |\n`;
      });

      report += '\n\n';

      // Detailed findings by severity
      const errors = results.filter(r => r.status === 'error');
      const warnings = results.filter(r => r.status === 'warning');
      const successes = results.filter(r => r.status === 'success');

      if (errors.length > 0) {
        report += '## Critical Issues 🔴\n\n';
        errors.forEach((error, index) => {
          report += `${index + 1}. **${error.type}**: ${error.message}\n`;
          if (error.details) {
            report += `   - Details: ${JSON.stringify(error.details)}\n`;
          }
          report += '\n';
        });
      }

      if (warnings.length > 0) {
        report += '## Warnings ⚠️\n\n';
        warnings.forEach((warning, index) => {
          report += `${index + 1}. **${warning.type}**: ${warning.message}\n`;
          if (warning.details) {
            report += `   - Details: ${JSON.stringify(warning.details)}\n`;
          }
          report += '\n';
        });
      }

      if (successes.length > 0) {
        report += '## Healthy Checks ✅\n\n';
        successes.forEach((success, index) => {
          report += `${index + 1}. **${success.type}**: ${success.message}\n`;
          if (success.details) {
            report += `   - Details: ${JSON.stringify(success.details)}\n`;
          }
          report += '\n';
        });
      }

      // Recommendations
      report += '## Recommendations\n\n';

      if (errors.length > 0) {
        report += '- 🔴 **Critical**: Address the critical issues immediately as they may indicate broken builds, failed deployments, or security vulnerabilities.\n';
      }

      if (warnings.length > 0) {
        report += '- ⚠️ **Warnings**: Review warning items for potential improvements in code quality, test coverage, or dependency management.\n';
      }

      if (successes.length === results.length) {
        report += '- ✅ **Excellent**: All checks are passing! Keep up the good work maintaining project health.\n';
      }

      report += '\n---\n\n';
      report += `*Generated by PulseTel v${VERSION} on ${new Date().toISOString()}*\n`;

      this.deps.log(report);
    } else {
      // Text format (fallback to standard reporter)
      this.deps.log(reporter.format(results));
    }
  }


  /**
   * Handle the diff command
   */
  async handleDiffCommand(dir: string | undefined, options: CheckCommandOptions): Promise<void> {
    const { PulsetelDiff } = await import('./diff/index.js');
    const workingDir = this.validateDir(dir);
    const configLoader = dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const diff = new PulsetelDiff(config, workingDir);
    await diff.run({ format: options.json ? 'json' : 'text' });
  }

  /**
   * Handle the guard command
   */
  async handleGuardCommand(command: string, args: any, options: any): Promise<void> {
    const { PulsetelGuard } = await import('./guard/index.js');
    const workingDir = options.cwd || this.deps.cwd();
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const guard = new PulsetelGuard(config, {
      command,
      args: args || [],
      cwd: workingDir,
      timeout: options.timeout ? parseInt(options.timeout) : 30000,
      threshold: options.threshold ? parseFloat(options.threshold) : 20
    });
    await guard.run();
  }

  /**
   * Handle the watch command
   */
  async handleWatchCommand(dir: string | undefined, options: WatchCommandOptions): Promise<void> {
    const fs = require('fs');
    const path = require('path');

    this.deps.log('👁️  PulseTel watch mode started - monitoring for file changes');
    this.deps.log('    Press Ctrl+C to exit\n');

    // Initial run
    const workingDir = this.validateDir(dir);
    const configLoader = dir ? new ConfigLoader(dir + '/.pulsetel.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const scanner = new Scanner(config, workingDir);
    const reporter = new Reporter(!options.json);

    const runChecks = async () => {
      const startTime = Date.now();
      const results: CheckResult[] = options.quick ? await scanner.runQuickChecks() : await scanner.runAllChecks();
      const totalDuration = Date.now() - startTime;

      if (options.json) {
        this.deps.log(JSON.stringify({
          version: VERSION,
          timestamp: new Date().toISOString(),
          duration: totalDuration,
          quick: !!options.quick,
          results
        }, null, 2));
      } else if (options.verbose) {
        this.deps.log(reporter.formatVerbose(results));
        this.deps.log(`\n⏱  Total: ${totalDuration}ms`);
      } else {
        this.deps.log(reporter.format(results));
      }
      this.deps.log('---');
    };

    // Run initial checks
    await runChecks();

    // Set up file watcher
    const watchDir = dir || this.deps.cwd();
    const watcher = fs.watch(watchDir, { recursive: true }, async (eventType: string, filename: string | Buffer) => {
      if (!filename) return;

      const filenameStr = typeof filename === 'string' ? filename : filename.toString();

      // Ignore .git, node_modules, and dotfiles
      if (filenameStr.startsWith('.git/') || filenameStr.startsWith('node_modules/') || filenameStr.startsWith('.')) {
        return;
      }

      // Ignore temporary files and common editor files
      if (filenameStr.endsWith('~') || filenameStr.endsWith('.swp') || filenameStr.endsWith('.tmp')) {
        return;
      }

      this.deps.log(`\n📝 File changed: ${filenameStr} (${eventType})`);
      await runChecks();
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      this.deps.log('\n👋 Watch mode stopped');
      watcher.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.deps.log('\n👋 Watch mode stopped');
      watcher.close();
      process.exit(0);
    });
  }
}

// Helper functions (moved from index.ts)

export function printTrendResult(trend: any): void {
  const directionIcon = trend.direction === 'improving' ? '📈' :
                         trend.direction === 'degrading' ? '📉' : '➡️';
  const anomalyTag = trend.anomaly ? ' ⚠️ ANOMALY' : '';
  console.log(`${directionIcon} ${trend.checkType}: ${trend.direction}${anomalyTag}`);
  console.log(`   Delta: ${trend.delta > 0 ? '+' : ''}${trend.delta.toFixed(2)}`);
  console.log(`   Velocity: ${trend.velocity.toFixed(2)}/run`);
  if (trend.mean !== undefined) {
    console.log(`   Mean: ${trend.mean.toFixed(2)}, σ: ${(trend.stdDev || 0).toFixed(2)}`);
  }
}

// Import yaml for init command
let yaml: any;
try {
  yaml = require('yaml');
} catch (e) {
  // Fallback for environments without yaml package
  yaml = {
    stringify: (obj: any) => JSON.stringify(obj, null, 2)
  };
}

// Re-export for convenience
export { loadHistory, saveHistory, formatTimeAgo } from './cli-helpers';