import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthCheck } from '../../src/checks/health';
import { PulseliveConfig } from '../../src/config';
import fetch from 'node-fetch';

vi.mock('node-fetch');

describe('HealthCheck', () => {
  let healthCheck: HealthCheck;
  let config: PulseliveConfig;

  beforeEach(() => {
    config = {};
    healthCheck = new HealthCheck(config);
  });

  it('should return warning when no endpoints configured', async () => {
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('No health endpoints configured');
  });

  it('should handle successful endpoint checks', async () => {
    config.health = {
      endpoints: [
        { name: 'API', url: 'http://localhost:3000' },
        { name: 'Admin', url: 'http://localhost:3001' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockResolvedValue({
      status: 200
    });
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('success');
    expect(result.message).toContain('All endpoints healthy');
  });

  it('should handle endpoint failures', async () => {
    config.health = {
      endpoints: [
        { name: 'API', url: 'http://localhost:3000' },
        { name: 'Broken', url: 'http://localhost:3001' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes('3000')) {
        return Promise.resolve({ status: 200 });
      } else {
        return Promise.resolve({ status: 500 });
      }
    });
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
    expect(result.message).toContain('1 endpoints failed');
  });

  it('should handle mixed endpoint statuses', async () => {
    config.health = {
      endpoints: [
        { name: 'API', url: 'http://localhost:3000' },
        { name: 'NotFound', url: 'http://localhost:3001' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes('3000')) {
        return Promise.resolve({ status: 200 });
      } else {
        return Promise.resolve({ status: 404 });
      }
    });
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('Some endpoints have issues');
  });
});