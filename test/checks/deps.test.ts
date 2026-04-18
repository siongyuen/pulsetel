import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepsCheck } from '../../src/checks/deps';
import { PulseliveConfig } from '../../src/config';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('DepsCheck', () => {
  let depsCheck: DepsCheck;
  let config: PulseliveConfig;

  beforeEach(() => {
    config = {};
    depsCheck = new DepsCheck(config);
  });

  it('should return warning when no package.json found', async () => {
    // Mock fs.existsSync to return false for package.json
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(false);
    
    // Mock execSync to throw errors for other package managers
    (execSync as any).mockImplementation((command: string) => {
      throw new Error('Command failed');
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('No supported package manager found');
  });

  it('should handle npm audit and outdated with vulnerabilities', async () => {
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
    
    (execSync as any).mockImplementation((command: string) => {
      if (command.includes('npm audit')) {
        return JSON.stringify({
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
      } else if (command.includes('npm outdated')) {
        return JSON.stringify({
          express: { current: '4.18.0', wanted: '4.18.2' },
          moment: { current: '2.29.0', wanted: '2.29.4' }
        });
      }
      return '';
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('error');
    expect(result.message).toContain('2 vulnerabilities, 2 outdated packages');
  });

  it('should handle no dependency issues', async () => {
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
    
    (execSync as any).mockImplementation((command: string) => {
      if (command.includes('npm audit')) {
        return JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 } } });
      } else if (command.includes('npm outdated')) {
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
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
    
    (execSync as any).mockImplementation((command: string) => {
      if (command.includes('npm audit')) {
        throw new Error('npm audit failed');
      } else if (command.includes('npm outdated')) {
        return JSON.stringify({});
      }
      return '';
    });
    
    const result = await depsCheck.run();
    
    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
  });
});