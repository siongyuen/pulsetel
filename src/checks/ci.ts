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
        `https://api.github.com/repos/${repo}/actions/runs`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        return {
          type: 'ci',
          status: 'error',
          message: `GitHub API error: ${response.statusText}`
        };
      }

      const data: any = await response.json();
      const latestRun = data.workflow_runs?.[0];

      if (!latestRun) {
        return {
          type: 'ci',
          status: 'warning',
          message: 'No workflow runs found'
        };
      }

      const status = latestRun.conclusion || latestRun.status;
      const message = `Latest run: ${latestRun.name} (${status})`;

      if (status === 'success') {
        return {
          type: 'ci',
          status: 'success',
          message,
          details: { runId: latestRun.id, updatedAt: latestRun.updated_at }
        };
      } else if (status === 'failure' || status === 'cancelled') {
        return {
          type: 'ci',
          status: 'error',
          message,
          details: { runId: latestRun.id, updatedAt: latestRun.updated_at }
        };
      } else {
        return {
          type: 'ci',
          status: 'warning',
          message,
          details: { runId: latestRun.id, updatedAt: latestRun.updated_at }
        };
      }
    } catch (error) {
      return {
        type: 'ci',
        status: 'error',
        message: `CI check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}