import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepsCheck, DepsDeps, defaultDepsDeps } from '../../src/checks/deps';
import { PulseliveConfig } from '../../src/config';

describe('DepsCheck', () => {
  let config: PulseliveConfig;
  let mockDeps: DepsDeps;

  beforeEach(() => {
    config = {};
    mockDeps = {
      execFile: vi.fn(),
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    };
  });

  it('should return warning when no package.json found', async () => {
    mockDeps.existsSync.mockReturnValue(false);
    // Mock execFileSync to throw errors for other package managers
    mockDeps.execFile.mockImplementation(() => {
      const err: any = new Error('Command failed');
      err.stdout = '';
      throw err;
    });

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
    expect(result.message).toContain('No package manager detected');
  });

  it('should handle npm audit and outdated with vulnerabilities', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit') && !command.includes('fix')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({
          vulnerabilities: {
            lodash: { severity: 'high' },
            moment: { severity: 'moderate' }  // npm uses 'moderate', not 'medium'
          },
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 1,
              moderate: 1,  // npm uses 'moderate'
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

    // Mock valid package.json for JSON validation
    mockDeps.readFileSync.mockReturnValue(JSON.stringify({
      name: 'test-package',
      version: '1.0.0'
    }));

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('error');
    expect(result.message).toContain('2 vulnerabilities, 2 outdated packages');
  });

  it('should handle no dependency issues', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit') && !command.includes('fix')) {
        return JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 } } });
      } else if (command.includes('outdated')) {
        return JSON.stringify({});
      }
      return '';
    });

    // Mock valid package.json for JSON validation
    mockDeps.readFileSync.mockReturnValue(JSON.stringify({
      name: 'test-package',
      version: '1.0.0'
    }));

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
    expect(result.message).toContain('No dependency issues found');
  });

  it('should handle npm audit failure gracefully', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit') && !command.includes('fix')) {
        throw new Error('npm audit failed');
      } else if (command.includes('outdated')) {
        return JSON.stringify({});
      }
      return '';
    });

    // Mock valid package.json for JSON validation
    mockDeps.readFileSync.mockReturnValue(JSON.stringify({
      name: 'test-package',
      version: '1.0.0'
    }));

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
  });

  it('should use defaultDepsDeps when no deps provided', () => {
    const check = new DepsCheck(config);
    expect(check).toBeInstanceOf(DepsCheck);
  });

  it('should detect Python vulnerabilities via pip-audit', async () => {
    mockDeps.existsSync.mockReturnValue(false);
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'pip-audit') {
        const err: any = new Error('exit 1');
        err.stdout = JSON.stringify({
          dependencies: [
            { vulns: [{ id: 'PYSEC-123' }, { id: 'PYSEC-456' }] }
          ]
        });
        throw err;
      }
      throw new Error('not found');
    });

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('2 Python vulnerabilities found');
  });

  it('should detect Go vulnerabilities via govulncheck', async () => {
    mockDeps.existsSync.mockReturnValue(false);
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'pip-audit') {
        const err: any = new Error('exit 1');
        err.stdout = '';
        throw err;
      }
      if (cmd === 'govulncheck') {
        const err: any = new Error('exit 1');
        err.stdout = 'Vulnerability #1\nVulnerability #2';
        throw err;
      }
      throw new Error('not found');
    });

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('Go vulnerabilities found');
  });
});