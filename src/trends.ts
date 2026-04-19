import { CheckResult } from './scanner';

export interface HistoryEntry {
  timestamp: string;
  results: Array<{
    type: string;
    status: 'success' | 'warning' | 'error';
    message: string;
    duration?: number;
    metrics?: any;
  }>;
  hostname?: string;
  pulsetel_version?: string;
}

export interface TrendResult {
  checkType: string;
  direction: 'improving' | 'stable' | 'degrading' | 'unknown';
  delta: number;
  anomaly: boolean;
  velocity: number;
  currentValue?: number;
  mean?: number;
  stdDev?: number;
}

export interface AnomalyResult {
  checkType: string;
  metric: string;
  value: number;
  mean: number;
  stdDev: number;
  zScore: number;
  severity: 'low' | 'medium' | 'high';
}

export class TrendAnalyzer {
  
  /**
   * Analyze trends for a specific check type
   * @param checkType The type of check to analyze
   * @param history Array of history entries
   * @param window Number of runs to consider (default: 7)
   */
  analyze(checkType: string, history: HistoryEntry[], window: number = 7): TrendResult {
    // Filter history for the specific check type
    const checkHistory = history
      .map(entry => {
        const result = entry.results.find(r => r.type === checkType);
        return result ? { ...result, timestamp: entry.timestamp } : null;
      })
      .filter(Boolean) as Array<HistoryEntry['results'][0] & { timestamp: string }>;
    
    if (checkHistory.length < 2) {
      return {
        checkType,
        direction: 'unknown',
        delta: 0,
        anomaly: false,
        velocity: 0
      };
    }
    
    // Use the most recent window entries
    const recentHistory = checkHistory.slice(-window);
    
    // Extract numeric values for analysis (use duration if available, otherwise use status scoring)
    const values = recentHistory.map(entry => {
      if (entry.metrics) {
        // Use specific metrics for each check type
        switch (checkType) {
          case 'ci':
            return entry.metrics.flakinessScore || 0;
          case 'deps':
            return entry.metrics.outdated || 0;
          case 'issues':
            return entry.metrics.open || 0;
          case 'coverage':
            return entry.metrics.percentage || 0;
          case 'health':
            // Use average latency for health
            const endpoints = entry.metrics.endpoints || [];
            if (endpoints.length > 0) {
              const avgLatency = endpoints.reduce((sum: number, ep: any) => sum + (ep.latency || 0), 0) / endpoints.length;
              return avgLatency;
            }
            return 0;
          case 'git':
            return entry.metrics.commits || 0;
          case 'prs':
            return entry.metrics.open || 0;
          default:
            return this.statusToScore(entry.status);
        }
      } else if (entry.duration) {
        return entry.duration;
      } else {
        return this.statusToScore(entry.status);
      }
    });
    
    const currentValue = values[values.length - 1];
    const firstValue = values[0];
    
    // Calculate mean and standard deviation
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate anomaly (current value > 2 standard deviations from mean)
    const zScore = stdDev > 0 ? Math.abs((currentValue - mean) / stdDev) : 0;
    const anomaly = zScore > 2;
    
    // Calculate delta (change from first to last value in window)
    const delta = currentValue - firstValue;
    
    // Calculate velocity (rate of change per run)
    const velocity = values.length > 1 ? delta / (values.length - 1) : 0;
    
    // Determine direction
    let direction: 'improving' | 'stable' | 'degrading' | 'unknown' = 'stable';
    
    if (Math.abs(delta) > mean * 0.1) { // More than 10% change
      if (delta < 0) {
        // For most metrics, lower is better (except coverage)
        if (checkType === 'coverage') {
          direction = 'degrading'; // Lower coverage is worse
        } else {
          direction = 'improving'; // Lower values are better
        }
      } else {
        // Higher values
        if (checkType === 'coverage') {
          direction = 'improving'; // Higher coverage is better
        } else {
          direction = 'degrading'; // Higher values are worse
        }
      }
    }
    
    return {
      checkType,
      direction,
      delta,
      anomaly,
      velocity,
      currentValue,
      mean,
      stdDev
    };
  }
  
  /**
   * Detect anomalies across all check types
   * @param history Array of history entries
   * @returns Array of detected anomalies, ranked by severity
   */
  detectAnomalies(history: HistoryEntry[]): AnomalyResult[] {
    const anomalies: AnomalyResult[] = [];
    
    // Get all unique check types
    const checkTypes = new Set<string>();
    history.forEach(entry => {
      entry.results.forEach(result => {
        checkTypes.add(result.type);
      });
    });
    
    // Analyze each check type
    checkTypes.forEach(checkType => {
      const trend = this.analyze(checkType, history);
      
      if (trend.anomaly && trend.currentValue !== undefined && trend.mean !== undefined && trend.stdDev !== undefined) {
        const zScore = trend.stdDev > 0 ? Math.abs((trend.currentValue - trend.mean) / trend.stdDev) : 0;
        
        // Determine severity based on z-score
        let severity: 'low' | 'medium' | 'high' = 'low';
        if (zScore > 3) {
          severity = 'high';
        } else if (zScore > 2.5) {
          severity = 'medium';
        }
        
        anomalies.push({
          checkType,
          metric: this.getMetricNameForCheckType(checkType),
          value: trend.currentValue,
          mean: trend.mean,
          stdDev: trend.stdDev,
          zScore,
          severity
        });
      }
    });
    
    // Sort by severity (high first) and z-score (descending)
    return anomalies.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const orderDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (orderDiff !== 0) return orderDiff;
      return b.zScore - a.zScore;
    });
  }
  
  /**
   * Convert status to numeric score for trend analysis
   * @param status Check status
   * @returns Numeric score (higher is better)
   */
  private statusToScore(status: 'success' | 'warning' | 'error'): number {
    switch (status) {
      case 'success': return 3;
      case 'warning': return 2;
      case 'error': return 1;
      default: return 2;
    }
  }
  
  /**
   * Get the primary metric name for a check type
   * @param checkType Check type
   * @returns Metric name
   */
  private getMetricNameForCheckType(checkType: string): string {
    switch (checkType) {
      case 'ci': return 'flakiness_score';
      case 'deps': return 'outdated_dependencies';
      case 'issues': return 'open_issues';
      case 'coverage': return 'coverage_percentage';
      case 'health': return 'average_latency';
      case 'git': return 'commit_count';
      case 'prs': return 'open_prs';
      default: return 'status_score';
    }
  }
}