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

  it('should return success when no package.json found', async () => {
    mockDeps.existsSync.mockReturnValue(false);
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
    mockDeps.readFileSync.mockReturnValue('{"name": "test"}');
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit') && !command.includes('fix')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({
          vulnerabilities: {
            lodash: { severity: 'high' },
            moment: { severity: 'moderate' }
          },
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 1,
              moderate: 1,
              low: 0
            }
          }
        });
        throw err;
      }
      if (command.includes('outdated')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({
          lodash: { current: '4.17.15', latest: '4.17.21' },
          axios: { current: '0.19.0', latest: '1.6.0' }
        });
        throw err;
      }
      return '';
    });

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('error');
    expect(result.message).toContain('vulnerabilities');
    expect(result.details).toBeDefined();
    expect(result.details.vulnerabilities.high).toBe(1);
    expect(result.details.vulnerabilities.medium).toBe(1);
    expect(result.details.outdated).toBe(2);
  });

  it('should return error for critical vulnerabilities', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.readFileSync.mockReturnValue('{"name": "test"}');
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit') && !command.includes('fix')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({
          vulnerabilities: {
            lodash: { severity: 'critical' }
          },
          metadata: {
            vulnerabilities: {
              critical: 1,
              high: 0,
              moderate: 0,
              low: 0
            }
          }
        });
        throw err;
      }
      if (command.includes('outdated')) {
        return '{}';
      }
      return '';
    });

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('error');
    expect(result.message).toContain('1 vulnerabilities');
  });

  it('should return success when no vulnerabilities found', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.readFileSync.mockReturnValue('{"name": "test"}');
    mockDeps.execFile.mockImplementation(() => {
      const err: any = new Error('exit code 0');
      err.stdout = '{}';
      return err.stdout;
    });

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('success');
    expect(result.message).toContain('No dependency issues');
  });

  it('should handle invalid package.json', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.readFileSync.mockReturnValue('not valid json');

    const check = new DepsCheck(config, mockDeps);
    const result = await check.run();

    expect(result.type).toBe('deps');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('Invalid package.json');
  });

  it('should detect Python vulnerabilities via pip-audit', async () => {
    mockDeps.existsSync.mockReturnValue(false);
    mockDeps.execFile.mockImplementation((cmd: string) => {
      if (cmd === 'pip-audit') {
        const err: any = new Error('exit 1');
        err.stdout = JSON.stringify({
          dependencies: [
            { name: 'requests', vulns: [{ id: 'CVE-2023-1' }] },
            { name: 'flask', vulns: [{ id: 'CVE-2023-2' }] }
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
    mockDeps.execFile.mockImplementation((cmd: string) => {
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

  it('should pass timeout option to npm audit', async () => {
    mockDeps.existsSync.mockReturnValue(true);
    mockDeps.readFileSync.mockReturnValue('{"name": "test"}');
    mockDeps.execFile.mockImplementation((cmd: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('audit')) {
        const err: any = new Error('exit code 1');
        err.stdout = JSON.stringify({ vulnerabilities: {} });
        throw err;
      }
      if (command.includes('outdated')) {
        return '{}';
      }
      return '';
    });

    const check = new DepsCheck(config, mockDeps);
    await check.run();

    const auditCall = mockDeps.execFile.mock.calls.find((call: any) => 
      call[1].join(' ').includes('audit')
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[2]).toHaveProperty('timeout', 30000);
  });
});
