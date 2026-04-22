import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitCheck, GitDeps, defaultGitDeps } from '../../src/checks/git';
import { PulseliveConfig } from '../../src/config';

describe('GitCheck', () => {
  let gitCheck: GitCheck;
  let config: PulseliveConfig;
  let mockDeps: GitDeps;

  beforeEach(() => {
    config = {};
    mockDeps = {
      execFile: vi.fn(),
      existsSync: vi.fn().mockReturnValue(true), // Default to git repo existing
    };
  });

  // ── DI-based tests (no vi.mock on child_process) ──

  describe('with dependency injection', () => {
    it('should handle git errors', async () => {
      mockDeps.execFile.mockImplementation(() => {
        throw new Error('Git error');
      });

      gitCheck = new GitCheck(config, '/project', mockDeps);
      const result = await gitCheck.run();

      expect(result.type).toBe('git');
      expect(result.status).toBe('error');
      expect(result.message).toContain('Git check failed');
    });

    it('should return git status information', async () => {
      mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
        const command = args.join(' ');
        if (command.includes('rev-parse --abbrev-ref HEAD@{upstream}')) {
          return 'origin/main';
        } else if (command.includes('rev-parse --abbrev-ref HEAD') && args.length === 3) {
          return 'main';
        } else if (command.includes('log --oneline -5')) {
          return 'abc1234 Fix bug\ndef4567 Add feature';
        } else if (command.includes('status --porcelain')) {
          return 'M  file1.txt\nM  file2.txt';
        } else if (command.includes('rev-parse --verify')) {
          return 'found';
        } else if (command.includes('rev-parse main') && args.length === 3) {
          return 'main-commit-hash';
        } else if (command.includes('rev-parse origin/main')) {
          return 'origin-main-hash';
        } else if (command.includes('rev-parse HEAD')) {
          return 'current-commit-hash';
        } else if (command.includes('rev-list --left-right --count')) {
          return '0\t2'; // ahead by 2
        }
        return '';
      });

      gitCheck = new GitCheck(config, '/project', mockDeps);
      const result = await gitCheck.run();

      expect(result.type).toBe('git');
      expect(result.status).toBe('success');
      expect(result.message).toContain('Git status: main branch');
      expect(result.details.uncommitted).toBe(2);
      expect(result.details.divergence).toContain('ahead');
    });

    it('should skip gracefully when not a git repository', async () => {
      mockDeps.existsSync.mockReturnValue(false);

      gitCheck = new GitCheck(config, '/project', mockDeps);
      const result = await gitCheck.run();

      expect(result.type).toBe('git');
      expect(result.status).toBe('success');
      expect(result.severity).toBe('low');
      expect(result.confidence).toBe('high');
      expect(result.message).toContain('Not a git repository');
      expect(result.details?.skipped).toBe(true);
      // Should not call execFile at all
      expect(mockDeps.execFile).not.toHaveBeenCalled();
    });

    it('should handle repo with no commits yet', async () => {
      mockDeps.execFile.mockImplementation(() => {
        throw new Error('fatal: ambiguous argument \'HEAD\': unknown revision');
      });

      gitCheck = new GitCheck(config, '/project', mockDeps);
      const result = await gitCheck.run();

      expect(result.type).toBe('git');
      expect(result.status).toBe('warning');
      expect(result.message).toContain('no commits yet');
    });

    it('should pass correct working directory to execFile', async () => {
      mockDeps.execFile.mockImplementation(() => {
        throw new Error('Git error');
      });

      gitCheck = new GitCheck(config, '/my/custom/dir', mockDeps);
      await gitCheck.run();

      // Every execFile call should have the correct cwd
      const calls = mockDeps.execFile.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const opts = call[2] as any;
        expect(opts.cwd).toBe('/my/custom/dir');
      }
    });

    it('should use default working directory when not specified', async () => {
      mockDeps.execFile.mockImplementation(() => {
        throw new Error('Git error');
      });

      gitCheck = new GitCheck(config, undefined, mockDeps);
      await gitCheck.run();

      const calls = mockDeps.execFile.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const opts = call[2] as any;
        expect(opts.cwd).toBe(process.cwd());
      }
    });

    it('should use defaultGitDeps when no deps provided', () => {
      // Smoke test — just confirm it instantiates without error
      gitCheck = new GitCheck(config);
      expect(gitCheck).toBeInstanceOf(GitCheck);
    });

    it('should handle empty git status (no uncommitted changes)', async () => {
      mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
        const command = args.join(' ');
        if (command.includes('rev-parse --abbrev-ref HEAD@{upstream}')) {
          return 'origin/main';
        } else if (command.includes('rev-parse --abbrev-ref HEAD') && args.length === 3) {
          return 'main';
        } else if (command.includes('log --oneline -5')) {
          return 'abc1234 Fix bug';
        } else if (command.includes('status --porcelain')) {
          return ''; // No uncommitted changes
        } else if (command.includes('rev-parse origin/main')) {
          return 'origin-main-hash';
        } else if (command.includes('rev-parse HEAD')) {
          return 'current-commit-hash';
        } else if (command.includes('rev-list --left-right --count')) {
          return '0\t0'; // up to date
        }
        return '';
      });

      gitCheck = new GitCheck(config, '/project', mockDeps);
      const result = await gitCheck.run();

      expect(result.type).toBe('git');
      expect(result.status).toBe('success');
      expect(result.details.uncommitted).toBe(0);
      expect(result.details.divergence).toBe('up to date');
    });
  });
});