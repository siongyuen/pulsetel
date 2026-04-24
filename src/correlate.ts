/**
 * Cross-signal correlation engine for PulseTel
 * Detects causal chains across CI/deps/coverage/health/deploy/Sentry checks
 */

import { CheckResult } from './scanner';
import { HistoryEntry } from './trends';

/**
 * Correlation pattern detection result
 */
export interface CorrelationPattern {
  pattern: string;
  causalChain: string[];
  actionable: string;
  blastRadius: 'low' | 'medium' | 'high';
  confidence: number; // 0-1
  fixTimeEstimate: string; // e.g., "1-2 hours", "1 day"
}

/**
 * Ship gate decision result
 */
export interface ShipDecision {
  decision: 'proceed' | 'caution' | 'block';
  blockingIssues: string[];
  proceedConditions: string[];
  confidence: number; // 0-1
}

/**
 * Correlation Engine
 * Detects causal chains across multiple signal types
 */
export class CorrelationEngine {
  
  /**
   * Detect correlation patterns from current check results
   * @param results Current check results
   * @param history Historical data for pattern recurrence detection
   */
  detectPatterns(results: CheckResult[], history: HistoryEntry[] = []): CorrelationPattern[] {
    const patterns: CorrelationPattern[] = [];
    
    // 1. Dependency Cascade: deps changed + CI failing + coverage drop
    const dependencyCascade = this.detectDependencyCascade(results);
    if (dependencyCascade) patterns.push(dependencyCascade);
    
    // 2. Security Scan Gap: vulns present + CI green = no security scanning
    const securityScanGap = this.detectSecurityScanGap(results);
    if (securityScanGap) patterns.push(securityScanGap);
    
    // 3. Bad Merge: coverage drop + CI flaky + recent merges
    const badMerge = this.detectBadMerge(results);
    if (badMerge) patterns.push(badMerge);
    
    // 4. Coverage Quality Divergence: coverage up + CI flaky = bad tests
    const coverageQualityDivergence = this.detectCoverageQualityDivergence(results);
    if (coverageQualityDivergence) patterns.push(coverageQualityDivergence);
    
    // 5. Deploy Regression: recent deploy + Sentry errors + latency spike
    const deployRegression = this.detectDeployRegression(results);
    if (deployRegression) patterns.push(deployRegression);
    
    // 6. Delivery Bottleneck: stale PRs + growing issues + healthy CI
    const deliveryBottleneck = this.detectDeliveryBottleneck(results);
    if (deliveryBottleneck) patterns.push(deliveryBottleneck);
    
    // 7. Untested Performance Regression: latency spike + low coverage
    const untestedPerformanceRegression = this.detectUntestedPerformanceRegression(results);
    if (untestedPerformanceRegression) patterns.push(untestedPerformanceRegression);
    
    // Boost confidence for recurring patterns
    return this.correlateWithHistory(patterns, history);
  }
  
  /**
   * Boost confidence when patterns recur in history
   */
  correlateWithHistory(patterns: CorrelationPattern[], history: HistoryEntry[]): CorrelationPattern[] {
    if (history.length === 0) return patterns;
    
    // Check if any of these patterns appeared in recent history
    const recentHistory = history.slice(0, 5); // Last 5 runs
    
    return patterns.map(pattern => {
      let recurrenceCount = 0;
      
      for (const entry of recentHistory) {
        // Simple pattern matching based on check types and statuses
        // This could be enhanced with more sophisticated pattern matching
        const hasSimilarPattern = entry.results.some(r => {
          if (pattern.pattern === 'dependency_cascade') {
            return r.type === 'deps' && r.status === 'error' && 
                   entry.results.some(r2 => r2.type === 'ci' && r2.status === 'error');
          } else if (pattern.pattern === 'security_scan_gap') {
            return r.type === 'deps' && r.status === 'error' && 
                   entry.results.some(r2 => r2.type === 'ci' && r2.status === 'success');
          }
          // Add more pattern-specific matching as needed
          return false;
        });
        
        if (hasSimilarPattern) recurrenceCount++;
      }
      
      // Boost confidence by 10% for each recurrence (max +30%)
      const confidenceBoost = Math.min(recurrenceCount * 0.1, 0.3);
      return {
        ...pattern,
        confidence: Math.min(pattern.confidence + confidenceBoost, 1.0)
      };
    });
  }
  
  /**
   * Make ship/no-ship decision based on correlation patterns
   */
  makeShipDecision(patterns: CorrelationPattern[]): ShipDecision {
    const blockingPatterns = ['dependency_cascade', 'security_scan_gap', 'deploy_regression'];
    const cautionPatterns = ['bad_merge', 'coverage_quality_divergence', 'untested_performance_regression'];
    
    const blockingIssues: string[] = [];
    const proceedConditions: string[] = [];
    
    // Check for blocking patterns
    for (const pattern of patterns) {
      if (blockingPatterns.includes(pattern.pattern)) {
        blockingIssues.push(`${pattern.pattern}: ${pattern.actionable}`);
      } else if (cautionPatterns.includes(pattern.pattern)) {
        proceedConditions.push(`${pattern.pattern}: ${pattern.actionable}`);
      }
    }
    
    // Make decision
    if (blockingIssues.length > 0) {
      return {
        decision: 'block',
        blockingIssues,
        proceedConditions,
        confidence: 0.9
      };
    } else if (patterns.length > 0) {
      return {
        decision: 'caution',
        blockingIssues: [],
        proceedConditions,
        confidence: 0.7
      };
    } else {
      return {
        decision: 'proceed',
        blockingIssues: [],
        proceedConditions: [],
        confidence: 0.95
      };
    }
  }
  
  // ── Pattern Detection Methods ───
  
  private detectDependencyCascade(results: CheckResult[]): CorrelationPattern | null {
    const depsResult = results.find(r => r.type === 'deps');
    const ciResult = results.find(r => r.type === 'ci');
    const coverageResult = results.find(r => r.type === 'coverage');
    
    if (depsResult?.status === 'error' && 
        ciResult?.status === 'error' && 
        coverageResult?.status === 'warning') {
      
      return {
        pattern: 'dependency_cascade',
        causalChain: ['deps', 'ci', 'coverage'],
        actionable: 'Dependency changes caused CI failures and coverage drop. Fix dependencies first, then verify CI and coverage.',
        blastRadius: 'high',
        confidence: 0.85,
        fixTimeEstimate: '2-4 hours'
      };
    }
    return null;
  }
  
  private detectSecurityScanGap(results: CheckResult[]): CorrelationPattern | null {
    const depsResult = results.find(r => r.type === 'deps');
    const ciResult = results.find(r => r.type === 'ci');
    
    if (depsResult?.status === 'error' && 
        ciResult?.status === 'success') {
      
      return {
        pattern: 'security_scan_gap',
        causalChain: ['deps', 'ci'],
        actionable: 'Vulnerabilities detected but CI is green. Add security scanning to CI pipeline to catch vulnerabilities before merge.',
        blastRadius: 'medium',
        confidence: 0.8,
        fixTimeEstimate: '1-2 hours'
      };
    }
    return null;
  }
  
  private detectBadMerge(results: CheckResult[]): CorrelationPattern | null {
    const coverageResult = results.find(r => r.type === 'coverage');
    const ciResult = results.find(r => r.type === 'ci');
    const gitResult = results.find(r => r.type === 'git');
    
    if (coverageResult?.status === 'warning' && 
        ciResult?.status === 'warning' &&
        gitResult?.details?.recentMerges > 0) {
      
      return {
        pattern: 'bad_merge',
        causalChain: ['git', 'ci', 'coverage'],
        actionable: 'Recent merges introduced flaky tests and reduced coverage. Review merge quality and add pre-merge checks.',
        blastRadius: 'medium',
        confidence: 0.75,
        fixTimeEstimate: '1-3 hours'
      };
    }
    return null;
  }
  
  private detectCoverageQualityDivergence(results: CheckResult[]): CorrelationPattern | null {
    const coverageResult = results.find(r => r.type === 'coverage');
    const ciResult = results.find(r => r.type === 'ci');
    
    if (coverageResult?.status === 'success' && 
        ciResult?.status === 'warning') {
      
      return {
        pattern: 'coverage_quality_divergence',
        causalChain: ['coverage', 'ci'],
        actionable: 'Coverage is good but CI is flaky. Tests may be passing without actually testing the right things. Review test quality.',
        blastRadius: 'low',
        confidence: 0.7,
        fixTimeEstimate: '1-2 hours'
      };
    }
    return null;
  }
  
  private detectDeployRegression(results: CheckResult[]): CorrelationPattern | null {
    const deployResult = results.find(r => r.type === 'deploy');
    const sentryResult = results.find(r => r.type === 'sentry');
    const healthResult = results.find(r => r.type === 'health');
    
    if (deployResult?.details?.recentDeploy && 
        sentryResult?.status === 'error' &&
        healthResult?.status === 'warning') {
      
      return {
        pattern: 'deploy_regression',
        causalChain: ['deploy', 'sentry', 'health'],
        actionable: 'Recent deployment caused Sentry errors and health endpoint degradation. Rollback deployment and investigate errors.',
        blastRadius: 'high',
        confidence: 0.9,
        fixTimeEstimate: '1-4 hours'
      };
    }
    return null;
  }
  
  private detectDeliveryBottleneck(results: CheckResult[]): CorrelationPattern | null {
    const prsResult = results.find(r => r.type === 'prs');
    const issuesResult = results.find(r => r.type === 'issues');
    const ciResult = results.find(r => r.type === 'ci');
    
    if (prsResult?.status === 'warning' && 
        issuesResult?.status === 'warning' &&
        ciResult?.status === 'success') {
      
      return {
        pattern: 'delivery_bottleneck',
        causalChain: ['prs', 'issues', 'ci'],
        actionable: 'PRs and issues are accumulating while CI is healthy. Increase review capacity and prioritize issue triage.',
        blastRadius: 'medium',
        confidence: 0.8,
        fixTimeEstimate: '1 day'
      };
    }
    return null;
  }
  
  private detectUntestedPerformanceRegression(results: CheckResult[]): CorrelationPattern | null {
    const healthResult = results.find(r => r.type === 'health');
    const coverageResult = results.find(r => r.type === 'coverage');
    
    if (healthResult?.status === 'warning' && 
        coverageResult?.status === 'warning') {
      
      return {
        pattern: 'untested_performance_regression',
        causalChain: ['health', 'coverage'],
        actionable: 'Performance degradation detected with low test coverage. Add performance tests and increase coverage.',
        blastRadius: 'medium',
        confidence: 0.75,
        fixTimeEstimate: '2-4 hours'
      };
    }
    return null;
  }
}
