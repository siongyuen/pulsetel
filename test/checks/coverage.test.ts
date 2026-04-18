import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoverageCheck } from '../../src/checks/coverage';
import { PulseliveConfig } from '../../src/config';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';

describe('CoverageCheck', () => {
  let coverageCheck: CoverageCheck;
  let config: PulseliveConfig;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(process.cwd(), 'test-coverage');
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
    
    config = {
      checks: {
        coverage: {
          enabled: true,
          threshold: 80
        }
      }
    };
    
    // Don't change directory - use absolute paths instead
  });

  it('should return warning when no coverage reports found', async () => {
    coverageCheck = new CoverageCheck(config);
    const result = await coverageCheck.run();
    
    expect(result.type).toBe('coverage');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('No coverage reports found');
  });

  it('should parse Istanbul coverage summary', async () => {
    // Create coverage directory in current working directory
    const coverageDir = path.join(process.cwd(), 'coverage');
    if (existsSync(coverageDir)) {
      rmSync(coverageDir, { recursive: true });
    }
    mkdirSync(coverageDir, { recursive: true });
    
    const coverageSummary = {
      total: {
        lines: 85.5,
        statements: 90.2,
        functions: 78.3,
        branches: 82.1
      }
    };
    
    writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify(coverageSummary)
    );
    
    coverageCheck = new CoverageCheck(config);
    const result = await coverageCheck.run();
    
    expect(result.type).toBe('coverage');
    expect(result.status).toBe('success'); // 85.5% > 80% threshold
    expect(result.message).toContain('Coverage:');
    expect(result.message).toContain('80%');
    
    // Clean up
    rmSync(coverageDir, { recursive: true });
  });

  it('should return warning when coverage below threshold', async () => {
    // Create coverage directory in current working directory
    const coverageDir = path.join(process.cwd(), 'coverage');
    if (existsSync(coverageDir)) {
      rmSync(coverageDir, { recursive: true });
    }
    mkdirSync(coverageDir, { recursive: true });
    
    const coverageSummary = {
      total: {
        lines: 75.5,
        statements: 78.2,
        functions: 70.3,
        branches: 72.1
      }
    };
    
    writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify(coverageSummary)
    );
    
    coverageCheck = new CoverageCheck(config);
    const result = await coverageCheck.run();
    
    expect(result.type).toBe('coverage');
    expect(result.status).toBe('warning'); // 75.5% < 80% threshold but > 60%
    expect(result.message).toContain('Coverage:');
    
    // Clean up
    rmSync(coverageDir, { recursive: true });
  });

  it('should return error when coverage very low', async () => {
    // Create coverage directory in current working directory
    const coverageDir = path.join(process.cwd(), 'coverage');
    if (existsSync(coverageDir)) {
      rmSync(coverageDir, { recursive: true });
    }
    mkdirSync(coverageDir, { recursive: true });
    
    const coverageSummary = {
      total: {
        lines: 55.5,
        statements: 58.2,
        functions: 50.3,
        branches: 52.1
      }
    };
    
    writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify(coverageSummary)
    );
    
    coverageCheck = new CoverageCheck(config);
    const result = await coverageCheck.run();
    
    expect(result.type).toBe('coverage');
    expect(result.status).toBe('error'); // 55.5% < 60%
    expect(result.message).toContain('Coverage:');
    
    // Clean up
    rmSync(coverageDir, { recursive: true });
  });

  it('should use default threshold when not configured', async () => {
    const configNoThreshold = {
      checks: {
        coverage: {
          enabled: true
          // No threshold specified
        }
      }
    };
    
    // Create coverage directory in current working directory
    const coverageDir = path.join(process.cwd(), 'coverage');
    if (existsSync(coverageDir)) {
      rmSync(coverageDir, { recursive: true });
    }
    mkdirSync(coverageDir, { recursive: true });
    
    const coverageSummary = {
      total: {
        lines: 75.5,
        statements: 78.2,
        functions: 70.3,
        branches: 72.1
      }
    };
    
    writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify(coverageSummary)
    );
    
    coverageCheck = new CoverageCheck(configNoThreshold);
    const result = await coverageCheck.run();
    
    expect(result.type).toBe('coverage');
    expect(result.status).toBe('warning'); // 75.5% < 80% default threshold
    
    // Clean up
    rmSync(coverageDir, { recursive: true });
  });
});