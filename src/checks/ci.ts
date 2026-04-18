import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import fetch from 'node-fetch';

export class CICheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      const repo = this.config.github?.repo;
      const token = this.config.github?.token;

      if (!repo) {
        return {
          type: 'ci',
          status: 'warning',
          message: 'No GitHub repository configured'
        };
      }

      if (!token) {
        return {
          type: 'ci',
          status: 'warning',
          message: 'No GitHub token provided, skipping CI check'
        };
      }

      const response = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs?per_page=10`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        const isAuthFailure = response.status === 401 || response.status === 403;
        return {
          type: 'ci',
          status: isAuthFailure ? 'warning' : 'error',
          message: isAuthFailure ? 'GitHub auth failed. Check your token.' : `GitHub API error: ${response.status}`
        };
      }

      const data: any = await response.json();
      const workflowRuns = data.workflow_runs || [];
      
      if (workflowRuns.length === 0) {
        return {
          type: 'ci',
          status: 'warning',
          message: 'No workflow runs found'
        };
      }

      // Analyze flakiness from last 10 runs
      const runCount = workflowRuns.length;
      const failCount = workflowRuns.filter((run: any) => 
        run.conclusion === 'failure' || run.conclusion === 'cancelled'
      ).length;
      
      const flakinessScore = Math.round((failCount / runCount) * 100);
      
      // Calculate trend (last 3 vs previous 3)
      let trend: 'improving' | 'stable' | 'degrading' = 'stable';
      if (runCount >= 6) {
        const last3 = workflowRuns.slice(0, 3);
        const prev3 = workflowRuns.slice(3, 6);
        
        const last3FailRate = last3.filter((run: any) => 
          run.conclusion === 'failure' || run.conclusion === 'cancelled'
        ).length / 3;
        
        const prev3FailRate = prev3.filter((run: any) => 
          run.conclusion === 'failure' || run.conclusion === 'cancelled'
        ).length / 3;
        
        if (last3FailRate < prev3FailRate - 0.1) {
          trend = 'improving';
        } else if (last3FailRate > prev3FailRate + 0.1) {
          trend = 'degrading';
        }
      }

      const latestRun = workflowRuns[0];
      const status = latestRun.conclusion || latestRun.status;
      const message = `Latest run: ${latestRun.name} (${status})`;

      if (status === 'success') {
        return {
          type: 'ci',
          status: 'success',
          message,
          details: { 
            runId: latestRun.id, 
            updatedAt: latestRun.updated_at,
            runCount,
            failCount,
            flakinessScore,
            trend
          }
        };
      } else if (status === 'failure' || status === 'cancelled') {
        return {
          type: 'ci',
          status: 'error',
          message,
          details: { 
            runId: latestRun.id, 
            updatedAt: latestRun.updated_at,
            runCount,
            failCount,
            flakinessScore,
            trend
          }
        };
      } else {
        return {
          type: 'ci',
          status: 'warning',
          message,
          details: { 
            runId: latestRun.id, 
            updatedAt: latestRun.updated_at,
            runCount,
            failCount,
            flakinessScore,
            trend
          }
        };
      }
    } catch (error) {
      return {
        type: 'ci',
        status: 'error',
        message: 'CI check failed'
      };
    }
  }
}