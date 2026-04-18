import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigLoader } from '../src/config';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

vi.mock('fs');
vi.mock('child_process');

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should load config from file', () => {
    (readFileSync as any).mockReturnValue('github:\n  repo: test-org/test-repo');
    
    const configLoader = new ConfigLoader();
    const config = configLoader.getConfig();
    
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should return empty config when file not found', () => {
    (readFileSync as any).mockImplementation(() => {
      throw new Error('File not found');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.getConfig();
    
    expect(config).toEqual({});
  });

  it('should auto-detect GitHub repo from git remote', () => {
    (readFileSync as any).mockReturnValue(''); // Empty config file
    (execSync as any).mockReturnValue('https://github.com/test-org/test-repo.git');
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.github?.repo).toBe('test-org/test-repo');
  });

  it('should enable deps check when package.json exists', () => {
    (readFileSync as any).mockReturnValue('');
    vi.spyOn(require('fs'), 'existsSync').mockImplementation((path: string) => {
      return path.includes('package.json');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.checks?.deps).toBe(true);
  });

  it('should enable git check when .git directory exists', () => {
    (readFileSync as any).mockReturnValue('');
    vi.spyOn(require('fs'), 'existsSync').mockImplementation((path: string) => {
      return path.includes('.git');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.checks?.git).toBe(true);
  });

  it('should handle git remote detection failure', () => {
    (readFileSync as any).mockReturnValue('');
    (execSync as any).mockImplementation(() => {
      throw new Error('Git remote not found');
    });
    
    const configLoader = new ConfigLoader();
    const config = configLoader.autoDetect();
    
    expect(config.github).toBeUndefined();
  });
});