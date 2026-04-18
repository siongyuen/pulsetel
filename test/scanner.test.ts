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

vi.mock('../src/checks/prs', () => ({
  PRsCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'prs',
      status: 'success',
      message: 'PRs check passed'
    });
  }
}));

vi.mock('../src/checks/coverage', () => ({
  CoverageCheck: class {
    run = vi.fn().mockResolvedValue({
      type: 'coverage',
      status: 'success',
      message: 'Coverage check passed'
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
        prs: true,
        deps: true,
        coverage: { enabled: true }
      }
    };
    scanner = new Scanner(config);
  });

  it('should run all checks when all are enabled', async () => {
    const results = await scanner.runAllChecks();
     
    expect(results).toHaveLength(8);
    expect(results.some(r => r.type === 'ci')).toBe(true);
    expect(results.some(r => r.type === 'deploy')).toBe(true);
    expect(results.some(r => r.type === 'health')).toBe(true);
    expect(results.some(r => r.type === 'git')).toBe(true);
    expect(results.some(r => r.type === 'issues')).toBe(true);
    expect(results.some(r => r.type === 'prs')).toBe(true);
    expect(results.some(r => r.type === 'deps')).toBe(true);
    expect(results.some(r => r.type === 'coverage')).toBe(true);
  });

  it('should skip disabled checks', async () => {
    config.checks = {
      ci: false,
      deploy: false,
      health: true,
      git: true,
      issues: false,
      prs: false,
      deps: false
    };
    scanner = new Scanner(config);

    const results = await scanner.runAllChecks();

    expect(results).toHaveLength(3);
    expect(results.some(r => r.type === 'health')).toBe(true);
    expect(results.some(r => r.type === 'git')).toBe(true);
    expect(results.some(r => r.type === 'coverage')).toBe(true);
    expect(results.some(r => r.type === 'prs')).toBe(false);
  });

  it('should run single check', async () => {
    const result = await scanner.runSingleCheck('ci');

    expect(result.type).toBe('ci');
    expect(result.status).toBe('success');
  });

  it('should return error result for unknown check type', async () => {
    const result = await scanner.runSingleCheck('unknown' as any);
    expect(result.type).toBe('unknown');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Unknown check type');
    expect(result.message).toContain('Valid types');
  });

  it('should return warning for disabled check type via runSingleCheck', async () => {
    config.checks = { ci: false };
    scanner = new Scanner(config);
    const result = await scanner.runSingleCheck('ci');
    expect(result.type).toBe('ci');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('disabled');
  });
});