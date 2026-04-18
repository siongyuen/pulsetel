import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitCheck } from '../../src/checks/git';
import { PulseliveConfig } from '../../src/config';
import { execFileSync } from 'child_process';

vi.mock('child_process');

describe('GitCheck', () => {
  let gitCheck: GitCheck;
  let config: PulseliveConfig;

  beforeEach(() => {
    config = {};
    gitCheck = new GitCheck(config);
  });

  it('should handle git errors', async () => {
    (execFileSync as any).mockImplementation(() => {
      throw new Error('Git error');
    });
    
    const result = await gitCheck.run();
    
    expect(result.type).toBe('git');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Git check failed');
  });

  it('should return git status information', async () => {
    (execFileSync as any).mockImplementation((cmd: string, args: string[]) => {
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
    
    const result = await gitCheck.run();
    
    expect(result.type).toBe('git');
    expect(result.status).toBe('success');
    expect(result.message).toContain('Git status: main branch');
    expect(result.details.uncommitted).toBe(2);
    expect(result.details.divergence).toContain('ahead');
  });

  it('should handle divergence detection failure', async () => {
    (execFileSync as any).mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('rev-parse --abbrev-ref HEAD@{upstream}')) {
        throw new Error('no upstream');
      } else if (command.includes('rev-parse --verify')) {
        throw new Error('branch not found');
      } else if (command.includes('rev-parse --abbrev-ref HEAD') && args.length === 3) {
        return 'feature-branch';
      } else if (command.includes('log --oneline -5')) {
        return 'abc1234 Initial commit';
      } else if (command.includes('status --porcelain')) {
        return '';
      } else if (command.includes('rev-parse main')) {
        throw new Error('main branch not found');
      }
      return '';
    });
    
    const result = await gitCheck.run();
    
    expect(result.type).toBe('git');
    expect(result.status).toBe('success');
    expect(result.details.divergence).toBe('unknown');
  });
});