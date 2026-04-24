import { describe, it, expect, vi } from 'vitest';
import { MCPServer } from '../src/mcp-server';
import { ConfigLoader } from '../src/config';
import { CheckResult } from '../src/scanner';
import { HistoryEntry } from '../src/trends';

describe('pulsetel_gate', () => {
  const createMockScanner = (results: CheckResult[]) => ({
    runAllChecks: vi.fn().mockResolvedValue(results),
    runQuickChecks: vi.fn(),
    runSingleCheck: vi.fn(),
  });

  const createMockDeps = (scannerResults: CheckResult[]) => ({
    createScanner: vi.fn().mockReturnValue(createMockScanner(scannerResults)),
    createConfigLoader: vi.fn().mockReturnValue(new ConfigLoader()),
  });

  const createHistory = (results: CheckResult[]): HistoryEntry[] => [{
    timestamp: new Date().toISOString(),
    version: '2.4.0',
    duration: 1000,
    results
  }];

  it('should return proceed when no issues detected', async () => {
    const currentResults: CheckResult[] = [
      { type: 'health', status: 'success', message: 'endpoint ok' },
      { type: 'deps', status: 'success', message: 'deps ok' },
      { type: 'ci', status: 'success', message: 'ci passing' },
      { type: 'coverage', status: 'success', message: 'coverage good' }
    ];

    const server = new MCPServer(
      new ConfigLoader(),
      3000,
      createMockDeps(currentResults)
    );

    const result = await server.handleToolRequest('pulsetel_gate', process.cwd());

    expect(result.decision).toBe('proceed');
    expect(result.blockingIssues).toHaveLength(0);
    expect(result.proceedConditions).toHaveLength(0);
    expect(result.patterns).toBeDefined();
  });

  it('should return block when dependency cascade detected', async () => {
    const currentResults: CheckResult[] = [
      { type: 'health', status: 'success', message: 'endpoint ok' },
      { type: 'deps', status: 'error', message: 'vulnerabilities found' },
      { type: 'ci', status: 'error', message: 'ci failing' },
      { type: 'coverage', status: 'warning', message: 'coverage dropped' }
    ];

    const server = new MCPServer(
      new ConfigLoader(),
      3000,
      createMockDeps(currentResults)
    );

    const result = await server.handleToolRequest('pulsetel_gate', process.cwd());

    expect(result.decision).toBe('block');
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should include schema version and timestamp', async () => {
    const currentResults: CheckResult[] = [
      { type: 'health', status: 'success', message: 'ok' }
    ];

    const server = new MCPServer(
      new ConfigLoader(),
      3000,
      createMockDeps(currentResults)
    );

    const result = await server.handleToolRequest('pulsetel_gate', process.cwd());

    expect(result.schema_version).toBe('1.0.0');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.version).toBeDefined();
  });
});
