import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthCheck } from '../../src/checks/health';
import { PulseliveConfig } from '../../src/config';
import fetch from 'node-fetch';

vi.mock('node-fetch');
vi.mock('dns', () => ({
  lookup: (_hostname: string, _opts: any, cb: Function) => {
    // Default: resolve to a safe public IP for test domains
    cb(null, [{ address: '203.0.113.1' }]);
  }
}));

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
        { name: 'API', url: 'https://api.example.com/health' },
        { name: 'Admin', url: 'https://admin.example.com/health' }
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
        { name: 'API', url: 'https://api.example.com/health' },
        { name: 'Broken', url: 'https://broken.example.com/health' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes('api.example.com')) {
        return Promise.resolve({ status: 200 });
      } else {
        return Promise.resolve({ status: 500 });
      }
    });
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
    expect(result.message).toContain('endpoint(s) failed');
  });

  it('should handle mixed endpoint statuses', async () => {
    config.health = {
      endpoints: [
        { name: 'API', url: 'https://api.example.com/health' },
        { name: 'NotFound', url: 'https://notfound.example.com/health' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes('api.example.com')) {
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

  it('should handle connection failures gracefully', async () => {
    config.health = {
      endpoints: [
        { name: 'Down', url: 'https://down.example.com/health', timeout: 1000 }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
    expect(result.message).toContain('failed');
  });

  it('should block localhost endpoints (SSRF protection)', async () => {
    config.health = {
      endpoints: [
        { name: 'Local', url: 'http://localhost:9999/health' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
    // The endpoint should be blocked before fetch is even called
    expect(result.message).toContain('endpoint(s) failed');
  });

  it('should block cloud metadata endpoints (SSRF protection)', async () => {
    config.health = {
      endpoints: [
        { name: 'Metadata', url: 'http://169.254.169.254/latest/meta-data/' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
  });

  it('should enforce endpoint limit', async () => {
    const endpoints = Array.from({ length: 25 }, (_, i) => ({
      name: `Endpoint ${i}`,
      url: `https://api${i}.example.com/health`
    }));
    config.health = { endpoints };
    healthCheck = new HealthCheck(config);
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Too many endpoints');
  });

  it('should allow localhost endpoints when allow_local is true', async () => {
    config.health = {
      allow_local: true,
      endpoints: [
        { name: 'Local API', url: 'http://localhost:3000/health' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    (fetch as any).mockResolvedValue({ status: 200 });
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('success');
    expect(result.message).toContain('All endpoints healthy');
  });

  it('should block cloud metadata even with allow_local true', async () => {
    config.health = {
      allow_local: true,
      endpoints: [
        { name: 'Metadata', url: 'http://169.254.169.254/latest/meta-data/' }
      ]
    };
    healthCheck = new HealthCheck(config);
    
    const result = await healthCheck.run();
    
    expect(result.type).toBe('health');
    expect(result.status).toBe('error');
  });
});