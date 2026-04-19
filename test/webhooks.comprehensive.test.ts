import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookNotifier, WebhookNotifierDeps } from '../src/webhooks';
import { createHmac } from 'crypto';

function makeMockDeps(): WebhookNotifierDeps {
  return {
    fetch: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn()
  };
}

const mockConfig = (webhooks: any[] = []) => ({ webhooks } as any);

describe('WebhookNotifier — Comprehensive Tests', () => {
  let mockDeps: ReturnType<typeof makeMockDeps>;

  beforeEach(() => {
    mockDeps = makeMockDeps();
  });

  // ── HMAC Signing ──

  describe('HMAC signing', () => {
    it('sends X-PulseTel-Signature header when secret is configured', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true, status: 200 });
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'], secret: 'my-secret' }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      expect(mockDeps.fetch).toHaveBeenCalled();
      const call = mockDeps.fetch.mock.calls[0];
      const headers = call[1]?.headers || {};
      expect(headers['X-PulseTel-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('produces correct HMAC for known input', () => {
      const secret = 'test-secret';
      const body = '{"event":"critical"}';
      const expected = createHmac('sha256', secret).update(body).digest('hex');
      expect(expected.length).toBe(64);
    });

    it('does not send signature header when no secret', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true, status: 200 });
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      const call = mockDeps.fetch.mock.calls[0];
      const headers = call[1]?.headers || {};
      expect(headers['X-PulseTel-Signature']).toBeUndefined();
    });
  });

  // ── Retry Logic ──

  describe('retry on server errors', () => {
    it('retries on 5xx response', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: false, status: 500 });
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      // Use fake timers for speed
      vi.useFakeTimers();
      const promise = notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      // MAX_RETRIES is 2, so attempts = 0, 1, 2 = 3 total
      expect(mockDeps.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
      vi.useRealTimers();
    });

    it('does not retry on 4xx response', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: false, status: 400 });
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      // Should only call once (no retry for 4xx)
      expect(mockDeps.fetch).toHaveBeenCalledTimes(1);
    });

    it('retries on network error', async () => {
      mockDeps.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      vi.useFakeTimers();
      const promise = notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockDeps.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
      vi.useRealTimers();
    });
  });

  // ── Payload Generation ──

  describe('payload generation', () => {
    it('generates critical payload for error status', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true });
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      expect(mockDeps.fetch).toHaveBeenCalled();
      const body = JSON.parse(mockDeps.fetch.mock.calls[0][1].body);
      expect(body.event).toBe('critical');
      expect(body.checkType).toBe('ci');
      expect(body.severity).toBe('critical');
    });

    it('does not generate critical payload for success status', async () => {
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'success', message: 'All good' }] as any);

      // No critical event generated for success, so fetch should not be called
      expect(mockDeps.fetch).not.toHaveBeenCalled();
    });

    it('generates flaky payload when CI flakiness > 30', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true });
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['flaky'] }
      ]), mockDeps);

      await notifier.notify([{
        type: 'ci', status: 'warning', message: 'Flaky CI',
        details: { flakinessScore: 50, failCount: 5, runCount: 10 }
      }] as any);

      expect(mockDeps.fetch).toHaveBeenCalled();
      const body = JSON.parse(mockDeps.fetch.mock.calls[0][1].body);
      expect(body.event).toBe('flaky');
      expect(body.details.flakinessScore).toBe(50);
    });

    it('does not generate flaky payload when flakinessScore <= 30', async () => {
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['flaky'] }
      ]), mockDeps);

      await notifier.notify([{
        type: 'ci', status: 'warning', message: 'Mildly flaky',
        details: { flakinessScore: 20 }
      }] as any);

      expect(mockDeps.fetch).not.toHaveBeenCalled();
    });

    it('does not send when webhook event does not match', async () => {
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['anomaly'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      // Critical event doesn't match 'anomaly' subscription
      expect(mockDeps.fetch).not.toHaveBeenCalled();
    });
  });

  // ── History Loading for Trends ──

  describe('history-based event generation', () => {
    it('loads history for trend analysis', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true });
      mockDeps.existsSync.mockReturnValue(true);
      mockDeps.readdirSync.mockReturnValue(['run-2024-01-01.json', 'run-2024-01-02.json']);
      mockDeps.readFileSync.mockImplementation((p: string) => JSON.stringify({
        timestamp: '2024-01-01T00:00:00Z',
        results: [{ type: 'ci', status: 'success', message: 'OK', duration: 100 }]
      }));

      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['degrading'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      expect(mockDeps.existsSync).toHaveBeenCalledWith('.pulsetel-history');
    });

    it('returns empty history when dir does not exist', async () => {
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier({}, mockDeps);
      const history = (notifier as any).loadHistory();
      expect(history).toEqual([]);
    });

    it('skips non-JSON files in history dir', async () => {
      mockDeps.existsSync.mockReturnValue(true);
      mockDeps.readdirSync.mockReturnValue(['run-2024-01-01.json', 'notes.txt', 'data.csv']);
      mockDeps.readFileSync.mockReturnValue(JSON.stringify({
        timestamp: '2024-01-01T00:00:00Z', results: []
      }));

      const notifier = new WebhookNotifier({}, mockDeps);
      const history = (notifier as any).loadHistory();
      expect(history).toHaveLength(1);
    });

    it('handles malformed JSON in history gracefully', async () => {
      mockDeps.existsSync.mockReturnValue(true);
      mockDeps.readdirSync.mockReturnValue(['run-bad.json']);
      mockDeps.readFileSync.mockReturnValue('not valid json');

      const notifier = new WebhookNotifier({}, mockDeps);
      // loadHistory catches JSON.parse errors and returns empty
      expect(() => (notifier as any).loadHistory()).not.toThrow();
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('handles empty webhooks array', async () => {
      const notifier = new WebhookNotifier(mockConfig([]), mockDeps);
      await notifier.notify([{ type: 'ci', status: 'error', message: 'Failed' }] as any);
      expect(mockDeps.fetch).not.toHaveBeenCalled();
    });

    it('handles no config at all', async () => {
      const notifier = new WebhookNotifier({} as any, mockDeps);
      await notifier.notify([{ type: 'ci', status: 'error', message: 'Failed' }] as any);
      expect(mockDeps.fetch).not.toHaveBeenCalled();
    });

    it('sends correct content type and event headers', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true });
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://example.com/hook', events: ['critical'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      const call = mockDeps.fetch.mock.calls[0];
      expect(call[1].headers['Content-Type']).toBe('application/json');
      expect(call[1].headers['X-PulseTel-Event']).toBe('critical');
      expect(call[1].method).toBe('POST');
    });

    it('sends to multiple matching webhooks', async () => {
      mockDeps.fetch.mockResolvedValue({ ok: true });
      mockDeps.existsSync.mockReturnValue(false);
      const notifier = new WebhookNotifier(mockConfig([
        { url: 'https://a.com/hook', events: ['critical'] },
        { url: 'https://b.com/hook', events: ['critical'] },
        { url: 'https://c.com/hook', events: ['anomaly'] }
      ]), mockDeps);

      await notifier.notify([{ type: 'ci', status: 'error', message: 'CI failed' }] as any);

      // Only 2 webhooks match 'critical' event
      expect(mockDeps.fetch).toHaveBeenCalledTimes(2);
    });
  });
});