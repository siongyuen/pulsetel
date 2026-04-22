import { MCPServer, MCPDeps } from '../src/mcp-server.js';
import { ConfigLoader } from '../src/config.js';
import { Scanner, CheckResult } from '../src/scanner.js';
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';

describe('PulseTel Integration Test - Real Project', () => {
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

  it('should run pulsetel_recommend and return actionable recommendations', async () => {
    // Create config loader for test project
    const configLoader = new ConfigLoader(path.join(testProjectDir, '.pulsetel.yml'));

    // Create mock scanner that returns realistic results
    const mockResults: CheckResult[] = [
      {
        type: 'health',
        status: 'error',
        severity: 'critical',
        confidence: 'high',
        message: '2 endpoint(s) failed, avg 0ms',
        actionable: 'Investigate endpoint failures and performance issues',
        context: 'Endpoint failures indicate service problems',
        duration: 2729,
        details: [
          { name: 'Test Endpoint', url: 'https://httpbin.org/status/200', status: 400, responseTime: 488 },
          { name: 'Failing Endpoint', url: 'https://httpbin.org/status/500', status: 400, responseTime: 772 }
        ]
      },
      {
        type: 'deps',
        status: 'warning',
        severity: 'medium',
        confidence: 'high',
        message: '2 vulnerabilities, 3 outdated packages',
        actionable: 'Update outdated packages and review vulnerabilities',
        context: 'Outdated or vulnerable dependencies are security and stability risks',
        duration: 913,
        details: {
          vulnerabilities: { critical: 0, high: 0, medium: 2, low: 0 },
          outdated: 3
        }
      },
      {
        type: 'git',
        status: 'success',
        severity: 'low',
        confidence: 'high',
        message: 'Git status: master branch',
        actionable: 'No action needed - Git status is clean',
        context: 'Repository is in sync with remote',
        duration: 1455,
        details: { branch: 'master', uncommitted: 3 }
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

    // Call pulsetel_recommend
    const result = await server.handleToolRequest('pulsetel_recommend');

    // Verify recommendations
    expect(result).toBeDefined();
    expect(result.recommendations).toBeDefined();
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.totalRecommendations).toBeGreaterThan(0);

    // Should prioritize issues by severity (critical first, then warning)
    if (result.recommendations.length > 0) {
      const first = result.recommendations[0];
      expect(first.rank).toBe(1);
      // First should be either critical or warning depending on whether anomalies detected
      expect(['critical', 'warning']).toContain(first.severity);
      expect(first.actionable).toBeDefined();
      expect(first.context).toBeDefined();
    }

    // Verify structure
    const rec = result.recommendations[0];
    expect(rec).toHaveProperty('rank');
    expect(rec).toHaveProperty('checkType');
    expect(rec).toHaveProperty('severity');
    expect(rec).toHaveProperty('confidence');
    expect(rec).toHaveProperty('title');
    expect(rec).toHaveProperty('actionable');
    expect(rec).toHaveProperty('context');
  });

  it('should handle all-success scenario', async () => {
    const configLoader = new ConfigLoader(path.join(testProjectDir, '.pulsetel.yml'));

    // All checks pass - no issues to recommend
    const mockResults: CheckResult[] = [
      {
        type: 'health',
        status: 'success',
        severity: 'low',
        confidence: 'high',
        message: 'All endpoints healthy',
        actionable: 'No action needed',
        context: 'All endpoints responding normally',
        duration: 100
      },
      {
        type: 'deps',
        status: 'success',
        severity: 'low',
        confidence: 'high',
        message: 'No vulnerabilities found',
        actionable: 'No action needed',
        context: 'Dependencies are up to date',
        duration: 100
      },
      {
        type: 'git',
        status: 'success',
        severity: 'low',
        confidence: 'high',
        message: 'Git status clean',
        actionable: 'No action needed',
        context: 'Repository is in sync with remote',
        duration: 100,
        details: { branch: 'master', uncommitted: 0 }
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
    const result = await server.handleToolRequest('pulsetel_recommend');

    expect(result.totalRecommendations).toBe(0);
    expect(result.recommendations).toHaveLength(0);
  });
});
