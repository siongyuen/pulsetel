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
        `https://api.github.com/repos/${repo}/issues?state=open&per_page=100`,
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
          type: 'issues',
          status: isAuthFailure ? 'warning' : 'error',
          message: isAuthFailure ? 'GitHub auth failed. Check your token.' : `GitHub API error: ${response.status}`
        };
      }

      const issues: any = await response.json();

      // Try to get total open count from API (more accurate than page length)
      let totalOpen = issues.length;
      try {
        const countResponse = await fetch(
          `https://api.github.com/search/issues?q=repo:${repo}+is:issue+is:open`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github.v3+json'
            }
          }
        );
        if (countResponse.ok) {
          const countData: any = await countResponse.json();
          totalOpen = countData.total_count || issues.length;
        }
      } catch {
        // Fall back to page count
      }

      const criticalCount = issues.filter((issue: any) => 
        issue.labels.some((label: any) => label.name === 'critical')
      ).length;
      const bugCount = issues.filter((issue: any) => 
        issue.labels.some((label: any) => label.name === 'bug')
      ).length;

      return {
        type: 'issues',
        status: criticalCount > 0 ? 'error' : bugCount > 0 ? 'warning' : 'success',
        message: `${totalOpen} open issues (${criticalCount} critical, ${bugCount} bugs)`,
        details: { total: totalOpen, critical: criticalCount, bugs: bugCount }
      };
    } catch (error) {
      return {
        type: 'issues',
        status: 'error',
        message: 'Issues check failed'
      };
    }
  }
}