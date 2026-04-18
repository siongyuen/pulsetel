import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepsCheck } from '../../src/checks/deps';
import { PulseliveConfig } from '../../src/config';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

vi.mock('child_process');
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn()
  };
});

describe('DepsCheck', () => {
  let depsCheck: DepsCheck;
  let config: PulseliveConfig;

  beforeEach(() => {
    config = {};
    depsCheck = new DepsCheck(config);
    vi.restoreAllMocks();
  });

  it('should return warning when no package.json found', async () => {
    (existsSync as any).mockImplementation((p: string) => {
      return !p.includes('package.json');
    });
    
    // Mock execFileSync to throw errors for other package managers
    (execFileSync as any).mockImplementation(() => {
      const err: any = new Error('Command failed');
      err.stdout = '';
      throw err;
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('No supported package manager found');
  });

  it('should handle npm audit and outdated with vulnerabilities', async () => {
    (existsSync as any).mockReturnValue(true);
    
    (execFileSync as any).mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({
          vulnerabilities: {
            lodash: { severity: 'high' },
            moment: { severity: 'medium' }
          },
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 1,
              medium: 1,
              low: 0
            }
          }
        });
        throw err;
      } else if (command.includes('outdated')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({
          express: { current: '4.18.0', wanted: '4.18.2' },
          moment: { current: '2.29.0', wanted: '2.29.4' }
        });
        throw err;
      }
      return '';
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('error');
    expect(result.message).toContain('2 vulnerabilities, 2 outdated packages');
  });

  it('should handle no dependency issues', async () => {
    (existsSync as any).mockReturnValue(true);
    
    (execFileSync as any).mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit')) {
        return JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 } } });
      } else if (command.includes('outdated')) {
        return JSON.stringify({});
      }
      return '';
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
    expect(result.message).toContain('No dependency issues found');
  });

  it('should handle npm audit failure gracefully', async () => {
    (existsSync as any).mockReturnValue(true);
    
    (execFileSync as any).mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit')) {
        throw new Error('npm audit failed');
      } else if (command.includes('outdated')) {
        return JSON.stringify({});
      }
      return '';
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
  });
});