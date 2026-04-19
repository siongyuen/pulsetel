import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runFixCommand,
  formatFixOutput,
  handleFixExitCodes,
  fixDependencies
} from '../src/cli-helpers';
import { CLIDeps } from '../src/cli-helpers';

describe('cli-helpers fix functions', () => {
  let mockDeps: CLIDeps;
  let mockExit: any;
  let mockLog: any;
  let mockExecFile: any;
  let mockExistsSync: any;

  beforeEach(() => {
    mockExit = vi.fn();
    mockLog = vi.fn();
    mockExecFile = vi.fn();
    mockExistsSync = vi.fn();
    
    mockDeps = {
      exit: mockExit,
      log: mockLog,
      error: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      existsSync: mockExistsSync,
      mkdirSync: vi.fn(),
      execFile: mockExecFile,
      cwd: vi.fn()
    };
  });

  // ── fixDependencies ───

  describe('fixDependencies', () => {
    it('should return failed status when no package.json found', async () => {
      mockExistsSync.mockReturnValue(false);
      
      const result = await fixDependencies('/test/dir', false, false, mockDeps);
      
      expect(result.status).toBe('failed');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No package.json found');
    });

    it('should return success status when no vulnerabilities found', async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecFile.mockReturnValue(JSON.stringify({ vulnerabilities: {} }));
      
      const result = await fixDependencies('/test/dir', false, false, mockDeps);
      
      expect(result.status).toBe('success');
      expect(result.success).toBe(true);
      expect(result.message).toContain('No vulnerabilities found');
    });

    it('should return success status for dry run with vulnerabilities', async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecFile.mockReturnValue(JSON.stringify({
        vulnerabilities: { 'test-vuln': {} }
      }));
      
      const result = await fixDependencies('/test/dir', true, false, mockDeps);
      
      expect(result.status).toBe('success');
      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.message).toContain('Would fix');
    });

    it('should return partial status when some vulnerabilities remain', async () => {
      mockExistsSync.mockReturnValue(true);
      
      // Mock the sequence of execFile calls
      let callCount = 0;
      mockExecFile.mockImplementation((cmd, args) => {
        callCount++;
        if (callCount === 1) {
          // First call - initial audit
          return JSON.stringify({
            vulnerabilities: { 'test-vuln-1': {}, 'test-vuln-2': {} }
          });
        } else if (callCount === 2) {
          // Second call - npm audit fix
          return JSON.stringify({});
        } else {
          // Third call - audit after fix
          return JSON.stringify({
            vulnerabilities: { 'test-vuln-2': {} }
          });
        }
      });
      
      const result = await fixDependencies('/test/dir', false, true, mockDeps);
      
      expect(result.status).toBe('partial');
      expect(result.partial).toBe(true);
      expect(result.message).toContain('Partially fixed');
    });

    it('should return success status when all vulnerabilities fixed', async () => {
      mockExistsSync.mockReturnValue(true);
      
      // Mock the sequence of execFile calls
      let callCount = 0;
      mockExecFile.mockImplementation((cmd, args) => {
        callCount++;
        if (callCount === 1) {
          // First call - initial audit with vulnerabilities
          return JSON.stringify({
            vulnerabilities: { 'test-vuln': {} }
          });
        } else if (callCount === 2) {
          // Second call - npm audit fix
          return JSON.stringify({});
        } else {
          // Third call - audit after fix (no vulnerabilities)
          return JSON.stringify({ vulnerabilities: {} });
        }
      });
      
      const result = await fixDependencies('/test/dir', false, true, mockDeps);
      
      expect(result.status).toBe('success');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully fixed all');
    });

    it('should return failed status when npm audit fix fails', async () => {
      mockExistsSync.mockReturnValue(true);
      
      mockExecFile.mockImplementation((cmd, args) => {
        if (args[0] === 'audit' && args[1] === '--json') {
          return JSON.stringify({
            vulnerabilities: { 'test-vuln': {} }
          });
        }
        // Simulate npm audit fix failure
        throw new Error('npm audit fix failed');
      });
      
      const result = await fixDependencies('/test/dir', false, true, mockDeps);
      
      expect(result.status).toBe('failed');
      expect(result.success).toBe(false);
      expect(result.message).toContain('npm audit fix failed');
    });
  });

  // ── runFixCommand ───

  describe('runFixCommand', () => {
    it('should complete without throwing errors', async () => {
      mockDeps.cwd.mockReturnValue('/test/dir');
      mockDeps.existsSync.mockReturnValue(true);
      mockDeps.readFile.mockReturnValue('{}');
      
      const result = await runFixCommand('/test/dir', { deps: true }, mockDeps);
      
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle all option', async () => {
      mockDeps.cwd.mockReturnValue('/test/dir');
      mockDeps.existsSync.mockReturnValue(true);
      mockDeps.readFile.mockReturnValue('{}');
      
      const result = await runFixCommand('/test/dir', { all: true }, mockDeps);
      
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle dry run option', async () => {
      mockDeps.cwd.mockReturnValue('/test/dir');
      mockDeps.existsSync.mockReturnValue(true);
      mockDeps.readFile.mockReturnValue('{}');
      
      const result = await runFixCommand('/test/dir', { deps: true, dryRun: true }, mockDeps);
      
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ── formatFixOutput ───

  describe('formatFixOutput', () => {
    const mockResults = [
      {
        target: 'deps',
        status: 'success',
        success: true,
        message: 'Fixed all vulnerabilities',
        changes: ['Fixed 2 vulnerabilities'],
        dryRun: false
      }
    ];

    it('should output JSON when json option is true', () => {
      formatFixOutput(mockResults, 100, { json: true }, mockDeps);
      
      expect(mockLog).toHaveBeenCalled();
      const callArg = mockLog.mock.calls[0][0];
      expect(() => JSON.parse(callArg)).not.toThrow();
      const parsed = JSON.parse(callArg);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.fix_results).toHaveLength(1);
    });

    it('should output standard format when json option is false', () => {
      formatFixOutput(mockResults, 100, { json: false }, mockDeps);
      
      expect(mockLog).toHaveBeenCalled();
      const calls = mockLog.mock.calls.map(call => call[0]);
      expect(calls.some(call => call.includes('PULSETEL FIX REPORT'))).toBe(true);
      expect(calls.some(call => call.includes('✅ deps'))).toBe(true);
      expect(calls.some(call => call.includes('Fixed all vulnerabilities'))).toBe(true);
    });

    it('should show dry run indicator when dryRun is true', () => {
      const dryRunResults = [
        {
          target: 'deps',
          status: 'success',
          success: true,
          message: 'Would fix vulnerabilities',
          changes: [],
          dryRun: true
        }
      ];
      
      formatFixOutput(dryRunResults, 100, { json: false }, mockDeps);
      
      expect(mockLog).toHaveBeenCalled();
      const calls = mockLog.mock.calls.map(call => call[0]);
      expect(calls.some(call => call.includes('📝 Dry run'))).toBe(true);
    });
  });

  // ── handleFixExitCodes ───

  describe('handleFixExitCodes', () => {
    const mockSuccessResults = [
      {
        target: 'deps',
        status: 'success',
        success: true,
        message: 'Fixed all vulnerabilities',
        changes: [],
        dryRun: false
      }
    ];

    const mockPartialResults = [
      {
        target: 'deps',
        status: 'partial',
        success: false,
        partial: true,
        message: 'Partially fixed',
        changes: [],
        dryRun: false
      }
    ];

    const mockFailedResults = [
      {
        target: 'deps',
        status: 'failed',
        success: false,
        message: 'Fix failed',
        changes: [],
        dryRun: false
      }
    ];

    it('should exit with code 0 when all fixes are successful', () => {
      handleFixExitCodes(mockSuccessResults, mockDeps);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should exit with code 2 when there are partial successes', () => {
      handleFixExitCodes(mockPartialResults, mockDeps);
      expect(mockExit).toHaveBeenCalledWith(2);
    });

    it('should exit with code 1 when there are failures', () => {
      handleFixExitCodes(mockFailedResults, mockDeps);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});