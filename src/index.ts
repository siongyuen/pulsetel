#!/usr/bin/env node

import { Command } from 'commander';
import { ConfigLoader } from './config';
import { Scanner, CheckResult } from './scanner';
import { Reporter } from './reporter';
import { MCPServer } from './mcp-server';
import { MCPStdioServer } from './mcp-stdio';
import { TrendAnalyzer, HistoryEntry } from './trends';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import yaml from 'yaml';
import path from 'path';
import os from 'os';

import { VERSION } from './version';
import { PulseliveConfig } from './config';
import { 
  mapToSchemaResult, 
  extractMetricsFromResult, 
  formatTimeAgo, 
  compareWithPrevious, 
  getTrendIcon, 
  computeMultiRepoSummary, 
  loadHistory, 
  saveHistory, 
  FixResult, 
  handleMultiRepoCheck, 
  fixDependencies,
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
  handleQuickExitCodes
} from './cli-helpers';
import { CLIHandlers } from './cli-handlers';

const program = new Command();

program
  .name('pulsetel')
  .description('Real-time project telemetry for AI agents')
  .version(VERSION);

// Create CLI handlers instance
const cliHandlers = new CLIHandlers();

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
  .option('--otel', 'Enable OpenTelemetry export for this run')
  .action(async (dir, options) => {
    await cliHandlers.handleCheckCommand(dir, options);
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
    await cliHandlers.handleFixCommand(dir, options);
  });

program
  .command('quick')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output results as JSON')
  .option('--repos <repos>', 'Check multiple repositories (format: owner/repo1,owner/repo2)')
  .option('--otel', 'Enable OpenTelemetry export for this run')
  .action(async (dir, options) => {
    await cliHandlers.handleQuickCommand(dir, options);
  });

program
  .command('init')
  .description('Generate .pulsetel.yml configuration file')
  .action(() => {
    cliHandlers.handleInitCommand();
  });

program
  .command('trends')
  .description('Show trend analysis for all check types')
  .option('--type <type>', 'Show trends for a specific check type')
  .option('--window <window>', 'Number of runs to analyze (default: 7)', '7')
  .option('--json', 'Output as structured JSON')
  .action(async (options) => {
    await cliHandlers.handleTrendsCommand(options);
  });

program
  .command('anomalies')
  .description('Show detected anomalies')
  .option('--json', 'Output as structured JSON')
  .action(async (options) => {
    await cliHandlers.handleAnomaliesCommand(options);
  });

program
  .command('history')
  .description('Show history of previous runs')
  .option('--limit <limit>', 'Number of runs to show', '10')
  .option('--json', 'Output as structured JSON')
  .action((options) => {
    cliHandlers.handleHistoryCommand(options);
  });

program
  .command('badge')
  .description('Generate a README shield/badge')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output raw badge data as JSON')
  .action(async (dir, options) => {
    await cliHandlers.handleBadgeCommand(dir, options);
  });

program
  .command('status')
  .description('Lightweight health ping - reads most recent check result from history (no API calls)')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--json', 'Output results as JSON')
  .action(async (dir, options) => {
    await cliHandlers.handleStatusCommand(dir, options);
  });

program
  .command('report')
  .description('Export check results as a formatted report')
  .argument('[dir]', 'Directory to check (defaults to current directory)')
  .option('--format <format>', 'Output format (markdown or text)', 'markdown')
  .action(async (dir, options) => {
    await cliHandlers.handleReportCommand(dir, options);
  });

program
  .command('watch')
  .description('Continuous monitoring that re-runs checks on file changes')
  .argument('[dir]', 'Directory to watch (defaults to current directory)')
  .option('--quick', 'Quick triage - skip deps and coverage for ~2s response')
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Show detailed output including execution times')
  .action(async (dir, options) => {
    await cliHandlers.handleWatchCommand(dir, options);
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

program
  .command('auth')
  .description('Guide users through GitHub token setup')
  .action(() => {
    console.log('🔐 PulseTel GitHub Token Setup');
    console.log('================================\n');
    console.log('PulseTel needs a GitHub token to access private repositories and API rate limits.');
    console.log('');
    console.log('📋 Steps to create a GitHub token:');
    console.log('');
    console.log('1. Go to: https://github.com/settings/tokens');
    console.log('2. Click "Generate new token" → "Generate new token (classic)"');
    console.log('3. Give your token a descriptive name (e.g., "PulseTel")');
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
    console.log('Option 3: Direct in .pulsetel.yml (not recommended)');
    console.log('  Add to your .pulsetel.yml:');
    console.log('  github:');
    console.log('    repo: owner/repo');
    console.log('    token: your_token_here');
    console.log('  ⚠️  Warning: This commits the token to your repo history!');
    console.log('');
    console.log('✅ Verify your token works:');
    console.log('  Run: pulsetel check');
    console.log('  If you see GitHub API data, your token is working!');
    console.log('');
    console.log('🔒 Security reminder:');
    console.log('- Never commit tokens to version control');
    console.log('- Use environment variables for best security');
    console.log('- Rotate tokens regularly');
    console.log('- Revoke tokens when no longer needed');
  });

program.parse(process.argv);