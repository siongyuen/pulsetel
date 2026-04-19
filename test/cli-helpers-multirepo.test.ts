import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMultiRepoCheck, CLIDeps, defaultCLIDeps } from '../src/cli-helpers';
import { CheckResult } from '../src/scanner';

// Mock Scanner class at the top level
vi.mock('../src/scanner', () => {
  const MockScanner = class {
    constructor(private config: any) {}
    
    async runQuickChecks(): Promise<CheckResult[]> {
      return [
        { type: 'git', status: 'success', message: 'Git status OK', details: {}, duration: 100 },
        { type: 'ci', status: 'success', message: 'CI healthy', details: {}, duration: 100 }
      ];
    }
    
    async runAllChecks(): Promise<CheckResult[]> {
      return [
        { type: 'git', status: 'success', message: 'Git status OK', details: {}, duration: 100 },
        { type: 'ci', status: 'success', message: 'CI healthy', details: {}, duration: 100 },
        { type: 'deps', status: 'success', message: 'Dependencies OK', details: {}, duration: 100 },
        { type: 'coverage', status: 'success', message: 'Coverage OK', details: {}, duration: 100 }
      ];
    }
  };
  
  return { Scanner: MockScanner };
});

describe('handleMultiRepoCheck', () => {
  let mockDeps: CLIDeps;
  let logOutput: any[];
  let errorOutput: any[];
  let exitCode: number | null;

  beforeEach(() => {
    logOutput = [];
    errorOutput = [];
    exitCode = null;
    
    mockDeps = {
      exit: (code: number) => { exitCode = code; },
      log: (...args: any[]) => { logOutput.push(args); },
      error: (...args: any[]) => { errorOutput.push(args); },
      readFile: (p: string) => '',
      writeFile: (p: string, c: string) => {},
      existsSync: (p: string) => false,
      mkdirSync: (p: string, opts?: any) => {},
      execFile: (cmd: string, args: string[], opts: any) => '',
      cwd: () => '/test'
    };
  });

  // ── Validation ───

  describe('validation', () => {
    it('should exit with error when no repositories specified', async () => {
      await handleMultiRepoCheck('', { json: false }, mockDeps);
      
      expect(errorOutput.length).toBeGreaterThan(0);
      expect(errorOutput[0][0]).toContain('No valid repositories specified');
      expect(exitCode).toBe(1);
    });

    it('should exit with error when only whitespace repositories specified', async () => {
      await handleMultiRepoCheck('   ,  ', { json: false }, mockDeps);
      
      expect(errorOutput.length).toBeGreaterThan(0);
      expect(exitCode).toBe(1);
    });
  });

  // ── Single Repository Success ───

  describe('single repository success', () => {
    it('should process single repository successfully', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: false }, mockDeps);
      
      expect(logOutput.some(log => log[0].includes('MULTI-REPO HEALTH CHECK'))).toBe(true);
      expect(logOutput.some(log => log[0].includes('repo1'))).toBe(true);
      expect(logOutput.some(log => log[0].includes('SUMMARY'))).toBe(true);
      expect(exitCode).toBeNull();
    });

    it('should show success status for healthy repository', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: false }, mockDeps);
      
      const repoLine = logOutput.find(log => 
        typeof log[0] === 'string' && 
        log[0].includes('repo1') && 
        !log[0].includes('SUMMARY') && 
        !log[0].includes('MULTI-REPO') && 
        !log[0].includes('-------')
      );
      expect(repoLine).toBeDefined();
      expect(repoLine?.[0]).toContain('✅');
    });
  });

  // ── Multiple Repositories ───

  describe('multiple repositories', () => {
    it('should process multiple repositories', async () => {
      await handleMultiRepoCheck('owner/repo1,owner/repo2', { json: false }, mockDeps);
      
      const repo1Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo1'));
      const repo2Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo2'));
      
      expect(repo1Line).toBeDefined();
      expect(repo2Line).toBeDefined();
    });

    it('should show summary for multiple repositories', async () => {
      await handleMultiRepoCheck('owner/repo1,owner/repo2,owner/repo3', { json: false }, mockDeps);
      
      const summaryLine = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('Total repos: 3'));
      expect(summaryLine).toBeDefined();
    });
  });

  // ── JSON Output ───

  describe('JSON output', () => {
    it('should output valid JSON for single repository', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: true }, mockDeps);
      
      const jsonOutput = logOutput.find(log => {
        try {
          JSON.parse(log[0]);
          return true;
        } catch {
          return false;
        }
      });
      
      expect(jsonOutput).toBeDefined();
      
      const parsed = JSON.parse(jsonOutput?.[0]);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.repos).toHaveLength(1);
      expect(parsed.repos[0].repo).toBe('owner/repo1');
      expect(parsed.summary).toBeDefined();
    });

    it('should include schema URL in JSON output', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: true }, mockDeps);
      
      const jsonOutput = logOutput.find(log => {
        try {
          JSON.parse(log[0]);
          return true;
        } catch {
          return false;
        }
      });
      
      const parsed = JSON.parse(jsonOutput?.[0]);
      expect(parsed.schema_url).toContain('github.com/siongyuen/pulselive');
    });

    it('should include duration in JSON output', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: true }, mockDeps);
      
      const jsonOutput = logOutput.find(log => {
        try {
          JSON.parse(log[0]);
          return true;
        } catch {
          return false;
        }
      });
      
      const parsed = JSON.parse(jsonOutput?.[0]);
      expect(parsed.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Quick Mode ───

  describe('quick mode', () => {
    it('should run quick checks when quick option is true', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: false, quick: true }, mockDeps);
      
      // Should complete successfully
      expect(logOutput.some(log => typeof log[0] === 'string' && log[0].includes('repo1'))).toBe(true);
    });

    it('should run all checks when quick option is false', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: false, quick: false }, mockDeps);
      
      // Should complete successfully
      expect(logOutput.some(log => typeof log[0] === 'string' && log[0].includes('repo1'))).toBe(true);
    });
  });

  // ── Exit Codes ───

  describe('exit codes', () => {
    it('should exit with code 0 when all repositories are healthy and exitCode option is true', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: false, exitCode: true }, mockDeps);
      
      expect(exitCode).toBe(0);
    });

    it('should not exit when exitCode option is false', async () => {
      await handleMultiRepoCheck('owner/repo1', { json: false, exitCode: false }, mockDeps);
      
      expect(exitCode).toBeNull();
    });
  });

  // ── Repository List Parsing ───

  describe('repository list parsing', () => {
    it('should handle comma-separated repositories', async () => {
      await handleMultiRepoCheck('owner/repo1,owner/repo2,owner/repo3', { json: false }, mockDeps);
      
      const repo1Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo1'));
      const repo2Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo2'));
      const repo3Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo3'));
      
      expect(repo1Line).toBeDefined();
      expect(repo2Line).toBeDefined();
      expect(repo3Line).toBeDefined();
    });

    it('should trim whitespace from repository names', async () => {
      await handleMultiRepoCheck(' owner/repo1 , owner/repo2 ', { json: false }, mockDeps);
      
      const repo1Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo1'));
      const repo2Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo2'));
      
      expect(repo1Line).toBeDefined();
      expect(repo2Line).toBeDefined();
    });

    it('should filter out empty repository names', async () => {
      await handleMultiRepoCheck('owner/repo1,,owner/repo2', { json: false }, mockDeps);
      
      const repo1Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo1'));
      const repo2Line = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('repo2'));
      
      expect(repo1Line).toBeDefined();
      expect(repo2Line).toBeDefined();
    });
  });

  // ── Summary Statistics ───

  describe('summary statistics', () => {
    it('should calculate correct summary statistics', async () => {
      await handleMultiRepoCheck('owner/repo1,owner/repo2', { json: false }, mockDeps);
      
      const totalReposLine = logOutput.find(log => typeof log[0] === 'string' && log[0].includes('Total repos: 2'));
      expect(totalReposLine).toBeDefined();
    });
  });

  // ── Default Dependencies ───

  describe('default dependencies', () => {
    it('should use defaultCLIDeps when deps parameter is not provided', async () => {
      // This test verifies that the function works with default deps
      const result = handleMultiRepoCheck('owner/repo1', { json: true });
      expect(result).toBeInstanceOf(Promise);
    });
  });
});