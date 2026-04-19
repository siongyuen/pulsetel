import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLIHandlers } from '../src/cli-handlers';
import { CLIDeps } from '../src/cli-helpers';

// Mock dependencies
const mockDeps: CLIDeps = {
  exit: vi.fn(),
  log: vi.fn(),
  error: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  execFile: vi.fn(),
  cwd: vi.fn().mockReturnValue('/test/project')
};

describe('CLIHandlers - Core Functionality Tests', () => {
  let handlers: CLIHandlers;

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = new CLIHandlers(mockDeps);
  });

  describe('handleCheckCommand', () => {
    it('should call helper functions with correct parameters', async () => {
      // Mock the helper functions
      const mockRunSingleRepoCheck = vi.fn().mockResolvedValue({
        results: [{ type: 'ci', status: 'success', message: 'CI passing' }],
        duration: 1000,
        config: {},
        workingDir: '/test/project'
      });

      const mockFormatCheckOutput = vi.fn();
      const mockHandleHistory = vi.fn();
      const mockHandleComparison = vi.fn();
      const mockHandleCheckExitCodes = vi.fn();

      // Import and mock the helpers
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'runSingleRepoCheck').mockImplementation(mockRunSingleRepoCheck);
      vi.spyOn(cliHelpers, 'formatCheckOutput').mockImplementation(mockFormatCheckOutput);
      vi.spyOn(cliHelpers, 'handleHistory').mockImplementation(mockHandleHistory);
      vi.spyOn(cliHelpers, 'handleComparison').mockImplementation(mockHandleComparison);
      vi.spyOn(cliHelpers, 'handleCheckExitCodes').mockImplementation(mockHandleCheckExitCodes);

      const options = { json: true };
      await handlers.handleCheckCommand('/test/project', options);

      expect(mockRunSingleRepoCheck).toHaveBeenCalledWith('/test/project', options);
      expect(mockFormatCheckOutput).toHaveBeenCalled();
      expect(mockHandleHistory).toHaveBeenCalled();
      expect(mockHandleComparison).toHaveBeenCalled();
      expect(mockHandleCheckExitCodes).toHaveBeenCalled();
    });

    it('should handle multi-repo mode', async () => {
      const mockHandleMultiRepoCheck = vi.fn().mockResolvedValue(undefined);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'handleMultiRepoCheck').mockImplementation(mockHandleMultiRepoCheck);

      const options = { repos: 'owner/repo1,owner/repo2' };
      await handlers.handleCheckCommand(undefined, options);

      expect(mockHandleMultiRepoCheck).toHaveBeenCalledWith('owner/repo1,owner/repo2', options, mockDeps);
    });
  });

  describe('handleFixCommand', () => {
    it('should call fix helper functions', async () => {
      const mockRunFixCommand = vi.fn().mockResolvedValue({
        results: [{ type: 'deps', status: 'success', message: 'Fixed vulnerabilities' }],
        duration: 2000
      });

      const mockFormatFixOutput = vi.fn();
      const mockHandleFixExitCodes = vi.fn();

      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'runFixCommand').mockImplementation(mockRunFixCommand);
      vi.spyOn(cliHelpers, 'formatFixOutput').mockImplementation(mockFormatFixOutput);
      vi.spyOn(cliHelpers, 'handleFixExitCodes').mockImplementation(mockHandleFixExitCodes);

      const options = { dryRun: true, json: false };
      await handlers.handleFixCommand('/test/project', options);

      expect(mockRunFixCommand).toHaveBeenCalledWith('/test/project', options);
      expect(mockFormatFixOutput).toHaveBeenCalled();
      expect(mockHandleFixExitCodes).toHaveBeenCalled();
    });

    it('should skip exit codes when json is true', async () => {
      const mockRunFixCommand = vi.fn().mockResolvedValue({
        results: [{ type: 'deps', status: 'success', message: 'Fixed vulnerabilities' }],
        duration: 1500
      });

      const mockFormatFixOutput = vi.fn();
      const mockHandleFixExitCodes = vi.fn();

      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'runFixCommand').mockImplementation(mockRunFixCommand);
      vi.spyOn(cliHelpers, 'formatFixOutput').mockImplementation(mockFormatFixOutput);
      vi.spyOn(cliHelpers, 'handleFixExitCodes').mockImplementation(mockHandleFixExitCodes);

      const options = { json: true };
      await handlers.handleFixCommand('/test/project', options);

      expect(mockRunFixCommand).toHaveBeenCalledWith('/test/project', options);
      expect(mockFormatFixOutput).toHaveBeenCalled();
      expect(mockHandleFixExitCodes).not.toHaveBeenCalled();
    });
  });

  describe('handleQuickCommand', () => {
    it('should call quick check helper functions', async () => {
      const mockRunQuickCheck = vi.fn().mockResolvedValue({
        results: [
          { type: 'ci', status: 'success', message: 'CI passing' },
          { type: 'git', status: 'success', message: 'Git healthy' }
        ],
        duration: 500
      });

      const mockFormatQuickOutput = vi.fn();
      const mockHandleQuickExitCodes = vi.fn();

      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'runQuickCheck').mockImplementation(mockRunQuickCheck);
      vi.spyOn(cliHelpers, 'formatQuickOutput').mockImplementation(mockFormatQuickOutput);
      vi.spyOn(cliHelpers, 'handleQuickExitCodes').mockImplementation(mockHandleQuickExitCodes);

      const options = { json: true };
      await handlers.handleQuickCommand('/test/project', options);

      expect(mockRunQuickCheck).toHaveBeenCalledWith('/test/project', options);
      expect(mockFormatQuickOutput).toHaveBeenCalled();
      expect(mockHandleQuickExitCodes).toHaveBeenCalled();
    });

    it('should handle multi-repo quick mode', async () => {
      const mockHandleMultiRepoCheck = vi.fn().mockResolvedValue(undefined);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'handleMultiRepoCheck').mockImplementation(mockHandleMultiRepoCheck);

      const options = { repos: 'owner/repo1,owner/repo2', quick: true };
      await handlers.handleQuickCommand(undefined, options);

      expect(mockHandleMultiRepoCheck).toHaveBeenCalledWith('owner/repo1,owner/repo2', options, mockDeps);
    });
  });

  describe('handleInitCommand', () => {
    it('should generate configuration file', () => {
      mockDeps.writeFile = vi.fn();
      mockDeps.log = vi.fn();

      handlers.handleInitCommand();

      expect(mockDeps.writeFile).toHaveBeenCalledWith('.pulsetel.yml', expect.any(String));
      expect(mockDeps.log).toHaveBeenCalledWith('Generated .pulsetel.yml configuration file');
    });

    it('should handle yaml module fallback', () => {
      // This test verifies the fallback works when yaml is not available
      const originalYaml = require.cache[require.resolve('yaml')];
      delete require.cache[require.resolve('yaml')];

      mockDeps.writeFile = vi.fn();
      mockDeps.log = vi.fn();

      handlers.handleInitCommand();

      // Should still work with JSON fallback
      expect(mockDeps.writeFile).toHaveBeenCalled();
      expect(mockDeps.log).toHaveBeenCalledWith('Generated .pulsetel.yml configuration file');

      // Restore yaml
      if (originalYaml) {
        require.cache[require.resolve('yaml')] = originalYaml;
      }
    });
  });

  describe('handleTrendsCommand', () => {
    it('should show insufficient data message when history is empty', async () => {
      const mockLoadHistory = vi.fn().mockReturnValue([]);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'loadHistory').mockImplementation(mockLoadHistory);

      const options = { json: false };
      await handlers.handleTrendsCommand(options);

      expect(mockDeps.log).toHaveBeenCalledWith('📊 Insufficient data - need at least 3 data points for trend analysis');
    });

    it('should show insufficient data message when history has less than 3 entries', async () => {
      const mockLoadHistory = vi.fn().mockReturnValue([
        { timestamp: '2024-01-01T00:00:00Z', results: [] },
        { timestamp: '2024-01-02T00:00:00Z', results: [] }
      ]);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'loadHistory').mockImplementation(mockLoadHistory);

      const options = { json: false };
      await handlers.handleTrendsCommand(options);

      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Insufficient data for trend analysis'));
    });
  });

  describe('handleAnomaliesCommand', () => {
    it('should show insufficient data message when history is empty', async () => {
      const mockLoadHistory = vi.fn().mockReturnValue([]);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'loadHistory').mockImplementation(mockLoadHistory);

      const options = { json: false };
      await handlers.handleAnomaliesCommand(options);

      expect(mockDeps.log).toHaveBeenCalledWith('📊 Insufficient data - need at least 3 data points for anomaly detection');
    });

    it('should show insufficient data message when history has less than 5 entries', async () => {
      const mockLoadHistory = vi.fn().mockReturnValue([
        { timestamp: '2024-01-01T00:00:00Z', results: [] },
        { timestamp: '2024-01-02T00:00:00Z', results: [] },
        { timestamp: '2024-01-03T00:00:00Z', results: [] },
        { timestamp: '2024-01-04T00:00:00Z', results: [] }
      ]);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'loadHistory').mockImplementation(mockLoadHistory);

      const options = { json: false };
      await handlers.handleAnomaliesCommand(options);

      expect(mockDeps.log).toHaveBeenCalledWith(expect.stringContaining('Insufficient data for anomaly detection - need at least 5 data points'));
    });
  });

  describe('handleHistoryCommand', () => {
    it('should show no history message when history is empty', async () => {
      const mockLoadHistory = vi.fn().mockReturnValue([]);
      const cliHelpers = await import('../src/cli-helpers');
      vi.spyOn(cliHelpers, 'loadHistory').mockImplementation(mockLoadHistory);

      const options = { json: false };
      handlers.handleHistoryCommand(options);

      expect(mockDeps.log).toHaveBeenCalledWith('No history available. Run `pulsetel check` first.');
    });
  });
});