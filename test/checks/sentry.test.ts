import { describe, it, expect } from 'vitest';
import { SentryCheck, SentryDeps, defaultSentryDeps } from '../../src/checks/sentry';
import { PulseliveConfig } from '../../src/config';

function makeConfig(overrides: Partial<PulseliveConfig> = {}): PulseliveConfig {
  return {
    github: { repo: 'owner/repo', token: 'test-token' },
    sentry: {
      organization: 'test-org',
      project: 'test-project',
      token: 'test-sentry-token',
    },
    ...overrides,
  } as PulseliveConfig;
}

function mockFetch(responses: { status: number; body: any } | { status: number; body: any }[]): SentryDeps {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  let callIndex = 0;
  return {
    fetch: async (url: string, init?: RequestInit) => {
      const response = queue[callIndex++] || queue[queue.length - 1];
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
        headers: { get: (name: string) => name === 'Link' ? null : '' },
      };
    },
  };
}

describe('SentryCheck', () => {
  it('should return warning when Sentry is not configured', async () => {
    const check = new SentryCheck(makeConfig({ sentry: undefined }));
    const result = await check.run();
    expect(result.type).toBe('sentry');
    expect(result.status).toBe('warning');
    expect(result.message).toContain('Sentry');
  });

  it('should return warning when organization is missing', async () => {
    const config = makeConfig({ sentry: { project: 'test-project', token: 'test-token' } } as any);
    const check = new SentryCheck(config);
    const result = await check.run();
    expect(result.status).toBe('warning');
    expect(result.message).toContain('organization');
  });

  it('should return warning when project is missing', async () => {
    const config = makeConfig({ sentry: { organization: 'test-org', token: 'test-token' } } as any);
    const check = new SentryCheck(config);
    const result = await check.run();
    expect(result.status).toBe('warning');
    expect(result.message).toContain('project');
  });

  it('should return warning when token is missing', async () => {
    const config = makeConfig({ sentry: { organization: 'test-org', project: 'test-project' } } as any);
    const check = new SentryCheck(config);
    const result = await check.run();
    expect(result.status).toBe('warning');
    expect(result.message).toContain('token');
  });

  it('should return success when no unresolved issues', async () => {
    const deps = mockFetch({
      status: 200,
      body: [],
    });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.type).toBe('sentry');
    expect(result.status).toBe('success');
    expect(result.message).toContain('No unresolved issues');
    expect(result.details).toEqual(
      expect.objectContaining({
        unresolved: 0,
      })
    );
  });

  it('should return warning for a few unresolved issues', async () => {
    const deps = mockFetch({
      status: 200,
      body: [
        { id: '1', title: 'TypeError in auth', level: 'error', count: 15, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 3 },
        { id: '2', title: 'NullPointer in cart', level: 'warning', count: 5, platform: 'python', firstSeen: '2026-04-17T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 1 },
      ],
    });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('warning');
    expect(result.message).toContain('2 unresolved');
    expect(result.severity).toBe('medium');
    expect(result.details.unresolved).toBe(2);
    expect(result.details.topIssues).toHaveLength(2);
  });

  it('should return error for many unresolved issues', async () => {
    const issues = Array.from({ length: 25 }, (_, i) => ({
      id: `${i}`, title: `Error ${i}`, level: 'error', count: 100 + i, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 5,
    }));
    const deps = mockFetch({ status: 200, body: issues });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('error');
    expect(result.severity).toBe('critical');
    expect(result.message).toContain('25 unresolved');
    expect(result.details.topIssues).toHaveLength(5); // capped at 5
  });

  it('should classify severity based on error count', async () => {
    const issues = [
      { id: '1', title: 'Critical error', level: 'fatal', count: 500, platform: 'python', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 50 },
    ];
    const deps = mockFetch({ status: 200, body: issues });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('error');
    expect(result.severity).toBe('critical');
  });

  it('should extract error rate trends from headers', async () => {
    const deps = mockFetch({
      status: 200,
      body: [
        { id: '1', title: 'Error', level: 'error', count: 10, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 2 },
      ],
    });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.details).toBeDefined();
    expect(result.details.unresolved).toBe(1);
  });

  it('should handle API errors gracefully', async () => {
    const deps = mockFetch({ status: 500, body: { detail: 'Internal Server Error' } });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed');
  });

  it('should handle 401 unauthorized', async () => {
    const deps = mockFetch({ status: 401, body: { detail: 'Invalid token' } });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('error');
    expect(result.message).toContain('authentication');
  });

  it('should handle 404 project not found', async () => {
    const deps = mockFetch({ status: 404, body: { detail: 'Not found' } });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('error');
    expect(result.message).toContain('not found');
  });

  it('should handle network errors', async () => {
    const deps: SentryDeps = {
      fetch: async () => { throw new Error('ECONNREFUSED'); },
    };
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed');
  });

  it('should use environment variable for token', async () => {
    const originalEnv = process.env.SENTRY_TOKEN;
    process.env.SENTRY_TOKEN = 'env-sentry-token';
    try {
      const config = makeConfig({ sentry: { organization: 'test-org', project: 'test-project' } } as any);
      const deps = mockFetch({ status: 200, body: [] });
      const check = new SentryCheck(config, deps);
      const result = await check.run();
      expect(result.status).toBe('success');
    } finally {
      process.env.SENTRY_TOKEN = originalEnv;
    }
  });

  it('should group issues by level', async () => {
    const issues = [
      { id: '1', title: 'Fatal', level: 'fatal', count: 10, platform: 'python', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 5 },
      { id: '2', title: 'Error', level: 'error', count: 20, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 3 },
      { id: '3', title: 'Warning', level: 'warning', count: 5, platform: 'node', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 1 },
    ];
    const deps = mockFetch({ status: 200, body: issues });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.details.byLevel).toEqual({
      fatal: 1,
      error: 1,
      warning: 1,
    });
  });

  it('should include actionable recommendations', async () => {
    const issues = [
      { id: '1', title: 'TypeError: Cannot read property', level: 'error', count: 150, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 25 },
    ];
    const deps = mockFetch({ status: 200, body: issues });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.actionable).toBeDefined();
    expect(result.actionable!.length).toBeGreaterThan(0);
    expect(result.context).toBeDefined();
  });

  it('should include release info when available', async () => {
    const issues = [
      { id: '1', title: 'Error', level: 'error', count: 10, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 3, firstRelease: { version: '2.1.0' } },
    ];
    const deps = mockFetch({ status: 200, body: issues });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.details.releases).toBeDefined();
    expect(result.details.releases).toContain('2.1.0');
  });

  it('should compute total event count', async () => {
    const issues = [
      { id: '1', title: 'Error A', level: 'error', count: 100, platform: 'javascript', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 10 },
      { id: '2', title: 'Error B', level: 'error', count: 50, platform: 'python', firstSeen: '2026-04-18T00:00:00Z', lastSeen: '2026-04-19T00:00:00Z', status: 'unresolved', userCount: 5 },
    ];
    const deps = mockFetch({ status: 200, body: issues });
    const check = new SentryCheck(makeConfig(), deps);
    const result = await check.run();
    expect(result.details.totalEvents).toBe(150);
    expect(result.details.affectedUsers).toBe(15);
  });
});