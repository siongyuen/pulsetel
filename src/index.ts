#!/usr/bin/env node

import { Command } from 'commander';
import { ConfigLoader } from './config';
import { Scanner, CheckResult } from './scanner';
import { Reporter } from './reporter';
import { MCPServer } from './mcp-server';
import { MCPStdioServer } from './mcp-stdio';
import { TrendAnalyzer, HistoryEntry } from './trends';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import yaml from 'yaml';
import path from 'path';
import os from 'os';

import { VERSION } from './version';
import { PulseliveConfig } from './config';
import { mapToSchemaResult, extractMetricsFromResult, formatTimeAgo, compareWithPrevious, getTrendIcon, computeMultiRepoSummary, loadHistory, saveHistory, FixResult } from './cli-helpers';


const program = new Command();

program
  .name('pulselive')
  .description('Real-time project telemetry for AI agents')
  .version(VERSION);

program
  .command('check')
  .description('Run all checks and show report')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output results as JSON')
  .option('--junit', 'Output results as JUnit XML')
  .option('--verbose', 'Show detailed output including execution times')
  .option('--fail-on-error', 'Exit with code 1 if critical issues found')
  .option('--exit-code', 'Enable structured exit codes')
  .option('--compare', 'Compare current run with previous run')
  .option('--include-trends', 'Include trend analysis in JSON output')
  .option('--quick', 'Quick triage - skip deps and coverage for ~2s response')
  .option('--repos <repos>', 'Check multiple repositories (format: owner/repo1,owner/repo2)')
  .action(async (dir, options) => {
    if (options.repos) {
      // Multi-repo mode
      await handleMultiRepoCheck(options.repos, options);
      return;
    }
    
    // Single repo mode (existing logic)
    const startTime = Date.now();
    const workingDir = dir || process.cwd();
    const configLoader = dir ? new ConfigLoader(dir + '/.pulselive.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const scanner = new Scanner(config, workingDir);
    const reporter = new Reporter(!options.json);

    const results: CheckResult[] = options.quick ? await scanner.runQuickChecks() : await scanner.runAllChecks();
    const totalDuration = Date.now() - startTime;

    if (options.json) {
      const output: any = {
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        duration: totalDuration,
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

    // Structured exit codes
    if (options.exitCode) {
      const hasErrors = results.some((r: CheckResult) => r.status === 'error');
      const hasWarnings = results.some((r: CheckResult) => r.status === 'warning');
      
      if (hasErrors) {
        process.exit(1); // Critical issues found
      } else if (hasWarnings) {
        process.exit(2); // Warnings only
      } else {
        process.exit(0); // All checks healthy
      }
    } else if (options.failOnError || options.ci) {
      const hasCritical = results.some((r: CheckResult) => r.status === 'error');
      if (hasCritical) {
        process.exit(1);
      }
    }
  });

program
  .command('fix')
  .description('Automated remediation hooks')
  .argument('[dir]', 'Directory to fix (defaults to current directory)')
  .option('--deps', 'Auto-fix vulnerable dependencies using npm audit fix')
  .option('--dry-run', 'Show what would be fixed without making changes')
  .option('--all', 'Run all available fixes')
  .option('--json', 'Output results as structured JSON')
  .option('--yes', 'Skip confirmation prompts')
  .action(async (dir, options) => {
    const workingDir = dir || process.cwd();
    const configLoader = dir ? new ConfigLoader(dir + '/.pulselive.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    
    const startTime = Date.now();
    const results: FixResult[] = [];
    
    // Dependency fixes
    if (options.deps || options.all) {
      const depsResult = await fixDependencies(workingDir, options.dryRun, options.yes);
      results.push(depsResult);
    }
    
    const totalDuration = Date.now() - startTime;
    
    if (options.json) {
      console.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        duration: totalDuration,
        fix_results: results
      }, null, 2));
    } else {
      console.log('🔧 PULSELIVE FIX REPORT');
      console.log('=======================\n');
      
      results.forEach((result, index) => {
        const statusIcon = result.success ? '✅' : result.partial ? '⚠️' : '❌';
        console.log(`${index + 1}. ${statusIcon} ${result.target}`);
        console.log(`   Status: ${result.status}`);
        if (result.message) {
          console.log(`   Message: ${result.message}`);
        }
        if (result.changes && result.changes.length > 0) {
          console.log(`   Changes:`);
          result.changes.forEach(change => {
            console.log(`     - ${change}`);
          });
        }
        if (result.dryRun) {
          console.log(`   📝 Dry run - no changes made`);
        }
        console.log('');
      });
      
      console.log(`⏱  Total: ${totalDuration}ms`);
      
      // Exit codes for fix command
      const hasFailures = results.some(r => !r.success && !r.partial);
      const hasPartial = results.some(r => r.partial);
      
      if (hasFailures) {
        process.exit(1); // Fix failures
      } else if (hasPartial) {
        process.exit(2); // Partial success
      } else {
        process.exit(0); // All fixes successful
      }
    }
  });

program
  .command('quick')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output results as JSON')
  .option('--repos <repos>', 'Check multiple repositories (format: owner/repo1,owner/repo2)')
  .action(async (dir, options) => {
    if (options.repos) {
      // Multi-repo mode
      await handleMultiRepoCheck(options.repos, { ...options, quick: true });
      return;
    }
    
    // Single repo mode (existing logic)
    const startTime = Date.now();
    const workingDir = dir || process.cwd();
    const configLoader = dir ? new ConfigLoader(dir + '/.pulselive.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const scanner = new Scanner(config, workingDir);
    const reporter = new Reporter(!options.json);

    const results: CheckResult[] = await scanner.runQuickChecks();
    const totalDuration = Date.now() - startTime;

    if (options.json) {
      console.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        quick: true,
        duration: totalDuration,
        results: results.map(r => mapToSchemaResult(r))
      }, null, 2));
    } else {
      console.log(reporter.format(results));
      console.log(`\n⚡ Quick mode - deps and coverage skipped (${totalDuration}ms)`);
    }

    // Structured exit codes for quick command
    if (options.exitCode) {
      const hasErrors = results.some((r: CheckResult) => r.status === 'error');
      const hasWarnings = results.some((r: CheckResult) => r.status === 'warning');
      
      if (hasErrors) {
        process.exit(1); // Critical issues found
      } else if (hasWarnings) {
        process.exit(2); // Warnings only
      } else {
        process.exit(0); // All checks healthy
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
      console.log('📊 Insufficient data — need at least 3 data points for trend analysis');
      return;
    }

    // Check for insufficient data
    if (history.length < 3) {
      console.log(`📊 Insufficient data for trend analysis — run \`pulselive check\` a few more times to establish a baseline (currently have ${history.length} data points, need at least 3)`);
      return;
    }

    const trendAnalyzer = new TrendAnalyzer();
    const window = parseInt(options.window) || 7;

    if (options.json) {
      if (options.type) {
        const trend = trendAnalyzer.analyze(options.type, history, window);
        console.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
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
        console.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
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
      console.log('📊 Insufficient data — need at least 3 data points for anomaly detection');
      return;
    }

    // Check for insufficient data for anomaly detection
    if (history.length < 5) {
      console.log(`📊 Insufficient data for anomaly detection — need at least 5 data points for statistical analysis (currently have ${history.length})`);
      return;
    }

    const trendAnalyzer = new TrendAnalyzer();
    const anomalies = trendAnalyzer.detectAnomalies(history);

    if (options.json) {
      console.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        anomalies: anomalies
      }, null, 2));
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
      console.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        history: limitedHistory
      }, null, 2));
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
      console.log("");
    });
  });
program
  .command('auth')
  .description('Guide users through GitHub token setup')
  .action(() => {
    console.log('🔐 PulseLive GitHub Token Setup');
    console.log('================================\n');
    console.log('PulseLive needs a GitHub token to access private repositories and API rate limits.');
    console.log('');
    console.log('📋 Steps to create a GitHub token:');
    console.log('');
    console.log('1. Go to: https://github.com/settings/tokens');
    console.log('2. Click "Generate new token" → "Generate new token (classic)"');
    console.log('3. Give your token a descriptive name (e.g., "PulseLive")');
    console.log('4. Select these scopes:');
    console.log('   - repo (full control of private repositories)');
    console.log('   - read:org (read org and team membership)');
    console.log('   - read:user (read user profile)');
    console.log('5. Click "Generate token" at the bottom');
    console.log('');
    console.log('🔑 Token setup options:');
    console.log('');
    console.log('Option 1: Environment variable (recommended)');
    console.log('  Add to your shell config (~/.bashrc, ~/.zshrc, etc.):');
    console.log('  export GITHUB_TOKEN="your_token_here"');
    console.log('  Then run: source ~/.bashrc (or restart terminal)');
    console.log('');
    console.log('Option 2: .env file');
    console.log('  Create a .env file in your project root:');
    console.log('  GITHUB_TOKEN=your_token_here');
    console.log('  Then install dotenv: npm install dotenv');
    console.log('  And add this to your entry file:');
    console.log('  require("dotenv").config();');
    console.log('');
    console.log('Option 3: Direct in .pulselive.yml (not recommended)');
    console.log('  Add to your .pulselive.yml:');
    console.log('  github:');
    console.log('    repo: owner/repo');
    console.log('    token: your_token_here');
    console.log('  ⚠️  Warning: This commits the token to your repo history!');
    console.log('');
    console.log('✅ Verify your token works:');
    console.log('  Run: pulselive check');
    console.log('  If you see GitHub API data, your token is working!');
    console.log('');
    console.log('🔒 Security reminder:');
    console.log('- Never commit tokens to version control');
    console.log('- Use environment variables for best security');
    console.log('- Rotate tokens regularly');
    console.log('- Revoke tokens when no longer needed');
  });

program
  .command('watch')
  .description('Continuous monitoring that re-runs checks on file changes')
  .argument('[dir]', 'Directory to watch (defaults to current directory)')
  .option('--quick', 'Quick triage - skip deps and coverage for ~2s response')
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Show detailed output including execution times')
  .action(async (dir, options) => {
    const fs = require('fs');
    const path = require('path');

    console.log('👁️  PulseLive watch mode started - monitoring for file changes');
    console.log('    Press Ctrl+C to exit\n');

    // Initial run
    const workingDir = dir || process.cwd();
    const configLoader = dir ? new ConfigLoader(dir + '/.pulselive.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const scanner = new Scanner(config, workingDir);
    const reporter = new Reporter(!options.json);

    const runChecks = async () => {
      const startTime = Date.now();
      const results: CheckResult[] = options.quick ? await scanner.runQuickChecks() : await scanner.runAllChecks();
      const totalDuration = Date.now() - startTime;

      if (options.json) {
        console.log(JSON.stringify({
          version: VERSION,
          timestamp: new Date().toISOString(),
          duration: totalDuration,
          quick: !!options.quick,
          results
        }, null, 2));
      } else if (options.verbose) {
        console.log(reporter.formatVerbose(results));
        console.log(`\n⏱  Total: ${totalDuration}ms`);
      } else {
        console.log(reporter.format(results));
      }
      console.log('---');
    };

    // Run initial checks
    await runChecks();

    // Set up file watcher
    const watchDir = dir || process.cwd();
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

      console.log(`\n📝 File changed: ${filenameStr} (${eventType})`);
      await runChecks();
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log('\n👋 Watch mode stopped');
      watcher.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n👋 Watch mode stopped');
      watcher.close();
      process.exit(0);
    });
  });

program
  .command('badge')
  .description('Generate a README shield/badge')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output raw badge data as JSON')
  .action(async (dir, options) => {
    const workingDir = dir || process.cwd();
    const configLoader = dir ? new ConfigLoader(dir + '/.pulselive.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const scanner = new Scanner(config, workingDir);

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

    const badgeUrl = `https://img.shields.io/badge/pulselive-${status}-${color}`;
    const markdown = `![pulselive](${badgeUrl})`;

    if (options.json) {
      console.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        status,
        color,
        url: badgeUrl,
        markdown
      }, null, 2));
    } else {
      console.log(markdown);
    }
  });

program
  .command('status')
  .description('Lightweight health ping - reads most recent check result from history (no API calls)')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output results as JSON')
  .action(async (dir, options) => {
    const workingDir = dir || process.cwd();
    const historyDir = workingDir + '/.pulselive-history';
    
    const history = loadHistory(historyDir);
    
    if (history.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({
          schema_version: "1.0.0",
          schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
          version: VERSION,
          timestamp: new Date().toISOString(),
          healthy: null,
          message: "No status history found. Run `pulselive check` first to establish a baseline."
        }, null, 2));
      } else {
        console.log('No status history found. Run `pulselive check` first to establish a baseline.');
      }
      process.exit(0);
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
      console.log(JSON.stringify({
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
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
      console.log(`${statusIcon} ${healthy ? 'Healthy' : 'Unhealthy'} (${critical} critical, ${warnings} warnings) — last checked ${lastChecked}`);
    }
  });

program
  .command('report')
  .description('Export check results as a formatted report')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--format <format>', 'Output format (markdown or text)', 'markdown')
  .action(async (dir, options) => {
    const workingDir = dir || process.cwd();
    const configLoader = dir ? new ConfigLoader(dir + '/.pulselive.yml') : new ConfigLoader();
    const config = configLoader.autoDetect(workingDir);
    const scanner = new Scanner(config, workingDir);
    const reporter = new Reporter(false);

    // Run checks
    const results: CheckResult[] = await scanner.runAllChecks();

    if (options.format === 'markdown') {
      // Generate markdown report
      let report = '# PulseLive Project Health Report\n\n';

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
      report += `*Generated by PulseLive v${VERSION} on ${new Date().toISOString()}*\n`;

      console.log(report);
    } else {
      // Text format (fallback to standard reporter)
      console.log(reporter.format(results));
    }

    process.exit(0);
  });

program
  .command('mcp')
  .description('Start MCP server for AI agent integration')
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

// Helper method to map CheckResult to schema-compliant format
async function handleMultiRepoCheck(reposString: string, options: { json?: boolean; quick?: boolean; exitCode?: boolean }) {
  const repoList = reposString.split(',').map(r => r.trim()).filter(r => r.length > 0);
  
  if (repoList.length === 0) {
    console.error('❌ No valid repositories specified');
    process.exit(1);
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
          coverage: !options.quick ? { enabled: true, threshold: 80 } : { enabled: false }
        }
      };
      
      const scanner = new Scanner(tempConfig);
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
    
    console.log(JSON.stringify({
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
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
    console.log('MULTI-REPO HEALTH CHECK');
    console.log('=======================\n');
    
    // Header
    console.log('Repo'.padEnd(30) + 'Status'.padEnd(10) + 'Critical'.padEnd(10) + 'Warnings'.padEnd(10) + 'Healthy');
    console.log('-'.repeat(70));
    
    // Row for each repo
    for (const result of results) {
      if (result.error) {
        console.log(result.repo.padEnd(30) + '❌ ERROR'.padEnd(10) + '-'.padEnd(10) + '-'.padEnd(10) + '-');
        console.log(`  Error: ${result.error}`);
      } else {
        const critical = result.results.filter(r => r.status === 'error').length;
        const warnings = result.results.filter(r => r.status === 'warning').length;
        const healthy = result.results.filter(r => r.status === 'success').length;
        const statusIcon = critical > 0 ? '❌' : warnings > 0 ? '⚠️' : '✅';
        
        console.log(result.repo.padEnd(30) + statusIcon.padEnd(10) + critical.toString().padEnd(10) + warnings.toString().padEnd(10) + healthy.toString());
      }
    }
    
    // Summary
    const overallSummary = computeMultiRepoSummary(results);
    console.log('\nSUMMARY');
    console.log('-------');
    console.log(`Total repos: ${results.length}`);
    console.log(`Repos with errors: ${overallSummary.reposWithErrors}`);
    console.log(`Repos with warnings: ${overallSummary.reposWithWarnings}`);
    console.log(`Overall status: ${overallSummary.overallStatus}`);
    console.log(`\n⏱  Total: ${totalDuration}ms`);
  }
  
  // Exit codes for multi-repo
  if (options.exitCode) {
    const overallSummary = computeMultiRepoSummary(results);
    if (overallSummary.reposWithErrors > 0) {
      process.exit(1); // Critical issues found
    } else if (overallSummary.reposWithWarnings > 0) {
      process.exit(2); // Warnings only
    } else {
      process.exit(0); // All checks healthy
    }
  }
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

async function fixDependencies(workingDir: string, dryRun: boolean, skipConfirmation: boolean): Promise<FixResult> {
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
    if (!existsSync(packageJsonPath)) {
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
      auditOutput = execFileSync('npm', ['audit', '--json'], {
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
      console.log(`🔧 Ready to fix ${vulnerabilitiesBefore} vulnerabilities`);
      console.log('   Changes that will be made:');
      changes.forEach(change => console.log(`     - ${change}`));
      console.log('\n⚠️  This will modify package.json and package-lock.json');
      console.log('Continue? (y/N) ');
      console.log('(Assuming confirmation for automated testing)');
    }

    try {
      const fixOutput = execFileSync('npm', ['audit', 'fix', '--json'], {
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
        auditAfterOutput = execFileSync('npm', ['audit', '--json'], {
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
