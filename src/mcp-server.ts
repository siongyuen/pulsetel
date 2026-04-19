import { Scanner, CheckResult } from './scanner';
import { ConfigLoader } from './config';
import { TrendAnalyzer, HistoryEntry } from './trends';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { resolve, normalize } from 'path';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { VERSION } from './version';
import { PulseliveConfig } from './config';

import { VALID_TOOLS, validateDir, getRequiredParamsForTool, statusToSeverity, enrichResult, errorActionable, warningActionable, trendActionable, trendContext, anomalyActionable, anomalyContext, computeSummary, computeOverallTrend } from './mcp-helpers';

// MCP usage telemetry
interface MCPUsageEntry {
  tool: string;
  timestamp: string;
  duration: number;
  status: 'success' | 'error';
}

export class MCPServer {
  private configLoader: ConfigLoader;
  private server: Server | null = null;
  private port: number;

  constructor(configLoader: ConfigLoader, port: number = 3000) {
    this.configLoader = configLoader;
    this.port = port;
  }

  private getScanner(dir?: string): Scanner {
    if (dir) {
      const safeDir = this.validateDir(dir);
      const dirConfigLoader = new ConfigLoader(safeDir + '/.pulselive.yml');
      const config = dirConfigLoader.autoDetect();
      return new Scanner(config);
    }
    const config = this.configLoader.autoDetect();
    return new Scanner(config);
  }

  private validateDir(dir: string): string {
    return validateDir(dir);
  }

  private getRequiredParamsForTool(tool: string): string[] {
    return getRequiredParamsForTool(tool);
  }

  start(): void {
    this.server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const toolStartTime = Date.now();

      try {
        // Parse request parameters from either query string (GET) or JSON body (POST)
        let tool: string | null = null;
        let dir: string | undefined = undefined;
        let includeTrends: boolean = false;
        let checkType: string | undefined = undefined;
        let window: number = 7;

        if (req.method === 'POST') {
          // Parse JSON body for POST requests
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            const bodyChunks: Buffer[] = [];
            for await (const chunk of req) {
              bodyChunks.push(chunk);
            }
            const body = Buffer.concat(bodyChunks).toString('utf8');
            try {
              const jsonBody = JSON.parse(body);
              tool = jsonBody.tool;
              dir = jsonBody.dir;
              includeTrends = jsonBody.include_trends === true;
              checkType = jsonBody.check_type;
              window = parseInt(jsonBody.window) || 7;
            } catch (parseError) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON body' }));
              this.logMCPUsage('unknown', toolStartTime, 'error');
              return;
            }
          } else {
            res.writeHead(415, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unsupported Media Type - expected application/json' }));
            this.logMCPUsage('unknown', toolStartTime, 'error');
            return;
          }
        } else if (req.method === 'GET') {
          // Parse query parameters for GET requests (backward compatibility)
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          tool = url.searchParams.get('tool');
          dir = url.searchParams.get('dir') || undefined;
          includeTrends = url.searchParams.get('include_trends') === 'true';
          checkType = url.searchParams.get('check_type') || undefined;
          window = parseInt(url.searchParams.get('window') || '7') || 7;
        } else {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method Not Allowed - use GET or POST' }));
          this.logMCPUsage('unknown', toolStartTime, 'error');
          return;
        }

        if (!tool) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required parameter: tool' }));
          this.logMCPUsage('unknown', toolStartTime, 'error');
          return;
        }

        if (!VALID_TOOLS.includes(tool)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown tool' }));
          this.logMCPUsage(tool, toolStartTime, 'error');
          return;
        }

        // Validate required parameters for each tool
        const requiredParams = this.getRequiredParamsForTool(tool);
        for (const param of requiredParams) {
          if (param === 'dir' && !dir) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Missing required parameter 'dir' for tool '${tool}'` }));
            this.logMCPUsage(tool, toolStartTime, 'error');
            return;
          }
        }

        const result = await this.handleToolRequest(tool, dir, { includeTrends, checkType, window });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        this.logMCPUsage(tool, toolStartTime, 'success');
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
        this.logMCPUsage('unknown', toolStartTime, 'error');
      }
    });

    this.tryStartServer();
  }

  private tryStartServer(attempt: number = 0): void {
    const portsToTry = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];
    const portToTry = portsToTry[attempt] || this.port;

    if (!this.server) {
      console.error('Server instance not created');
      return;
    }

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        if (attempt < portsToTry.length - 1) {
          console.warn(`Port ${portToTry} is in use, trying port ${portsToTry[attempt + 1]}...`);
          this.tryStartServer(attempt + 1);
        } else {
          console.error(`All ports from 3000-3010 are in use. Cannot start MCP server.`);
          process.exit(1);
        }
      } else {
        console.error(`Failed to start server on port ${portToTry}:`, error.message);
        process.exit(1);
      }
    });

    this.server.listen(portToTry, () => {
      const address = this.server?.address() as AddressInfo;
      console.log(`PulseLive MCP Server v${VERSION} on port ${address.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async handleToolRequest(tool: string, dir?: string, params?: {
    includeTrends?: boolean;
    checkType?: string;
    window?: number;
    repos?: string;
  }): Promise<any> {
    const scanner = this.getScanner(dir);
    const history = this.loadHistory();
    const trendAnalyzer = new TrendAnalyzer();

    switch (tool) {
      case 'pulselive_check':
        if (params?.repos) {
          return this.pulseliveMultiRepoCheck(params.repos, false, params.includeTrends);
        }
        return this.pulseliveCheck(scanner, history, trendAnalyzer, params?.includeTrends);
      case 'pulselive_quick':
        if (params?.repos) {
          return this.pulseliveMultiRepoCheck(params.repos, true, false);
        }
        return this.pulseliveQuick(scanner, history, trendAnalyzer);
      case 'pulselive_ci':
        return this.pulseliveSingle(scanner, 'ci', history, trendAnalyzer);
      case 'pulselive_health':
        return this.pulseliveSingle(scanner, 'health', history, trendAnalyzer);
      case 'pulselive_deps':
        return this.pulseliveSingle(scanner, 'deps', history, trendAnalyzer);
      case 'pulselive_summary':
        return this.pulseliveSummary(scanner, history, trendAnalyzer);
      case 'pulselive_trends':
        return this.pulseliveTrends(history, trendAnalyzer, params?.checkType, params?.window);
      case 'pulselive_anomalies':
        return this.pulseliveAnomalies(history, trendAnalyzer);
      case 'pulselive_metrics':
        return this.pulseliveMetrics(history, trendAnalyzer, params?.checkType);
      case 'pulselive_status':
        return this.pulseliveStatus(dir);
      default:
        throw new Error('Unknown tool');
    }
  }

  // ── Tool Implementations (agent-first: structured, actionable, severity, context) ──

  private async pulseliveCheck(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer,
    includeTrends?: boolean
  ): Promise<any> {
    const results = await scanner.runAllChecks();
    const items = results.map(r => this.enrichResult(r));

    const response: any = {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      results: items,
      summary: this.computeSummary(results)
    };

    if (includeTrends && history.length > 0) {
      const checkTypes = new Set<string>();
      history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
      results.forEach(r => checkTypes.add(r.type));
      const trends: any = {};
      for (const ct of checkTypes) {
        trends[ct] = trendAnalyzer.analyze(ct, history);
      }
      response.trends = trends;
      response.anomalies = trendAnalyzer.detectAnomalies(history);
    }

    return response;
  }

  /**
   * Quick triage — fast checks only (skips deps/coverage).
   * Returns in ~1-2s instead of ~8-12s for full check.
   * Skipped checks are included as warning placeholders.
   */
  private async pulseliveQuick(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const startTime = Date.now();
    const results = await scanner.runQuickChecks();
    const items = results.map(r => this.enrichResult(r));

    const response: any = {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      quick: true,
      duration: Date.now() - startTime,
      results: items,
      summary: {
        ...this.computeSummary(results),
        note: 'Quick mode — deps and coverage skipped for speed. Run pulselive_check for full results.'
      }
    };

    if (history.length > 0) {
      const checkTypes = new Set<string>();
      history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
      results.forEach(r => checkTypes.add(r.type));
      const trends: any = {};
      for (const ct of checkTypes) {
        trends[ct] = trendAnalyzer.analyze(ct, history);
      }
      response.trends = trends;
      response.anomalies = trendAnalyzer.detectAnomalies(history);
    }

    return response;
  }

  private async pulseliveSingle(
    scanner: Scanner,
    type: string,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const result = await scanner.runSingleCheck(type);
    const enriched = this.enrichResult(result);

    // Include trend if history available
    if (history.length > 0) {
      const trend = trendAnalyzer.analyze(type, history);
      (enriched as any).trend = trend;
    }

    return {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
      ...enriched
    };
  }

  private async pulseliveSummary(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const results = await scanner.runAllChecks();
    const summary = this.computeSummary(results);

    // Add top anomalies if available
    if (history.length > 0) {
      const anomalies = trendAnalyzer.detectAnomalies(history);
      summary.topAnomalies = anomalies.slice(0, 5);
      summary.overallTrend = this.computeOverallTrend(results, history, trendAnalyzer);
    }

    return {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      ...summary
    };
  }

  private pulseliveTrends(
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer,
    checkType?: string,
    window: number = 7
  ): any {
    if (history.length === 0) {
      return { available: false, reason: 'no_history', actionable: 'Run pulselive check to build history' };
    }

    if (checkType) {
      const trend = trendAnalyzer.analyze(checkType, history, window);
      return {
        available: true,
        window,
        ...trend,
        actionable: this.trendActionable(checkType, trend),
        context: this.trendContext(checkType, trend)
      };
    }

    const checkTypes = new Set<string>();
    history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
    const trends: any = {};
    for (const ct of checkTypes) {
      const trend = trendAnalyzer.analyze(ct, history, window);
      trends[ct] = {
        ...trend,
        actionable: this.trendActionable(ct, trend),
        context: this.trendContext(ct, trend)
      };
    }
    return { available: true, window, trends };
  }

  private pulseliveAnomalies(history: HistoryEntry[], trendAnalyzer: TrendAnalyzer): any {
    if (history.length === 0) {
      return { available: false, anomalies: [], actionable: 'Run pulselive check to build history' };
    }

    const anomalies = trendAnalyzer.detectAnomalies(history);
    return {
      available: true,
      count: anomalies.length,
      anomalies: anomalies.map(a => ({
        ...a,
        actionable: this.anomalyActionable(a),
        context: this.anomalyContext(a)
      }))
    };
  }

  private pulseliveMetrics(
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer,
    checkType?: string
  ): any {
    if (history.length === 0) {
      return { available: false, actionable: 'Run pulselive check to build history' };
    }

    if (checkType) {
      const trend = trendAnalyzer.analyze(checkType, history);
      const metricHistory = history
        .map(e => {
          const r = e.results.find(r => r.type === checkType);
          return r ? { timestamp: e.timestamp, status: r.status, metrics: r.metrics, duration: r.duration } : null;
        })
        .filter(Boolean);

      return {
        available: true,
        checkType,
        trend,
        history: metricHistory,
        actionable: this.trendActionable(checkType, trend),
        context: this.trendContext(checkType, trend)
      };
    }

    // All check types
    const checkTypes = new Set<string>();
    history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
    const metrics: any = {};
    for (const ct of checkTypes) {
      const trend = trendAnalyzer.analyze(ct, history);
      metrics[ct] = {
        trend,
        latest: history[0]?.results.find(r => r.type === ct) || null
      };
    }
    return { available: true, metrics };
  }

  private async pulseliveStatus(
    historyDir: string = '.pulselive-history'
  ): Promise<any> {
    const history = this.loadHistory(historyDir);
    
    if (history.length === 0) {
      return {
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        healthy: null,
        message: "No history available. Run pulselive check first to establish baseline."
      };
    }
    
    // Sort by timestamp (newest first)
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const latestRun = history[0];
    
    const startTime = Date.now();
    const critical = latestRun.results.filter(r => r.status === 'error').length;
    const warnings = latestRun.results.filter(r => r.status === 'warning').length;
    const healthy = critical === 0;
    const totalDuration = Date.now() - startTime;
    
    return {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      healthy: healthy,
      critical: critical,
      warnings: warnings,
      last_check: latestRun.timestamp,
    };
  }

  // ── pulselive_multi_repo: multi-repository checks ───

  private async pulseliveMultiRepoCheck(
    reposString: string,
    quick: boolean,
    includeTrends?: boolean
  ): Promise<any> {
    const repoList = reposString.split(',').map(r => r.trim()).filter(r => r.length > 0);
    
    if (repoList.length === 0) {
      throw new Error('No valid repositories specified');
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
            deps: !quick,
            git: true,
            health: true,
            issues: true,
            prs: true,
            deploy: true,
            coverage: !quick ? { enabled: true, threshold: 80 } : { enabled: false }
          }
        };
        
        const scanner = new Scanner(tempConfig);
        const checkResults: CheckResult[] = quick 
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
    const overallSummary = this.computeMultiRepoSummary(results);
    
    const response: any = {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      duration: totalDuration,
      quick: quick,
      repos: results.map(r => ({
        repo: r.repo,
        results: r.results.map(check => this.enrichResult(check)),
        error: r.error
      })),
      summary: overallSummary
    };
    
    if (includeTrends && results.length > 0 && results[0].results.length > 0) {
      // Include trend analysis if requested and available
      const history = this.loadHistory();
      if (history.length > 0) {
        const trendAnalyzer = new TrendAnalyzer();
        const checkTypes = new Set<string>();
        results.forEach(repoResult => {
          repoResult.results.forEach(r => checkTypes.add(r.type));
        });
        const trends: any = {};
        for (const ct of checkTypes) {
          trends[ct] = trendAnalyzer.analyze(ct, history);
        }
        response.trends = trends;
        response.anomalies = trendAnalyzer.detectAnomalies(history);
      }
    }
    
    return response;
  }

  private computeMultiRepoSummary(results: Array<{ repo: string; results: CheckResult[]; error?: string }>): any {
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

  // ── pulselive_recommend: prioritised actionable recommendations ───

  private async pulseliveRecommend(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const results = await scanner.runAllChecks();
    const recommendations: Array<{
      rank: number;
      checkType: string;
      severity: 'critical' | 'warning' | 'info';
      confidence: 'high' | 'medium' | 'low';
      title: string;
      actionable: string;
      context: string;
    }> = [];

    let rank = 1;

    // Anomalies from history
    if (history.length > 0) {
      const anomalies = trendAnalyzer.detectAnomalies(history);
      for (const a of anomalies) {
        recommendations.push({
          rank: rank++,
          checkType: a.checkType,
          severity: a.severity === 'high' ? 'critical' : 'warning',
          confidence: a.zScore > 3 ? 'high' : 'medium',
          title: `Anomaly in ${a.checkType}: ${a.metric}`,
          actionable: this.anomalyActionable(a),
          context: this.anomalyContext(a)
        });
      }
    }

    // Degrading trends
    if (history.length > 0) {
      const checkTypes = new Set<string>();
      history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
      for (const ct of checkTypes) {
        const trend = trendAnalyzer.analyze(ct, history);
        if (trend.direction === 'degrading') {
          recommendations.push({
            rank: rank++,
            checkType: ct,
            severity: 'warning',
            confidence: 'medium',
            title: `${ct} trend degrading`,
            actionable: this.trendActionable(ct, trend),
            context: this.trendContext(ct, trend)
          });
        }
      }
    }

    // Warnings
    for (const r of results) {
      if (r.status === 'warning') {
        recommendations.push({
          rank: rank++,
          checkType: r.type,
          severity: 'warning',
          confidence: 'high',
          title: `${r.type}: ${r.message}`,
          actionable: this.warningActionable(r),
          context: `Warning reported during ${r.type} check`
        });
      }
    }

    return {
      version: VERSION,
      timestamp: new Date().toISOString(),
      totalRecommendations: recommendations.length,
      recommendations
    };
  }

  // ── Enrichment: add actionable, severity, context, confidence to every result ──

  private enrichResult(result: CheckResult): any {
    return enrichResult(result);
  }

  // ── Actionable/Context generators ──

  private statusToSeverity(status: string): 'critical' | 'warning' | 'info' {
    return statusToSeverity(status);
  }

  private errorActionable(r: CheckResult): string {
    return errorActionable(r);
  }

  private warningActionable(r: CheckResult): string {
    return warningActionable(r);
  }

  private trendActionable(checkType: string, trend: any): string {
    return trendActionable(checkType, trend);
  }

  private trendContext(checkType: string, trend: any): string {
    return trendContext(checkType, trend);
  }

  private anomalyActionable(anomaly: any): string {
    return anomalyActionable(anomaly);
  }

  private anomalyContext(anomaly: any): string {
    return anomalyContext(anomaly);
  }

  // ── Summary helpers ──

  private computeSummary(results: CheckResult[]): any {
    return computeSummary(results);
  }

  private computeOverallTrend(results: CheckResult[], history: HistoryEntry[], trendAnalyzer: TrendAnalyzer): any {
    return computeOverallTrend(results, history, trendAnalyzer);
  }

  // ── MCP self-telemetry ──

  private logMCPUsage(tool: string, startTime: number, status: 'success' | 'error'): void {
    try {
      const historyDir = '.pulselive-history';
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true });
      }

      const entry: MCPUsageEntry = {
        tool,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        status
      };

      const usagePath = `${historyDir}/mcp-usage.json`;
      let usage: MCPUsageEntry[] = [];
      if (existsSync(usagePath)) {
        try {
          usage = JSON.parse(readFileSync(usagePath, 'utf8'));
        } catch { /* corrupted, start fresh */ }
      }

      usage.push(entry);
      // Keep last 1000 entries
      if (usage.length > 1000) usage = usage.slice(-1000);

      writeFileSync(usagePath, JSON.stringify(usage, null, 2));
    } catch {
      // Silent — telemetry is best-effort
    }
  }

  private loadHistory(historyDir: string = '.pulselive-history'): HistoryEntry[] {
    try {
      if (!existsSync(historyDir)) {
        return [];
      }

      const files = readdirSync(historyDir);
      const history: HistoryEntry[] = [];

      for (const file of files) {
        if (file.startsWith('run-') && file.endsWith('.json')) {
          const content = readFileSync(`${historyDir}/${file}`, 'utf8');
          history.push(JSON.parse(content));
        }
      }

      return history;
    } catch {
      return [];
    }
  }
}