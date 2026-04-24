import { MCPServer, MCPDeps } from '../src/mcp-server.js';
import { ConfigLoader } from '../src/config.js';
import { Scanner, CheckResult } from '../src/scanner.js';
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';

describe('PulseTel Integration Test - Correlation Engine', () => {
  const testProjectDir = path.resolve(__dirname, '../tmp/pulsetel-test-project');

  beforeAll(() => {
    // Create test project directory if it doesn't exist
    if (!existsSync(testProjectDir)) {
      mkdirSync(testProjectDir, { recursive: true });

      // Create package.json with outdated dependencies
      writeFileSync(
        path.join(testProjectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'pulsetel-test-project',
            version: '1.0.0',
            description: 'Test project for PulseTel integration testing',
            main: 'index.js',
            scripts: {
              test: "echo 'Tests failing!' \u0026\u0026 exit 1",
              build: "echo 'Build failing!' \u0026\u0026 exit 1",
            },
            dependencies: {
              lodash: '4.17.15',
              express: '4.16.0',
              axios: '0.19.0',
            },
            devDependencies: {
              jest: '26.0.0',
            },
          },
          null,
          2
        )
      );

      // Create pulsetel config
      writeFileSync(
        path.join(testProjectDir, '.pulsetel.yml'),
        `github:
  repo: siongyuen/pulsetel-test-project
health:
  allow_local: true
  endpoints:
    - name: Healthy Endpoint
      url: http://localhost:8765/health
      timeout: 3000
      baseline: 100
    - name: Slow Endpoint
      url: http://localhost:8765/slow
      timeout: 3000
      baseline: 500
    - name: Failing Endpoint
      url: http://localhost:8765/error
      timeout: 3000
      baseline: 100
    - name: Unavailable Endpoint
      url: http://localhost:8765/unavailable
      timeout: 3000
      baseline: 100
checks:
  ci: true
  deps: true
  git: true
  health: true
  issues: true
  deploy: false
webhooks: []
`
      );

      // Create a dummy file for git uncommitted detection
      writeFileSync(path.join(testProjectDir, 'uncommitted.txt'), 'test');
    }
  });

  it('should detect issues in test project', async () => {
    // Verify test project exists
    expect(existsSync(testProjectDir)).toBe(true);
    expect(existsSync(path.join(testProjectDir, 'package.json'))).toBe(true);

    // Load config from test project
    const configLoader = new ConfigLoader(path.join(testProjectDir, '.pulsetel.yml'));
    const config = configLoader.getConfig();

    expect(config).toBeDefined();
    expect(config.health).toBeDefined();
    expect(config.health?.endpoints?.length).toBeGreaterThanOrEqual(2);
  });

  it('should run pulsetel_correlate and detect correlation patterns', async () => {
    // Create config loader for test project
    const configLoader = new ConfigLoader(path.join(testProjectDir, '.pulsetel.yml'));

    // Create mock scanner that returns realistic results for pattern detection
    const mockResults: CheckResult[] = [
      {
        type: 'deps',
        status: 'error',
        severity: 'critical',
        confidence: 'high',
        message: '5 vulnerabilities found',
        actionable: 'Run npm audit fix to address vulnerabilities',
        context: 'Outdated or vulnerable dependencies are security and stability risks',
        duration: 913,
        details: {
          vulnerabilities: { critical: 2, high: 1, medium: 2, low: 0 },
          outdated: 8
        }
      },
      {
        type: 'ci',
        status: 'error',
        severity: 'critical',
        confidence: 'high',
        message: 'CI pipeline failing',
        actionable: 'Check CI workflow logs — resolve build/test failures before merging',
        context: 'CI status gates merges and deployments',
        duration: 2729,
        details: {
          flakinessScore: 45.2,
          recentRuns: [
            { status: 'failure', duration: 120000 },
            { status: 'failure', duration: 115000 },
            { status: 'success', duration: 95000 }
          ]
        }
      },
      {
        type: 'coverage',
        status: 'warning',
        severity: 'medium',
        confidence: 'high',
        message: 'Coverage at 68.5% (below 80% threshold)',
        actionable: 'Coverage below threshold — add tests for uncovered paths',
        context: 'Low coverage means untested code paths and higher regression risk',
        duration: 1455,
        details: { percentage: 68.5, threshold: 80 }
      },
      {
        type: 'health',
        status: 'success',
        severity: 'low',
        confidence: 'high',
        message: 'All endpoints healthy',
        actionable: 'No action needed',
        context: 'Endpoints are healthy',
        duration: 100
      }
    ];

    // Create mock scanner
    const mockScanner = {
      runAllChecks: async () => mockResults,
      runSingleCheck: async (type: string) => mockResults.find(r => r.type === type) || mockResults[0]
    } as unknown as Scanner;

    // Create MCPDeps with mock scanner factory
    const mockDeps: MCPDeps = {
      createScanner: () => mockScanner,
      createConfigLoader: (configPath?: string) => new ConfigLoader(configPath)
    };

    const server = new MCPServer(configLoader, 3000, mockDeps);

    // Call pulsetel_correlate
    const result = await server.handleToolRequest('pulsetel_correlate');

    // Verify correlation patterns detected
    expect(result).toBeDefined();
    expect(result.patterns).toBeDefined();
    expect(Array.isArray(result.patterns)).toBe(true);
    expect(result.patternCount).toBeGreaterThanOrEqual(0);

    // Should detect dependency_cascade pattern (deps error + ci error + coverage warning)
    const hasDependencyCascade = result.patterns.some((p: any) => p.pattern === 'dependency_cascade');
    expect(hasDependencyCascade).toBe(true);

    if (hasDependencyCascade) {
      const pattern = result.patterns.find((p: any) => p.pattern === 'dependency_cascade');
      expect(pattern.causalChain).toEqual(['deps', 'ci', 'coverage']);
      expect(pattern.actionable).toContain('Dependency changes caused CI failures');
      expect(pattern.blastRadius).toBe('high');
      expect(pattern.confidence).toBeGreaterThan(0.7);
    }
  });

  it('should run pulsetel_gate and make ship decision', async () => {
    const configLoader = new ConfigLoader(path.join(testProjectDir, '.pulsetel.yml'));

    // Create mock scanner with critical issues
    const mockResults: CheckResult[] = [
      {
        type: 'deps',
        status: 'error',
        severity: 'critical',
        confidence: 'high',
        message: 'Critical vulnerabilities found',
        actionable: 'Run npm audit fix to address vulnerabilities',
        context: 'Outdated or vulnerable dependencies are security and stability risks',
        duration: 913,
        details: {
          vulnerabilities: { critical: 5, high: 3, medium: 2, low: 0 },
          outdated: 15
        }
      },
      {
        type: 'ci',
        status: 'error',
        severity: 'critical',
        confidence: 'high',
        message: 'CI pipeline failing',
        actionable: 'Check CI workflow logs — resolve build/test failures before merging',
        context: 'CI status gates merges and deployments',
        duration: 2729,
        details: { flakinessScore: 65.8 }
      }
    ];

    const mockScanner = {
      runAllChecks: async () => mockResults,
      runSingleCheck: async (type: string) => mockResults[0]
    } as unknown as Scanner;

    const mockDeps: MCPDeps = {
      createScanner: () => mockScanner,
      createConfigLoader: (configPath?: string) => new ConfigLoader(configPath)
    };

    const server = new MCPServer(configLoader, 3000, mockDeps);
    const result = await server.handleToolRequest('pulsetel_gate');

    // Should block due to critical issues
    expect(result.decision).toBe('block');
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain('dependency_cascade');
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});
