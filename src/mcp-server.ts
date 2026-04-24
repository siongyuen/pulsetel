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

import { authenticateRequest, parseAuthConfig, AuthConfig } from './auth';
import { atomicWriteJsonSync, safeReadJsonSync } from './atomic-io';

// MCP usage telemetry
interface MCPUsageEntry {
  tool: string;
  timestamp: string;
  duration: number;
  status: 'success' | 'error';
}

const MAX_REQUEST_BODY_SIZE = 1024 * 1024; // 1MB
const DEFAULT_CHECK_TIMEOUT_MS = 30000; // 30 seconds per check

export interface MCPDeps {
  createScanner: (config: PulseliveConfig, dir?: string) => Scanner;
  createConfigLoader: (configPath?: string) => ConfigLoader;
}

export const defaultMCPDeps: MCPDeps = {
  createScanner: (config) => new Scanner(config),
  createConfigLoader: (configPath?) => configPath ? new ConfigLoader(configPath) : new ConfigLoader(),
};

export class MCPServer {
  private configLoader: ConfigLoader;
  private server: Server | null = null;
  private port: number;
  private mcpDeps: MCPDeps;
  private authConfig: AuthConfig;

  constructor(configLoader: ConfigLoader, port: number = 3000, deps: MCPDeps = defaultMCPDeps) {
    this.configLoader = configLoader;
    this.port = port;
    this.mcpDeps = deps;
    this.authConfig = parseAuthConfig(configLoader.getConfig());
  }

  getScanner(dir?: string): Scanner {
    if (dir) {
      const safeDir = this.validateDir(dir);
      const dirConfigLoader = this.mcpDeps.createConfigLoader(safeDir + '/.pulsetel.yml');
      const config = dirConfigLoader.autoDetect();
      return this.mcpDeps.createScanner(config, dir);
    }
    const config = this.configLoader.autoDetect();
    return this.mcpDeps.createScanner(config);
  }

  private validateDir(dir: string): string {
    return validateDir(dir);
  }

  private getRequiredParamsForTool(tool: string): string[] {
    return getRequiredParamsForTool(tool);
  }

  start(): void {
    this.server = createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Authentication check
      const authResult = authenticateRequest(req.headers, this.authConfig);
      if (!authResult.authenticated) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: authResult.error || 'Unauthorized' }));
        return;
      }

      // Request body size limit for POST requests
      if (req.method === 'POST') {
        const contentLength = parseInt(req.headers['content-length'] || '0');
        if (contentLength > MAX_REQUEST_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
      }

      const toolStartTime = Date.now();

      try {
        // Parse request parameters from either query string (GET) or JSON body (POST)
        let tool: string | null = null;
        let dir: string | undefined = undefined;
        let includeTrends: boolean = false;
        let checkType: string | undefined = undefined;
        let window: number = 7;
        let format: string = 'summary';

        if (req.method === 'POST') {
          // Parse JSON body for POST requests
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            const bodyChunks: Buffer[] = [];
            let bodySize = 0;
            for await (const chunk of req) {
              bodySize += chunk.length;
              if (bodySize > MAX_REQUEST_BODY_SIZE) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Request body too large' }));
                this.logMCPUsage('unknown', toolStartTime, 'error');
                return;
              }
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
              format = jsonBody.format || 'summary';
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
          format = url.searchParams.get('format') || 'summary';
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

        const result = await this.handleToolRequest(tool, dir, { includeTrends, checkType, window, format });
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
      console.log(`PulseTel MCP Server v${VERSION} on port ${address.port}`);
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
    format?: string;
    history?: HistoryEntry[];
  }): Promise<any> {
    const scanner = this.getScanner(dir);
    const history = this.loadHistory();
    const trendAnalyzer = new TrendAnalyzer();

    switch (tool) {
      case 'pulsetel_check':
        if (params?.repos) {
          return this.pulsetelMultiRepoCheck(params.repos, false, params.includeTrends);
        }
        return this.pulsetelCheck(scanner, history, trendAnalyzer, params?.includeTrends, params?.format === 'compact');
      case 'pulsetel_quick':
        if (params?.repos) {
          return this.pulsetelMultiRepoCheck(params.repos, true, false);
        }
        return this.pulsetelQuick(scanner, history, trendAnalyzer);
      case 'pulsetel_ci':
        return this.pulsetelSingle(scanner, 'ci', history, trendAnalyzer);
      case 'pulsetel_health':
        return this.pulsetelSingle(scanner, 'health', history, trendAnalyzer);
      case 'pulsetel_deps':
        return this.pulsetelSingle(scanner, 'deps', history, trendAnalyzer);
      case 'pulsetel_summary':
        return this.pulsetelSummary(scanner, history, trendAnalyzer);
      case 'pulsetel_trends':
        return this.pulsetelTrends(history, trendAnalyzer, params?.checkType, params?.window);
      case 'pulsetel_anomalies':
        return this.pulsetelAnomalies(history, trendAnalyzer);
      case 'pulsetel_metrics':
        return this.pulsetelMetrics(history, trendAnalyzer, params?.checkType);
      case 'pulsetel_telemetry':
        return this.pulsetelTelemetry(params?.format);
      case 'pulsetel_status':
        return this.pulsetelStatus();
      case 'pulsetel_correlate':
        return this.pulsetelCorrelate(scanner, history, trendAnalyzer);
      case 'pulsetel_gate':
        return this.pulsetelGate(scanner, history, trendAnalyzer);
      case 'pulsetel_sentry':
        return this.pulsetelSentry(scanner);
      case 'pulsetel_multi_repo':
        if (params?.repos) {
          return this.pulsetelMultiRepoCheck(params.repos, false, params?.includeTrends);
        }
        throw new Error('Missing required parameter: repos');
      default:
        throw new Error('Unknown tool');
    }
  }

  // ── Tool Implementations (agent-first: structured, actionable, severity, context) ──

  private async pulsetelCheck(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer,
    includeTrends?: boolean,
    compact?: boolean
  ): Promise<any> {
    const results = await scanner.runAllChecks();
    
    // Compact mode: minimal fields
    const items = compact 
      ? results.map(r => ({
          type: r.type,
          status: r.status,
          severity: statusToSeverity(r.status),
          message: r.message,
          actionable: r.status === 'error' 
            ? errorActionable(r)
            : r.status === 'warning'
              ? warningActionable(r)
              : 'No action needed'
        }))
      : results.map(r => this.enrichResult(r));

    const response: any = {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      results: items,
      summary: this.computeSummary(results)
    };

    if (compact) {
      response.compact = true;
    }

    if (!compact && includeTrends && history.length > 0) {
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
  private async pulsetelQuick(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const startTime = Date.now();
    const results = await scanner.runQuickChecks();
    const items = results.map(r => this.enrichResult(r));

    const response: any = {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      quick: true,
      duration: Date.now() - startTime,
      results: items,
      summary: {
        ...this.computeSummary(results),
        note: 'Quick mode — deps and coverage skipped for speed. Run pulsetel_check for full results.'
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

  private async pulsetelSingle(
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
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      ...enriched
    };
  }

  private async pulsetelSummary(
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
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      ...summary
    };
  }

  private pulsetelTrends(
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer,
    checkType?: string,
    window: number = 7
  ): any {
    if (history.length === 0) {
      return { available: false, reason: 'no_history', actionable: 'Run pulsetel check to build history' };
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

  private pulsetelAnomalies(history: HistoryEntry[], trendAnalyzer: TrendAnalyzer): any {
    if (history.length === 0) {
      return { available: false, anomalies: [], actionable: 'Run pulsetel check to build history' };
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

  private pulsetelMetrics(
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer,
    checkType?: string
  ): any {
    if (history.length === 0) {
      return { available: false, actionable: 'Run pulsetel check to build history' };
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

  private pulsetelTelemetry(format: string = 'summary'): any {
    // Check if OTel is available
    let otelAvailable = false;
    let otelConfig = null;
    
    try {
      const { isOtelAvailable } = require('./otel');
      otelAvailable = isOtelAvailable();
      
      // Get config to extract OTel settings
      const configLoader = new ConfigLoader();
      const config = configLoader.getConfig();
      otelConfig = config.otel || {};
    } catch (error) {
      // OTel module not available or error loading
      otelAvailable = false;
    }

    if (format === 'summary') {
      return {
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        otel_available: otelAvailable,
        otel_enabled: otelConfig?.enabled === true,
        otel_protocol: otelConfig?.protocol || 'http',
        otel_service_name: otelConfig?.service_name || 'pulsetel',
        otel_endpoint: otelConfig?.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'
      };
    } else {
      // Full format
      return {
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        otel: {
          available: otelAvailable,
          enabled: otelConfig?.enabled === true,
          protocol: otelConfig?.protocol || 'http',
          service_name: otelConfig?.service_name || 'pulsetel',
          endpoint: otelConfig?.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
          export_dir: otelConfig?.export_dir || normalize(process.cwd() + '/.pulsetel/otel'),
          last_export: otelAvailable ? 'Recent export completed' : 'Not available',
          status: otelAvailable ? (otelConfig?.enabled === true ? 'active' : 'disabled') : 'not_installed'
        }
      };
    }
  }

  private async pulsetelStatus(
    historyDir: string = '.pulsetel-history'
  ): Promise<any> {
    const history = this.loadHistory(historyDir);
    
    if (history.length === 0) {
      return {
        schema_version: "1.0.0",
        schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
        version: VERSION,
        timestamp: new Date().toISOString(),
        healthy: null,
        message: "No history available. Run pulsetel check first to establish baseline."
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
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      healthy: healthy,
      critical: critical,
      warnings: warnings,
      last_check: latestRun.timestamp,
    };
  }

  /**
   * Verify — re-run checks and compare against previous run.
   * Returns delta showing what improved, worsened, or stayed the same.
   */
  private async pulsetelVerify(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const startTime = Date.now();
    
    // Run current checks
    const currentResults = await scanner.runAllChecks();
    const currentItems = currentResults.map(r => this.enrichResult(r));
    
    // Find previous run for comparison
    const previousRun = history.length > 0 ? history[0] : null;
    const previousResults = previousRun?.results || [];
    
    // Compute delta
    const delta = this.computeDelta(currentResults, previousResults);
    
    return {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      previous_check: previousRun?.timestamp || null,
      current: {
        results: currentItems,
        summary: this.computeSummary(currentResults)
      },
      delta,
      recommendations: delta.improved.length > 0 
        ? `✅ ${delta.improved.length} check(s) improved` 
        : delta.worsened.length > 0 
          ? `⚠️ ${delta.worsened.length} check(s) worsened` 
          : '✓ No change'
    };
  }

  private computeDelta(current: CheckResult[], previous: CheckResult[]): any {
    const improved: any[] = [];
    const worsened: any[] = [];
    const unchanged: any[] = [];
    
    for (const currentResult of current) {
      const prevResult = previous.find(r => r.type === currentResult.type);
      
      if (!prevResult) {
        // New check type not in previous run
        unchanged.push({
          type: currentResult.type,
          status: currentResult.status,
          message: 'New check — no previous data'
        });
        continue;
      }
      
      const statusOrder = ['error', 'warning', 'success'];
      const currentIdx = statusOrder.indexOf(currentResult.status);
      const prevIdx = statusOrder.indexOf(prevResult.status);
      
      if (currentIdx > prevIdx) {
        improved.push({
          type: currentResult.type,
          from: prevResult.status,
          to: currentResult.status,
          message: `${currentResult.type}: ${prevResult.status} → ${currentResult.status}`
        });
      } else if (currentIdx < prevIdx) {
        worsened.push({
          type: currentResult.type,
          from: prevResult.status,
          to: currentResult.status,
          message: `${currentResult.type}: ${prevResult.status} → ${currentResult.status}`
        });
      } else {
        unchanged.push({
          type: currentResult.type,
          status: currentResult.status,
          message: 'No change'
        });
      }
    }
    
    return { improved, worsened, unchanged };
  }

  // ── pulsetel_multi_repo: multi-repository checks ───

  private async pulsetelMultiRepoCheck(
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
        
        const scanner = this.mcpDeps.createScanner(tempConfig);
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
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
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

  // ── pulsetel_sentry: Sentry error tracking ───

  private async pulsetelSentry(scanner: Scanner): Promise<any> {
    const result = await scanner.runSingleCheck('sentry');
    return enrichResult(result);
  }

  // ── pulsetel_correlate: cross-signal correlation ───

  private async pulsetelCorrelate(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const { CorrelationEngine } = await import('./correlate.js');
    const correlationEngine = new CorrelationEngine();
    
    const results = await scanner.runAllChecks();
    const patterns = correlationEngine.detectPatterns(results, history);
    
    return {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      patterns,
      patternCount: patterns.length,
      hasBlockingIssues: patterns.some(p => ['dependency_cascade', 'security_scan_gap', 'deploy_regression'].includes(p.pattern))
    };
  }

  // ── pulsetel_gate: ship gate decision ───

  private async pulsetelGate(
    scanner: Scanner,
    history: HistoryEntry[],
    trendAnalyzer: TrendAnalyzer
  ): Promise<any> {
    const { CorrelationEngine } = await import('./correlate.js');
    const correlationEngine = new CorrelationEngine();
    
    const results = await scanner.runAllChecks();
    const patterns = correlationEngine.detectPatterns(results, history);
    const decision = correlationEngine.makeShipDecision(patterns);
    
    return {
      schema_version: "1.0.0",
      schema_url: "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
      version: VERSION,
      timestamp: new Date().toISOString(),
      decision: decision.decision,
      blockingIssues: decision.blockingIssues,
      proceedConditions: decision.proceedConditions,
      confidence: decision.confidence,
      patterns: patterns.map(p => ({
        pattern: p.pattern,
        confidence: p.confidence,
        actionable: p.actionable
      }))
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
      const historyDir = '.pulsetel-history';
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

  loadHistory(historyDir: string = '.pulsetel-history'): HistoryEntry[] {
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