import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import fetch from 'node-fetch';

export class IssuesCheck {
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
          type: 'issues',
          status: 'warning',
          message: 'No GitHub repository configured'
        };
      }

      if (!token) {
        return {
          type: 'issues',
          status: 'warning',
          message: 'No GitHub token provided, skipping issues check'
        };
      }

      const response = await fetch(
        `https://api.github.com/repos/${repo}/issues?state=open`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        return {
          type: 'issues',
          status: 'error',
          message: `GitHub API error: ${response.statusText}`
        };
      }

      const issues: any = await response.json();
      const criticalCount = issues.filter((issue: any) => 
        issue.labels.some((label: any) => label.name === 'critical')
      ).length;
      const bugCount = issues.filter((issue: any) => 
        issue.labels.some((label: any) => label.name === 'bug')
      ).length;

      return {
        type: 'issues',
        status: criticalCount > 0 ? 'error' : bugCount > 0 ? 'warning' : 'success',
        message: `${issues.length} open issues (${criticalCount} critical, ${bugCount} bugs)`,
        details: { total: issues.length, critical: criticalCount, bugs: bugCount }
      };
    } catch (error) {
      return {
        type: 'issues',
        status: 'error',
        message: `Issues check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}