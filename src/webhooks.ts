import { createHmac } from 'crypto';
import fetch from 'node-fetch';
import { CheckResult } from './scanner';
import { TrendAnalyzer, AnomalyResult, HistoryEntry } from './trends';
import { PulseliveConfig } from './config';
import { readFileSync, readdirSync, existsSync } from 'fs';

export interface WebhookNotifierDeps {
  fetch: (url: string, init?: any) => Promise<any>;
  readFileSync: (path: string, options?: { encoding?: BufferEncoding }) => string | Buffer;
  readdirSync: (path: string) => string[];
  existsSync: (path: string) => boolean;
}

export const defaultWebhookNotifierDeps: WebhookNotifierDeps = {
  fetch: fetch as any,
  readFileSync: (path: string, options?: { encoding?: BufferEncoding }) => readFileSync(path, options as any),
  readdirSync,
  existsSync
};

interface WebhookConfig {
  url: string;
  events: string[];
  secret?: string;
}

interface WebhookPayload {
  event: string;
  checkType: string;
  details: any;
  timestamp: string;
  project: string;
  severity: 'critical' | 'warning' | 'info';
  confidence: 'high' | 'medium' | 'low';
  actionable: string;
  context: string;
}

const MAX_RETRIES = 2;
const WEBHOOK_TIMEOUT = 5000;

export class WebhookNotifier {
  private config: PulseliveConfig;
  private webhooks: WebhookConfig[];
  private deps: WebhookNotifierDeps;

  constructor(config: PulseliveConfig, deps: WebhookNotifierDeps = defaultWebhookNotifierDeps) {
    this.config = config;
    this.webhooks = (config as any).webhooks || [];
    this.deps = deps;
  }

  /**
   * Evaluate check results against configured webhook triggers.
   * Sends webhook notifications for matching events.
   */
  async notify(results: CheckResult[]): Promise<void> {
    if (this.webhooks.length === 0) return;

    const payloads = this.generatePayloads(results);
    if (payloads.length === 0) return;

    // Fire all webhooks in parallel (don't block the check)
    const promises = payloads.flatMap(payload =>
      this.webhooks
        .filter(wh => wh.events.includes(payload.event))
        .map(wh => this.sendWebhook(wh, payload))
    );

    await Promise.allSettled(promises);
  }

  /**
   * Generate webhook payloads from check results, history, and trend analysis.
   */
  private generatePayloads(results: CheckResult[]): WebhookPayload[] {
    const payloads: WebhookPayload[] = [];
    const project = this.config.github?.repo || 'unknown';

    // 1. Critical events — any check with error status
    for (const r of results) {
      if (r.status === 'error') {
        payloads.push({
          event: 'critical',
          checkType: r.type,
          details: { message: r.message, ...r.details },
          timestamp: new Date().toISOString(),
          project,
          severity: 'critical',
          confidence: 'high',
          actionable: `${r.type} check failed — immediate attention required`,
          context: r.message
        });
      }
    }

    // 2. Load history for trend/anomaly analysis
    const history = this.loadHistory();
    if (history.length >= 2) {
      const trendAnalyzer = new TrendAnalyzer();

      // Anomaly events
      const anomalies = trendAnalyzer.detectAnomalies(history);
      for (const anomaly of anomalies) {
        payloads.push({
          event: 'anomaly',
          checkType: anomaly.checkType,
          details: {
            metric: anomaly.metric,
            value: anomaly.value,
            mean: anomaly.mean,
            stdDev: anomaly.stdDev,
            zScore: anomaly.zScore
          },
          timestamp: new Date().toISOString(),
          project,
          severity: anomaly.severity === 'high' ? 'critical' : 'warning',
          confidence: anomaly.zScore > 3 ? 'high' : 'medium',
          actionable: `${anomaly.metric} anomaly detected in ${anomaly.checkType} — investigate deviation`,
          context: `Value ${anomaly.value.toFixed(2)} is ${anomaly.zScore.toFixed(1)}σ from mean ${anomaly.mean.toFixed(2)}`
        });
      }

      // Degrading trend events
      const checkTypes = new Set<string>();
      history.forEach(e => e.results.forEach(r => checkTypes.add(r.type)));
      results.forEach(r => checkTypes.add(r.type));

      for (const ct of checkTypes) {
        const trend = trendAnalyzer.analyze(ct, history);
        if (trend.direction === 'degrading') {
          payloads.push({
            event: 'degrading',
            checkType: ct,
            details: { direction: trend.direction, delta: trend.delta, velocity: trend.velocity },
            timestamp: new Date().toISOString(),
            project,
            severity: 'warning',
            confidence: 'medium',
            actionable: `${ct} trend is degrading — review and address before it worsens`,
            context: `Delta: ${trend.delta > 0 ? '+' : ''}${trend.delta.toFixed(2)}, velocity: ${trend.velocity.toFixed(2)}/run`
          });
        }
      }
    }

    // 3. Flaky CI event
    const ciResult = results.find(r => r.type === 'ci');
    if (ciResult?.details?.flakinessScore && ciResult.details.flakinessScore > 30) {
      payloads.push({
        event: 'flaky',
        checkType: 'ci',
        details: {
          flakinessScore: ciResult.details.flakinessScore,
          failCount: ciResult.details.failCount,
          runCount: ciResult.details.runCount,
          trend: ciResult.details.trend
        },
        timestamp: new Date().toISOString(),
        project,
        severity: 'warning',
        confidence: 'medium',
        actionable: `CI flakiness at ${ciResult.details.flakinessScore}% — test results unreliable for gating merges`,
        context: `${ciResult.details.failCount} of ${ciResult.details.runCount} recent runs failed`
      });
    }

    return payloads;
  }

  /**
   * Send a webhook with HMAC signing and retry logic.
   */
  private async sendWebhook(webhook: WebhookConfig, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const headers: any = {
          'Content-Type': 'application/json',
          'X-PulseTel-Event': payload.event,
          'X-PulseTel-Version': '0.3.0'
        };

        // HMAC-SHA256 signing if secret is configured
        if (webhook.secret) {
          const signature = createHmac('sha256', webhook.secret)
            .update(body)
            .digest('hex');
          headers['X-PulseTel-Signature'] = `sha256=${signature}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

        const response = await this.deps.fetch(webhook.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal as AbortSignal
        });

        clearTimeout(timeoutId);

        if (response.ok) return;

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) return;

        // Retry on 5xx or network errors
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      } catch {
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
    }
  }

  private loadHistory(): HistoryEntry[] {
    try {
      const historyDir = '.pulsetel-history';
      if (!this.deps.existsSync(historyDir)) return [];

      const files = this.deps.readdirSync(historyDir);
      const history: HistoryEntry[] = [];

      for (const file of files) {
        if (file.startsWith('run-') && file.endsWith('.json')) {
          const content = this.deps.readFileSync(`${historyDir}/${file}`, { encoding: 'utf8' as BufferEncoding });
          if (typeof content === 'string') {
            history.push(JSON.parse(content));
          }
        }
      }

      return history;
    } catch {
      return [];
    }
  }
}