import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigLoader, ConfigLoaderDeps } from '../src/config';

describe('ConfigLoader', () => {
  let mockDeps: ConfigLoaderDeps;

  beforeEach(() => {
    mockDeps = {
      readFileSync: vi.fn(),
      statSync: vi.fn(),
      execFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(true)
    };
  });

  it('should load config from file', () => {
    mockDeps.statSync.mockReturnValue({ size: 100 });
    mockDeps.readFileSync.mockReturnValue('github:\n  repo: test-org/test-repo');
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.getConfig();
    
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should return empty config when file not found', () => {
    mockDeps.existsSync.mockReturnValue(false);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.getConfig();
    
    expect(config).toEqual({});
  });

  it('should auto-detect GitHub repo from git remote', () => {
    mockDeps.statSync.mockReturnValue({ size: 0 });
    mockDeps.readFileSync.mockReturnValue('');
    mockDeps.execFileSync.mockReturnValue('https://github.com/test-org/test-repo.git');
    mockDeps.existsSync.mockReturnValue(false);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should not overwrite auto-detected repo with empty config repo', () => {
    // Config file has github.repo = "" but git remote has a real repo
    mockDeps.statSync.mockReturnValue({ size: 100 });
    mockDeps.readFileSync.mockReturnValue('github:\n  repo: ""\n  token: ""');
    mockDeps.execFileSync.mockReturnValue('https://github.com/test-org/test-repo.git');
    mockDeps.existsSync.mockReturnValue(false);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    // Auto-detected repo should win over empty string
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should not mutate original config during autoDetect', () => {
    mockDeps.statSync.mockReturnValue({ size: 100 });
    mockDeps.readFileSync.mockReturnValue('checks:\n  deps: false');
    mockDeps.execFileSync.mockImplementation(() => { throw new Error('no remote'); });
    mockDeps.existsSync.mockReturnValue(true);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const originalConfig = configLoader.getConfig();
    
    configLoader.autoDetect();
    
    // Original config should not be mutated
    expect(originalConfig.checks?.deps).toBe(false);
  });

  it('should not overwrite explicit deps: false with auto-detect', () => {
    mockDeps.statSync.mockReturnValue({ size: 100 });
    mockDeps.readFileSync.mockReturnValue('checks:\n  deps: false');
    mockDeps.execFileSync.mockImplementation(() => { throw new Error('no remote'); });
    mockDeps.existsSync.mockReturnValue(true);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    expect(config.checks?.deps).toBe(false);
  });

  it('should enable deps check when package.json exists', () => {
    mockDeps.statSync.mockReturnValue({ size: 0 });
    mockDeps.readFileSync.mockReturnValue('');
    mockDeps.execFileSync.mockImplementation(() => { throw new Error('no remote'); });
    mockDeps.existsSync.mockImplementation((p: string) => {
      return p.includes('package.json');
    });
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    expect(config.checks?.deps).toBe(true);
  });

  it('should enable git check when .git directory exists', () => {
    mockDeps.statSync.mockReturnValue({ size: 0 });
    mockDeps.readFileSync.mockReturnValue('');
    mockDeps.execFileSync.mockImplementation(() => { throw new Error('no remote'); });
    mockDeps.existsSync.mockImplementation((p: string) => {
      return p.includes('.git');
    });
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    expect(config.checks?.git).toBe(true);
  });

  it('should handle git remote detection failure', () => {
    mockDeps.statSync.mockReturnValue({ size: 0 });
    mockDeps.readFileSync.mockReturnValue('');
    mockDeps.execFileSync.mockImplementation(() => {
      throw new Error('Git remote not found');
    });
    mockDeps.existsSync.mockReturnValue(false);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    expect(config.github).toBeUndefined();
  });

  it('should auto-detect GitHub repo with dots in org name', () => {
    mockDeps.statSync.mockReturnValue({ size: 0 });
    mockDeps.readFileSync.mockReturnValue('');
    mockDeps.execFileSync.mockReturnValue('https://github.com/microsoft.vscode/monaco-editor.git');
    mockDeps.existsSync.mockReturnValue(false);
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.autoDetect();
    
    expect(config.github?.repo).toBe('microsoft.vscode/monaco-editor');
  });

  it('should use default deps when not provided', () => {
    const configLoader = new ConfigLoader();
    expect(configLoader).toBeDefined();
  });

  it('should validate config and return warnings', () => {
    mockDeps.statSync.mockReturnValue({ size: 100 });
    mockDeps.readFileSync.mockReturnValue('unknownKey: true\ngithub:\n  invalidKey: value\n  repo: test-org/test-repo');
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const validation = configLoader.validateConfig();
    
    expect(validation.warnings.length).toBeGreaterThan(0);
    expect(validation.warnings.some(w => w.includes('Unknown top-level key'))).toBe(true);
  });

  it('should reject invalid GitHub repo format', () => {
    mockDeps.statSync.mockReturnValue({ size: 100 });
    mockDeps.readFileSync.mockReturnValue('github:\n  repo: "invalid;repo"');
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.getConfig();
    
    expect(config.github?.repo).toBeUndefined();
  });

  it('should reject config files exceeding size limit', () => {
    mockDeps.statSync.mockReturnValue({ size: 100000 }); // > 64KB
    
    const configLoader = new ConfigLoader(undefined, mockDeps);
    const config = configLoader.getConfig();
    
    expect(config).toEqual({});
  });
});