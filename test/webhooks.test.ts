import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookNotifier } from '../src/webhooks';
import { PulseliveConfig } from '../src/config';
import { CheckResult } from '../src/scanner';

// Mock node-fetch for webhook tests
vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({ ok: true, status: 200 })
}));

describe('WebhookNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips notification when no webhooks configured', async () => {
    const config: PulseliveConfig = { webhooks: [] };
    const notifier = new WebhookNotifier(config);
    const results: CheckResult[] = [
      { type: 'ci', status: 'error', message: 'CI failed' }
    ];
    // Should not throw
    await notifier.notify(results);
  });

  it('generates critical event for error results', async () => {
    const config: PulseliveConfig = {
      webhooks: [{ url: 'https://example.com/webhook', events: ['critical'] }]
    };
    const notifier = new WebhookNotifier(config);
    const results: CheckResult[] = [
      { type: 'ci', status: 'error', message: 'CI failed' }
    ];
    await notifier.notify(results);
    // fetch should have been called (mocked)
    const fetch = (await import('node-fetch')).default as any;
    expect(fetch).toHaveBeenCalled();
  });

  it('generates flaky event for high CI flakiness', async () => {
    const config: PulseliveConfig = {
      webhooks: [{ url: 'https://example.com/webhook', events: ['flaky'] }]
    };
    const notifier = new WebhookNotifier(config);
    const results: CheckResult[] = [
      {
        type: 'ci',
        status: 'warning',
        message: 'CI flaky',
        details: { flakinessScore: 60, failCount: 6, runCount: 10 }
      }
    ];
    await notifier.notify(results);
    const fetch = (await import('node-fetch')).default as any;
    expect(fetch).toHaveBeenCalled();
    const call = fetch.mock.calls[0];
    const body = JSON.parse(call[1]?.body || '{}');
    expect(body.event).toBe('flaky');
    expect(body.details.flakinessScore).toBe(60);
  });

  it('does not fire flaky event when flakiness is below threshold', async () => {
    const config: PulseliveConfig = {
      webhooks: [{ url: 'https://example.com/webhook', events: ['flaky'] }]
    };
    const notifier = new WebhookNotifier(config);
    const results: CheckResult[] = [
      {
        type: 'ci',
        status: 'success',
        message: 'CI passing',
        details: { flakinessScore: 10, failCount: 1, runCount: 10 }
      }
    ];
    await notifier.notify(results);
    const fetch = (await import('node-fetch')).default as any;
    // No flaky webhook should fire for 10% flakiness
    const flakyCall = fetch.mock.calls?.find((c: any) => {
      try { return JSON.parse(c[1]?.body).event === 'flaky'; } catch { return false; }
    });
    expect(flakyCall).toBeUndefined();
  });

  it('skips webhook for non-matching events', async () => {
    const config: PulseliveConfig = {
      webhooks: [{ url: 'https://example.com/webhook', events: ['anomaly'] }]
    };
    const notifier = new WebhookNotifier(config);
    const results: CheckResult[] = [
      { type: 'ci', status: 'error', message: 'CI failed' }
    ];
    // Critical event doesn't match 'anomaly' subscription
    await notifier.notify(results);
    const fetch = (await import('node-fetch')).default as any;
    // Should not be called since the only webhook subscribes to 'anomaly' and no anomaly exists
    // (critical event exists but webhook doesn't subscribe to it)
    expect(fetch).not.toHaveBeenCalled();
  });

  it('includes actionable and context in payload structure', async () => {
    const config: PulseliveConfig = {
      webhooks: [{ url: 'https://example.com/webhook', events: ['critical'] }]
    };
    const notifier = new WebhookNotifier(config);
    const results: CheckResult[] = [
      { type: 'health', status: 'error', message: 'Endpoint down' }
    ];
    await notifier.notify(results);
    const fetch = (await import('node-fetch')).default as any;
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toHaveProperty('event');
    expect(body).toHaveProperty('actionable');
    expect(body).toHaveProperty('context');
    expect(body).toHaveProperty('severity');
    expect(body).toHaveProperty('confidence');
    expect(body).toHaveProperty('timestamp');
  });
});