import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CICheck } from '../../src/checks/ci';
import { PulseliveConfig } from '../../src/config';
import fetch from 'node-fetch';

vi.mock('node-fetch');

describe('CICheck', () => {
  let ciCheck: CICheck;
  let config: PulseliveConfig;

  beforeEach(() => {
    config = {};
    ciCheck = new CICheck(config);
  });

  it('should return warning when no repo configured', async () => {
    const result = await ciCheck.run();
    
    expect(result.type).toBe('ci');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('No GitHub repository configured');
  });

  it('should return warning when no token provided', async () => {
    config.github = { repo: 'test-org/test-repo' };
    ciCheck = new CICheck(config);
    
    const result = await ciCheck.run();
    
    expect(result.type).toBe('ci');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('No GitHub token provided');
  });

  it('should handle API error', async () => {
    config.github = { 
      repo: 'test-org/test-repo',
      token: 'test-token'
    };
    ciCheck = new CICheck(config);
    
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404
    });
    
    const result = await ciCheck.run();
    
    expect(result.type).toBe('ci');
    expect(result.status).toBe('error');
    expect(result.message).toContain('GitHub API error');
  });

  it('should handle successful workflow run', async () => {
    config.github = { 
      repo: 'test-org/test-repo',
      token: 'test-token'
    };
    ciCheck = new CICheck(config);
    
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 123,
          name: 'CI',
          conclusion: 'success',
          updated_at: '2023-01-01T00:00:00Z'
        }]
      })
    });
    
    const result = await ciCheck.run();
    
    expect(result.type).toBe('ci');
    expect(result.status).toBe('success');
    expect(result.message).toContain('Latest run: CI (success)');
  });

  it('should handle failed workflow run', async () => {
    config.github = { 
      repo: 'test-org/test-repo',
      token: 'test-token'
    };
    ciCheck = new CICheck(config);
    
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 123,
          name: 'CI',
          conclusion: 'failure',
          updated_at: '2023-01-01T00:00:00Z'
        }]
      })
    });
    
    const result = await ciCheck.run();
    
    expect(result.type).toBe('ci');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Latest run: CI (failure)');
  });
});