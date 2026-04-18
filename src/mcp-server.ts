import { Scanner, CheckResult } from './scanner';
import { ConfigLoader } from './config';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

export class MCPServer {
  private scanner: Scanner;
  private server: Server | null = null;
  private port: number;

  constructor(private configLoader: ConfigLoader, port: number = 3000) {
    this.port = port;
    const config = configLoader.autoDetect();
    this.scanner = new Scanner(config);
  }

  start(): void {
    this.server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const tool = url.searchParams.get('tool');

        if (!tool) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing tool parameter' }));
          return;
        }

        const result = await this.handleToolRequest(tool);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.server.listen(this.port, () => {
      const address = this.server?.address() as AddressInfo;
      console.log(`MCP Server started on port ${address.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private async handleToolRequest(tool: string): Promise<any> {
    switch (tool) {
      case 'pulselive_check':
        return this.pulseliveCheck();
      case 'pulselive_ci':
        return this.pulseliveCi();
      case 'pulselive_health':
        return this.pulseliveHealth();
      case 'pulselive_deps':
        return this.pulseliveDeps();
      case 'pulselive_summary':
        return this.pulseliveSummary();
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async pulseliveCheck(): Promise<any> {
    const results = await this.scanner.runAllChecks();
    return this.formatResults(results);
  }

  private async pulseliveCi(): Promise<any> {
    const result = await this.scanner.runSingleCheck('ci');
    return this.formatSingleResult(result);
  }

  private async pulseliveHealth(): Promise<any> {
    const result = await this.scanner.runSingleCheck('health');
    return this.formatSingleResult(result);
  }

  private async pulseliveDeps(): Promise<any> {
    const result = await this.scanner.runSingleCheck('deps');
    return this.formatSingleResult(result);
  }

  private async pulseliveSummary(): Promise<any> {
    const results = await this.scanner.runAllChecks();
    const criticalCount = results.filter(r => r.status === 'error').length;
    const warningCount = results.filter(r => r.status === 'warning').length;
    
    return {
      critical: criticalCount,
      warnings: warningCount,
      totalChecks: results.length
    };
  }

  private formatResults(results: CheckResult[]): any {
    return results.map(result => ({
      type: result.type,
      status: result.status,
      message: result.message,
      details: result.details
    }));
  }

  private formatSingleResult(result: CheckResult): any {
    return {
      type: result.type,
      status: result.status,
      message: result.message,
      details: result.details
    };
  }
}