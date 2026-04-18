import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../src/scanner';
import { PulseliveConfig } from '../src/config';

// Mock the check classes
vi.mock('../src/checks/ci', () => ({
  CICheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'ci',
      status: 'success',
      message: 'CI check passed'
    });
  }
}));

vi.mock('../src/checks/deploy', () => ({
  DeployCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'deploy',
      status: 'success',
      message: 'Deploy check passed'
    });
  }
}));

vi.mock('../src/checks/health', () => ({
  HealthCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'health',
      status: 'success',
      message: 'Health check passed'
    });
  }
}));

vi.mock('../src/checks/git', () => ({
  GitCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'git',
      status: 'success',
      message: 'Git check passed'
    });
  }
}));

vi.mock('../src/checks/issues', () => ({
  IssuesCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'issues',
      status: 'success',
      message: 'Issues check passed'
    });
  }
}));

vi.mock('../src/checks/deps', () => ({
  DepsCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'deps',
      status: 'success',
      message: 'Dependencies check passed'
    });
  }
}));

describe('Scanner', () => {
  let scanner: Scanner;
  let config: PulseliveConfig;

  beforeEach(() => {
    config = {
      checks: {
        ci: true,
        deploy: true,
        health: true,
        git: true,
        issues: true,
        deps: true
      }
    };
    scanner = new Scanner(config);
  });

  it('should run all checks when all are enabled', async () => {
    const results = await scanner.runAllChecks();
    
    expect(results).toHaveLength(6);
    expect(results.some(r => r.type === 'ci')).toBe(true);
    expect(results.some(r => r.type === 'deploy')).toBe(true);
    expect(results.some(r => r.type === 'health')).toBe(true);
    expect(results.some(r => r.type === 'git')).toBe(true);
    expect(results.some(r => r.type === 'issues')).toBe(true);
    expect(results.some(r => r.type === 'deps')).toBe(true);
  });

  it('should skip disabled checks', async () => {
    config.checks = {
      ci: false,
      deploy: false,
      health: true,
      git: true,
      issues: false,
      deps: false
    };
    scanner = new Scanner(config);
    
    const results = await scanner.runAllChecks();
    
    expect(results).toHaveLength(2);
    expect(results.some(r => r.type === 'health')).toBe(true);
    expect(results.some(r => r.type === 'git')).toBe(true);
  });

  it('should run single check', async () => {
    const result = await scanner.runSingleCheck('ci');
    
    expect(result.type).toBe('ci');
    expect(result.status).toBe('success');
  });

  it('should throw error for unknown check type', async () => {
    await expect(scanner.runSingleCheck('unknown' as any)).rejects.toThrow('Unknown check type: unknown');
  });
});