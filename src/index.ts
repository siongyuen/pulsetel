#!/usr/bin/env node

import { Command } from 'commander';
import { ConfigLoader } from './config';
import { Scanner, CheckResult } from './scanner';
import { Reporter } from './reporter';
import { MCPServer } from './mcp-server';
import { MCPStdioServer } from './mcp-stdio';
import { TrendAnalyzer, HistoryEntry } from './trends';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import yaml from 'yaml';
import path from 'path';
import os from 'os';

import { VERSION } from './version';

const program = new Command();

program
  .name('pulselive')
  .description('Real-time project telemetry for AI agents')
  .version(VERSION);

program
  .command('check')
  .description('Run all checks and show report')
  .option('--json', 'Output results as JSON')
  .option('--junit', 'Output results as JUnit XML')
  .option('--verbose', 'Show detailed output including execution times')
  .option('--fail-on-error', 'Exit with code 1 if critical issues found')
  .option('--ci', 'Deprecated: use --fail-on-error instead')
  .option('--compare', 'Compare current run with previous run')
  .option('--include-trends', 'Include trend analysis in JSON output')
  .action(async (options) => {
    const startTime = Date.now();
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    const scanner = new Scanner(config);
    const reporter = new Reporter(!options.json);

    const results: CheckResult[] = await scanner.runAllChecks();
    const totalDuration = Date.now() - startTime;

    if (options.json) {
      const output: any = {
        version: VERSION,
        timestamp: new Date().toISOString(),
        duration: totalDuration,
        results
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
      console.log(JSON.stringify(output, null, 2));
    } else if (options.junit) {
      console.log(reporter.formatJunit(results));
    } else if (options.verbose) {
      console.log(reporter.formatVerbose(results));
      console.log(`\n⏱  Total: ${totalDuration}ms`);
    } else {
      console.log(reporter.format(results));
    }

    // Save history after running checks (unless comparing)
    if (!options.compare) {
      saveHistory(results);
    }

    // Compare with previous run if requested
    if (options.compare) {
      const comparison = compareWithPrevious(results);
      if (comparison) {
        console.log('\n' + comparison);
      }
    }

    if (options.failOnError || options.ci) {
      const hasCritical = results.some((r: CheckResult) => r.status === 'error');
      if (hasCritical) {
        process.exit(1);
      }
    }
  });

program
  .command('init')
  .description('Generate .pulselive.yml configuration file')
  .action(() => {
    const configLoader = new ConfigLoader();
    const detected = configLoader.autoDetect();

    const defaultConfig = {
      github: {
        repo: detected.github?.repo || ''
        // Token is never written to config — use GITHUB_TOKEN or GH_TOKEN env vars
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
        coverage: { enabled: true, threshold: 80 }
      },
      webhooks: [] as Array<{ url: string; events: string[]; secret?: string }>
    };

    writeFileSync('.pulselive.yml', yaml.stringify(defaultConfig));
    console.log('Generated .pulselive.yml configuration file');
    if (detected.github?.repo) {
      console.log(`  Auto-detected GitHub repo: ${detected.github.repo}`);
    }
    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
      console.log('  GitHub token: detected via environment variable (not written to config)');
    }
    console.log('\nConsider adding these to your .gitignore:');
    console.log('  .pulselive-history/');
    console.log('  coverage/');
  });

program
  .command('trends')
  .description('Show trend analysis for all check types')
  .option('--type <type>', 'Show trends for a specific check type')
  .option('--window <window>', 'Number of runs to analyze (default: 7)', '7')
  .option('--json', 'Output as structured JSON')
  .action(async (options) => {
    const history = loadHistory();
    if (history.length === 0) {
      console.log('No history available for trend analysis. Run `pulselive check` first.');
      return;
    }

    const trendAnalyzer = new TrendAnalyzer();
    const window = parseInt(options.window) || 7;

    if (options.json) {
      if (options.type) {
        console.log(JSON.stringify(trendAnalyzer.analyze(options.type, history, window), null, 2));
      } else {
        const checkTypes = new Set<string>();
        history.forEach((entry: any) => {
          entry.results.forEach((r: any) => checkTypes.add(r.type));
        });
        const allTrends: any = {};
        for (const ct of checkTypes) {
          allTrends[ct] = trendAnalyzer.analyze(ct, history, window);
        }
        console.log(JSON.stringify(allTrends, null, 2));
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

      console.log('TREND ANALYSIS');
      console.log('==============\n');

      for (const ct of checkTypes) {
        const trend = trendAnalyzer.analyze(ct, history, window);
        printTrendResult(trend);
        console.log('');
      }
    }
  });

program
  .command('anomalies')
  .description('Show detected anomalies')
  .option('--json', 'Output as structured JSON')
  .action(async (options) => {
    const history = loadHistory();
    if (history.length === 0) {
      console.log('No history available. Run `pulselive check` first.');
      return;
    }

    const trendAnalyzer = new TrendAnalyzer();
    const anomalies = trendAnalyzer.detectAnomalies(history);

    if (options.json) {
      console.log(JSON.stringify(anomalies, null, 2));
      return;
    }

    if (anomalies.length === 0) {
      console.log('✅ No anomalies detected');
      return;
    }

    console.log('🚨 DETECTED ANOMALIES');
    console.log('====================\n');

    anomalies.forEach((anomaly, index) => {
      const severityIcon = anomaly.severity === 'high' ? '🔴' :
                           anomaly.severity === 'medium' ? '🟡' : '🟢';
      console.log(`${index + 1}. ${severityIcon} ${anomaly.checkType.toUpperCase()}`);
      console.log(`   Metric: ${anomaly.metric}`);
      console.log(`   Value: ${anomaly.value.toFixed(2)} (mean: ${anomaly.mean.toFixed(2)}, σ: ${anomaly.stdDev.toFixed(2)})`);
      console.log(`   Z-Score: ${anomaly.zScore.toFixed(2)} (${anomaly.severity})`);
      console.log('');
    });
  });

program
  .command('history')
  .description('Show history of previous runs')
  .option('--limit <limit>', 'Number of runs to show', '10')
  .option('--json', 'Output as structured JSON')
  .action((options) => {
    const limit = parseInt(options.limit) || 10;
    const history = loadHistory();

    if (history.length === 0) {
      console.log('No history available. Run `pulselive check` first.');
      return;
    }

    // Sort by timestamp (newest first)
    history.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const limitedHistory = history.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(limitedHistory, null, 2));
      return;
    }

    console.log('PULSELIVE HISTORY\n');
    console.log(`Showing last ${limitedHistory.length} runs (of ${history.length} total)\n`);

    limitedHistory.forEach((run: any, index: number) => {
      console.log(`${index + 1}. ${new Date(run.timestamp).toLocaleString()}`);
      run.results.forEach((result: any) => {
        const statusIcon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
        console.log(`   ${statusIcon} ${result.type}: ${result.message}`);
      });
      console.log('');
    });
  });

program
  .command('mcp')
  .description('Start the MCP HTTP server for AI agents')
  .action(() => {
    const configLoader = new ConfigLoader();
    const mcpServer = new MCPServer(configLoader);
    mcpServer.start();
  });

program
  .command('mcp-stdio')
  .description('Start the MCP stdio transport (for Claude Desktop, Cursor, etc.)')
  .action(() => {
    const configLoader = new ConfigLoader();
    const stdioServer = new MCPStdioServer(configLoader);
    stdioServer.start();
  });

program.parse(process.argv);

// ── Helper Functions ──

function saveHistory(results: CheckResult[]): void {
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
    // Silent fail — history is best-effort
  }
}

function extractMetricsFromResult(result: CheckResult): any {
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

function loadHistory(): HistoryEntry[] {
  try {
    const historyDir = '.pulselive-history';

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

function compareWithPrevious(currentResults: CheckResult[]): string {
  try {
    const history = loadHistory();

    if (history.length === 0) {
      return 'No previous runs available for comparison';
    }

    // Sort newest first
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const previousRun = history[0];

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

function getTrendIcon(previousStatus: string, currentStatus: string): string {
  const statusOrder: Record<string, number> = { 'error': 1, 'warning': 2, 'success': 3 };
  const previousScore = statusOrder[previousStatus] || 0;
  const currentScore = statusOrder[currentStatus] || 0;

  if (currentScore > previousScore) return '↑';
  if (currentScore < previousScore) return '↓';
  return '→';
}

function printTrendResult(trend: any): void {
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

// Export for MCP server to use
export { loadHistory, saveHistory, extractMetricsFromResult, VERSION };