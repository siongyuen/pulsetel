import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import fetch from 'node-fetch';

export class DeployCheck {
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
          type: 'deploy',
          status: 'warning',
          message: 'No GitHub repository configured'
        };
      }

      if (!token) {
        return {
          type: 'deploy',
          status: 'warning',
          message: 'No GitHub token provided, skipping deploy check'
        };
      }

      const response = await fetch(
        `https://api.github.com/repos/${repo}/deployments`,
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
          type: 'deploy',
          status: isAuthFailure ? 'warning' : 'error',
          message: isAuthFailure ? 'GitHub auth failed. Check your token.' : `GitHub API error: ${response.status}`
        };
      }

      const data: any = await response.json();
      const latestDeployment = data[0];

      if (!latestDeployment) {
        return {
          type: 'deploy',
          status: 'warning',
          message: 'No deployments found'
        };
      }

      const status = latestDeployment.state || 'pending';
      const message = `Latest deployment: ${latestDeployment.environment} (${status})`;

      if (status === 'success') {
        return {
          type: 'deploy',
          status: 'success',
          message,
          details: { deploymentId: latestDeployment.id, createdAt: latestDeployment.created_at }
        };
      } else if (status === 'error' || status === 'failure') {
        return {
          type: 'deploy',
          status: 'error',
          message,
          details: { deploymentId: latestDeployment.id, createdAt: latestDeployment.created_at }
        };
      } else {
        return {
          type: 'deploy',
          status: 'warning',
          message,
          details: { deploymentId: latestDeployment.id, createdAt: latestDeployment.created_at }
        };
      }
    } catch (error) {
      return {
        type: 'deploy',
        status: 'error',
        message: 'Deploy check failed'
      };
    }
  }
}