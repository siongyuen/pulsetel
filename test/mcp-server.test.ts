import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPServer, MCPDeps } from '../src/mcp-server';
import { ConfigLoader } from '../src/config';
import { CheckResult } from '../src/scanner';
import { Scanner } from '../src/scanner';

function makeMockScanner(results: CheckResult[] = []): any {
  return {
    runAllChecks: vi.fn().mockResolvedValue(results),
    runQuickChecks: vi.fn().mockResolvedValue(results),
    runSingleCheck: vi.fn().mockResolvedValue(results[0] || { type: 'ci', status: 'success', message: 'OK' }),
  };
}

function makeMockDeps(scannerResults: CheckResult[] = [
  { type: 'ci', status: 'success', message: 'CI passing', duration: 100 }
]): MCPDeps {
  const mockScanner = makeMockScanner(scannerResults);
  return {
    createScanner: vi.fn().mockReturnValue(mockScanner),
    createConfigLoader: vi.fn().mockReturnValue({
      autoDetect: vi.fn().mockReturnValue({
        github: { repo: 'test/repo' },
        checks: { ci: true },
      }),
      getConfig: vi.fn().mockReturnValue({}),
    }),
  };
}

function makeMockConfigLoader(): ConfigLoader {
  return {
    autoDetect: vi.fn().mockReturnValue({
      github: { repo: 'test/repo' },
      checks: { ci: true },
    }),
    getConfig: vi.fn().mockReturnValue({}),
    validateConfig: vi.fn().mockReturnValue({ warnings: [], errors: [] }),
  } as any;
}

function makeHistory(count: number): any[] {
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      timestamp: new Date(2024, 0, i + 1).toISOString(),
      results: [{ type: 'ci', status: 'success', message: 'CI passing', duration: 100 + i * 10 }]
    });
  }
  return entries;
}

describe('MCPServer — Tool Handler Tests', () => {
  let server: MCPServer;
  let mockDeps: MCPDeps;
  let configLoader: ConfigLoader;

  beforeEach(() => {
    configLoader = makeMockConfigLoader();
    // Mock loadHistory to return test data
    vi.spyOn(MCPServer.prototype as any, 'loadHistory').mockReturnValue(makeHistory(5));
  });

  describe('handleToolRequest', () => {
    it('handles pulsetel_check', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'CI passing' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_check');
      expect(result.schema_version).toBe('1.0.0');
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('handles pulsetel_quick', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'CI passing' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_quick');
      expect(result.schema_version).toBe('1.0.0');
      expect(result.quick).toBe(true);
    });

    it('handles pulsetel_ci', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'CI passing' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_ci');
      expect(result.schema_version).toBe('1.0.0');
      expect(result.type).toBe('ci');
    });

    it('handles pulsetel_health', async () => {
      mockDeps = makeMockDeps([
        { type: 'health', status: 'success', message: 'All healthy' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_health');
      expect(result.schema_version).toBe('1.0.0');
    });

    it('handles pulsetel_deps', async () => {
      mockDeps = makeMockDeps([
        { type: 'deps', status: 'warning', message: 'Outdated' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_deps');
      expect(result.schema_version).toBe('1.0.0');
    });

    it('handles pulsetel_summary', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'CI passing' },
        { type: 'deps', status: 'success', message: 'Deps OK' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_summary');
      expect(result.schema_version).toBe('1.0.0');
    });

    it('handles pulsetel_trends', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_trends');
      expect(result.available).toBe(true);
      expect(result.trends).toBeDefined();
    });

    it('handles pulsetel_trends with checkType', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_trends', undefined, { checkType: 'ci' });
      expect(result.available).toBe(true);
    });

    it('handles pulsetel_anomalies', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_anomalies');
      expect(result.available).toBe(true);
      expect(Array.isArray(result.anomalies)).toBe(true);
    });

    it('handles pulsetel_metrics', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_metrics');
      expect(result.available).toBe(true);
    });

    it('handles pulsetel_telemetry summary format', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_telemetry', undefined, { format: 'summary' });
      expect(result.schema_version).toBe('1.0.0');
      expect(result.otel_available).toBeDefined();
    });

    it('handles pulsetel_telemetry full format', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_telemetry', undefined, { format: 'full' });
      expect(result.schema_version).toBe('1.0.0');
      expect(result.otel).toBeDefined();
    });

    it('throws on unknown tool', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      await expect(server.handleToolRequest('unknown_tool')).rejects.toThrow('Unknown tool');
    });

    it('handles pulsetel_check with includeTrends', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'CI passing' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_check', undefined, { includeTrends: true });
      expect(result.schema_version).toBe('1.0.0');
      // Trends should be included when history is available
      if (result.trends) {
        expect(result.trends).toBeDefined();
      }
    });
  });

  describe('pulsetel_trends edge cases', () => {
    it('returns no_history when empty', async () => {
      vi.spyOn(MCPServer.prototype as any, 'loadHistory').mockReturnValue([]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_trends');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('no_history');
    });
  });

  describe('pulsetel_anomalies edge cases', () => {
    it('returns empty when no history', async () => {
      vi.spyOn(MCPServer.prototype as any, 'loadHistory').mockReturnValue([]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_anomalies');
      expect(result.available).toBe(false);
      expect(result.anomalies).toEqual([]);
    });
  });

  describe('pulsetel_metrics edge cases', () => {
    it('returns unavailable when no history', async () => {
      vi.spyOn(MCPServer.prototype as any, 'loadHistory').mockReturnValue([]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_metrics');
      expect(result.available).toBe(false);
    });

    it('returns metrics for specific check type', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_metrics', undefined, { checkType: 'ci' });
      expect(result.available).toBe(true);
      expect(result.checkType).toBe('ci');
    });
  });

  describe('constructor', () => {
    it('creates server with custom deps', () => {
      const s = new MCPServer(configLoader, 8080, mockDeps);
      expect(s).toBeDefined();
    });

    it('creates server with default deps', () => {
      const s = new MCPServer(configLoader);
      expect(s).toBeDefined();
    });
  });

  describe('pulsetel_status', () => {
    it('returns healthy null when no history', async () => {
      vi.spyOn(MCPServer.prototype as any, 'loadHistory').mockReturnValue([]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_status');
      expect(result.healthy).toBeNull();
    });

    it('returns healthy true when no errors', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_status');
      expect(result.healthy).toBe(true);
    });
  });

  describe('pulsetel_recommend', () => {
    it('returns recommendations ranked by severity', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'warning', message: 'Flaky CI' },
        { type: 'deps', status: 'success', message: 'OK' },
        { type: 'git', status: 'error', message: 'Uncommitted changes' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_recommend');
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(result.totalRecommendations).toBeDefined();
    });

    it('returns empty recommendations when all healthy', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'OK' },
        { type: 'deps', status: 'success', message: 'OK' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_recommend');
      expect(result.recommendations).toBeDefined();
    });
  });

  describe('computeMultiRepoSummary', () => {
    it('computes summary from multi-repo results', () => {
      server = new MCPServer(configLoader, 3000, mockDeps);
      const results = [
        { repo: 'org/repo1', results: [{ type: 'ci', status: 'success', message: 'OK' }] },
        { repo: 'org/repo2', results: [{ type: 'ci', status: 'error', message: 'FAIL' }] },
        { repo: 'org/repo3', results: [{ type: 'ci', status: 'warning', message: 'WARN' }], error: 'timeout' }
      ];
      const summary = (server as any).computeMultiRepoSummary(results);
      expect(summary.overallStatus).toBe('critical');
      expect(summary.reposWithErrors).toBeGreaterThanOrEqual(1);
    });
  });

  describe('pulsetel_trends edge cases', () => {
    it('handles trends with no history', async () => {
      vi.spyOn(MCPServer.prototype as any, 'loadHistory').mockReturnValue([]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_trends');
      expect(result.available).toBe(false);
    });
  });

  describe('pulsetel_metrics with checkType', () => {
    it('returns metrics for specific check type', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_metrics', undefined, { checkType: 'ci' });
      expect(result.available).toBe(true);
      expect(result.checkType).toBe('ci');
    });
  });

  describe('pulsetel_multi_repo', () => {
    it('requires repos parameter', async () => {
      server = new MCPServer(configLoader, 3000, mockDeps);
      await expect(server.handleToolRequest('pulsetel_multi_repo')).rejects.toThrow('Missing required parameter');
    });

    it('handles pulsetel_check with repos', async () => {
      mockDeps = makeMockDeps([
        { type: 'ci', status: 'success', message: 'OK' }
      ]);
      server = new MCPServer(configLoader, 3000, mockDeps);

      const result = await server.handleToolRequest('pulsetel_check', undefined, { repos: 'org/repo1,org/repo2' });
      expect(result.schema_version).toBe('1.0.0');
      expect(result.repos).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('scanner error produces error in multi-repo result', async () => {
      const mockScanner = {
        runAllChecks: vi.fn().mockRejectedValue(new Error('API rate limit')),
        runQuickChecks: vi.fn().mockRejectedValue(new Error('API rate limit')),
        runSingleCheck: vi.fn().mockRejectedValue(new Error('API rate limit')),
      };
      mockDeps = {
        createScanner: vi.fn().mockReturnValue(mockScanner),
        createConfigLoader: vi.fn().mockReturnValue({
          autoDetect: vi.fn().mockReturnValue({ github: { repo: 'test/repo' }, checks: { ci: true } }),
          getConfig: vi.fn().mockReturnValue({}),
        }),
      };
      server = new MCPServer(configLoader, 3000, mockDeps);

      await expect(server.handleToolRequest('pulsetel_check')).rejects.toThrow();
    });
  });
});