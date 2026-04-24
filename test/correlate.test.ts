import { describe, it, expect } from 'vitest';
import { CorrelationEngine, CorrelationPattern, ShipDecision } from '../src/correlate';
import { CheckResult } from '../src/scanner';

describe('CorrelationEngine', () => {
  const engine = new CorrelationEngine();

  describe('detectPatterns', () => {
    it('detects dependency_cascade when deps error + CI error + coverage warning', () => {
      const results: CheckResult[] = [
        { type: 'deps', status: 'error', message: 'critical vulns' },
        { type: 'ci', status: 'error', message: 'build failing' },
        { type: 'coverage', status: 'warning', message: 'coverage dropped' }
      ];
      const patterns = engine.detectPatterns(results);
      expect(patterns.some(p => p.pattern === 'dependency_cascade')).toBe(true);
    });

    it('detects security_scan_gap when deps error + CI success', () => {
      const results: CheckResult[] = [
        { type: 'deps', status: 'error', message: 'vulns found' },
        { type: 'ci', status: 'success', message: 'CI green' }
      ];
      const patterns = engine.detectPatterns(results);
      expect(patterns.some(p => p.pattern === 'security_scan_gap')).toBe(true);
    });

    it('detects delivery_bottleneck when stale PRs + growing issues + healthy CI', () => {
      const results: CheckResult[] = [
        { type: 'prs', status: 'warning', message: 'stale PRs' },
        { type: 'issues', status: 'warning', message: 'growing issues' },
        { type: 'ci', status: 'success', message: 'CI green' }
      ];
      const patterns = engine.detectPatterns(results);
      expect(patterns.some(p => p.pattern === 'delivery_bottleneck')).toBe(true);
    });

    it('returns empty when no patterns detected', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'all good' },
        { type: 'deps', status: 'success', message: 'deps up to date' }
      ];
      const patterns = engine.detectPatterns(results);
      expect(patterns).toHaveLength(0);
    });
  });

  describe('makeShipDecision', () => {
    it('returns block when dependency_cascade is detected', () => {
      const results: CheckResult[] = [
        { type: 'deps', status: 'error', message: 'critical' },
        { type: 'ci', status: 'error', message: 'failing' },
        { type: 'coverage', status: 'warning', message: 'low' }
      ];
      const patterns = engine.detectPatterns(results);
      const decision = engine.makeShipDecision(patterns);
      expect(decision.decision).toBe('block');
      expect(decision.blockingIssues.length).toBeGreaterThan(0);
    });

    it('returns proceed when no patterns detected', () => {
      const patterns: CorrelationPattern[] = [];
      const decision = engine.makeShipDecision(patterns);
      expect(decision.decision).toBe('proceed');
      expect(decision.blockingIssues).toHaveLength(0);
      expect(decision.confidence).toBeGreaterThan(0.9);
    });
  });
});
