import { describe, it, expect } from 'vitest';
import { TrendAnalyzer, HistoryEntry } from '../src/trends';

describe('TrendAnalyzer', () => {
  const trendAnalyzer = new TrendAnalyzer();

  describe('analyze', () => {
    it('returns unknown for insufficient history', () => {
      const history: HistoryEntry[] = [{
        timestamp: new Date().toISOString(),
        results: [{ type: 'deps', status: 'warning', message: '5 outdated' }]
      }];

      const result = trendAnalyzer.analyze('deps', history);
      expect(result.direction).toBe('unknown');
      expect(result.delta).toBe(0);
      expect(result.anomaly).toBe(false);
    });

    it('detects degrading trend for increasing outdated deps', () => {
      const history: HistoryEntry[] = [];
      for (let i = 0; i < 7; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [{
            type: 'deps',
            status: 'warning',
            message: `${5 + i * 2} outdated`,
            metrics: { outdated: 5 + i * 2, vulnerable: 1, total: 50 }
          }]
        });
      }

      const result = trendAnalyzer.analyze('deps', history);
      expect(result.direction).toBe('degrading');
      expect(result.delta).toBeGreaterThan(0);
    });

    it('detects improving trend for decreasing open issues', () => {
      const history: HistoryEntry[] = [];
      for (let i = 0; i < 7; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [{
            type: 'issues',
            status: 'warning',
            message: `${30 - i * 3} open`,
            metrics: { open: 30 - i * 3, closed: 10 }
          }]
        });
      }

      const result = trendAnalyzer.analyze('issues', history);
      expect(result.direction).toBe('improving');
      expect(result.delta).toBeLessThan(0);
    });

    it('detects stable trend for consistent values', () => {
      const history: HistoryEntry[] = [];
      for (let i = 0; i < 7; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [{
            type: 'coverage',
            status: 'success',
            message: 'Coverage: 85%',
            metrics: { percentage: 85 }
          }]
        });
      }

      const result = trendAnalyzer.analyze('coverage', history);
      expect(result.direction).toBe('stable');
      expect(result.delta).toBe(0);
    });

    it('detects anomaly when value exceeds 2 standard deviations', () => {
      const history: HistoryEntry[] = [];
      // 6 normal values
      for (let i = 0; i < 6; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [{
            type: 'deps',
            status: 'warning',
            message: '5 outdated',
            metrics: { outdated: 5, vulnerable: 0, total: 50 }
          }]
        });
      }
      // 1 spike
      history.push({
        timestamp: new Date().toISOString(),
        results: [{
          type: 'deps',
          status: 'warning',
          message: '25 outdated',
          metrics: { outdated: 25, vulnerable: 3, total: 50 }
        }]
      });

      const result = trendAnalyzer.analyze('deps', history);
      expect(result.anomaly).toBe(true);
    });

    it('handles coverage direction correctly (higher is better)', () => {
      const history: HistoryEntry[] = [];
      for (let i = 0; i < 7; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [{
            type: 'coverage',
            status: 'warning',
            message: `Coverage: ${70 + i * 3}%`,
            metrics: { percentage: 70 + i * 3 }
          }]
        });
      }

      const result = trendAnalyzer.analyze('coverage', history);
      expect(result.direction).toBe('improving');
    });

    it('uses custom window parameter', () => {
      const history: HistoryEntry[] = [];
      for (let i = 0; i < 14; i++) {
        history.push({
          timestamp: new Date(Date.now() - (14 - i) * 86400000).toISOString(),
          results: [{
            type: 'issues',
            status: 'warning',
            message: `${20 + i} open`,
            metrics: { open: 20 + i, closed: 5 }
          }]
        });
      }

      const result7 = trendAnalyzer.analyze('issues', history, 7);
      const result14 = trendAnalyzer.analyze('issues', history, 14);
      // Both should be degrading, but deltas may differ
      expect(result7.direction).toBe('degrading');
      expect(result14.direction).toBe('degrading');
    });
  });

  describe('detectAnomalies', () => {
    it('returns empty array when no anomalies', () => {
      const history: HistoryEntry[] = [];
      for (let i = 0; i < 7; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [{
            type: 'deps',
            status: 'success',
            message: 'All up to date',
            metrics: { outdated: 0, vulnerable: 0, total: 50 }
          }]
        });
      }

      const anomalies = trendAnalyzer.detectAnomalies(history);
      expect(anomalies.length).toBe(0);
    });

    it('detects and ranks anomalies by severity', () => {
      const history: HistoryEntry[] = [];
      // Stable deps
      for (let i = 0; i < 6; i++) {
        history.push({
          timestamp: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
          results: [
            { type: 'deps', status: 'success', message: '0 outdated', metrics: { outdated: 0, vulnerable: 0, total: 50 } },
            { type: 'issues', status: 'warning', message: '5 open', metrics: { open: 5, closed: 10 } }
          ]
        });
      }
      // Spike in both
      history.push({
        timestamp: new Date().toISOString(),
        results: [
          { type: 'deps', status: 'error', message: '50 outdated', metrics: { outdated: 50, vulnerable: 10, total: 50 } },
          { type: 'issues', status: 'error', message: '200 open', metrics: { open: 200, closed: 10 } }
        ]
      });

      const anomalies = trendAnalyzer.detectAnomalies(history);
      expect(anomalies.length).toBeGreaterThan(0);
      // Should be sorted by severity (high first)
      if (anomalies.length > 1) {
        const severityOrder = { high: 3, medium: 2, low: 1 };
        for (let i = 1; i < anomalies.length; i++) {
          expect(severityOrder[anomalies[i - 1].severity]).toBeGreaterThanOrEqual(severityOrder[anomalies[i].severity]);
        }
      }
    });

    it('handles empty history gracefully', () => {
      const anomalies = trendAnalyzer.detectAnomalies([]);
      expect(anomalies).toEqual([]);
    });
  });
});