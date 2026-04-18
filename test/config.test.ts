import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigLoader } from '../src/config';
import { readFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';

vi.mock('fs');
vi.mock('child_process');

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should load config from file', () => {
    (statSync as any).mockReturnValue({ size: 100 });
    (readFileSync as any).mockReturnValue('github:\n  repo: test-org/test-repo');
    
    const configLoader = new ConfigLoader();
    const config = configLoader.getConfig();
    
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should return empty config when file not found', () => {
    (statSync as any).mockImplementation(() => {
      throw new Error('File not found');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.getConfig();
    
    expect(config).toEqual({});
  });

  it('should auto-detect GitHub repo from git remote', () => {
    (statSync as any).mockReturnValue({ size: 0 });
    (readFileSync as any).mockReturnValue('');
    (execFileSync as any).mockReturnValue('https://github.com/test-org/test-repo.git');
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(false);
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should not overwrite auto-detected repo with empty config repo', () => {
    // Config file has github.repo = "" but git remote has a real repo
    (statSync as any).mockReturnValue({ size: 100 });
    (readFileSync as any).mockReturnValue('github:\n  repo: ""\n  token: ""');
    (execFileSync as any).mockReturnValue('https://github.com/test-org/test-repo.git');
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(false);
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    // Auto-detected repo should win over empty string
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should not mutate original config during autoDetect', () => {
    (statSync as any).mockReturnValue({ size: 100 });
    (readFileSync as any).mockReturnValue('checks:\n  deps: false');
    (execFileSync as any).mockImplementation(() => { throw new Error('no remote'); });
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
    
    const configLoader = new ConfigLoader();
    const originalConfig = configLoader.getConfig();
    
    configLoader.autoDetect();
    
    // Original config should not be mutated
    expect(originalConfig.checks?.deps).toBe(false);
  });

  it('should not overwrite explicit deps: false with auto-detect', () => {
    (statSync as any).mockReturnValue({ size: 100 });
    (readFileSync as any).mockReturnValue('checks:\n  deps: false');
    (execFileSync as any).mockImplementation(() => { throw new Error('no remote'); });
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.checks?.deps).toBe(false);
  });

  it('should enable deps check when package.json exists', () => {
    (statSync as any).mockReturnValue({ size: 0 });
    (readFileSync as any).mockReturnValue('');
    (execFileSync as any).mockImplementation(() => { throw new Error('no remote'); });
    vi.spyOn(require('fs'), 'existsSync').mockImplementation((p: string) => {
      return p.includes('package.json');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.checks?.deps).toBe(true);
  });

  it('should enable git check when .git directory exists', () => {
    (statSync as any).mockReturnValue({ size: 0 });
    (readFileSync as any).mockReturnValue('');
    (execFileSync as any).mockImplementation(() => { throw new Error('no remote'); });
    vi.spyOn(require('fs'), 'existsSync').mockImplementation((p: string) => {
      return p.includes('.git');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.checks?.git).toBe(true);
  });

  it('should handle git remote detection failure', () => {
    (statSync as any).mockReturnValue({ size: 0 });
    (readFileSync as any).mockReturnValue('');
    (execFileSync as any).mockImplementation(() => {
      throw new Error('Git remote not found');
    });
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(false);
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.github).toBeUndefined();
  });

  it('should auto-detect GitHub repo with dots in org name', () => {
    (statSync as any).mockReturnValue({ size: 0 });
    (readFileSync as any).mockReturnValue('');
    (execFileSync as any).mockReturnValue('https://github.com/microsoft.vscode/monaco-editor.git');
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(false);
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.github?.repo).toBe('microsoft.vscode/monaco-editor');
  });
});