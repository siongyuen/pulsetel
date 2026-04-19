import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';

/**
 * Dependency injection interface for SentryCheck.
 * Inject fetch for testability without module-level mocking.
 */
export interface SentryDeps {
  fetch: (url: string, init?: RequestInit) => Promise<any>;
}

/**
 * Default implementation that uses the global fetch or node-fetch.
 */
export const defaultSentryDeps: SentryDeps = {
  fetch: async (url: string, init?: RequestInit) => {
    const response = await (globalThis as any).fetch(url, init);
    return response;
  },
};

/**
 * Sentry configuration within PulseliveConfig.
 */
export interface SentryConfig {
  organization: string;
  project: string;
  token?: string;  // Prefer SENTRY_TOKEN env var
}

export class SentryCheck {
  private config: PulseliveConfig;
  private deps: SentryDeps;

  constructor(config: PulseliveConfig, deps: SentryDeps = defaultSentryDeps) {
    this.config = config;
    this.deps = deps;
  }

  async run(): Promise<CheckResult> {
    const sentry = this.config.sentry;
    
    // Guard: Sentry not configured
    if (!sentry) {
      return {
        type: 'sentry',
        status: 'warning',
        severity: 'low',
        confidence: 'high',
        message: 'Sentry not configured — add sentry.organization and sentry.project to .pulselive.yml',
        actionable: 'Configure Sentry integration to monitor production errors',
        context: 'Sentry provides real-time error tracking and alerting',
      };
    }

    if (!sentry.organization) {
      return {
        type: 'sentry',
        status: 'warning',
        severity: 'low',
        confidence: 'high',
        message: 'Sentry organization not configured',
        actionable: 'Set sentry.organization in .pulselive.yml',
        context: 'Organization slug is required to query the Sentry API',
      };
    }

    if (!sentry.project) {
      return {
        type: 'sentry',
        status: 'warning',
        severity: 'low',
        confidence: 'high',
        message: 'Sentry project not configured',
        actionable: 'Set sentry.project in .pulselive.yml',
        context: 'Project slug is required to query the Sentry API',
      };
    }

    const token = sentry.token || process.env.SENTRY_TOKEN;
    if (!token) {
      return {
        type: 'sentry',
        status: 'warning',
        severity: 'low',
        confidence: 'high',
        message: 'Sentry token not provided — set SENTRY_TOKEN env var',
        actionable: 'Set SENTRY_TOKEN environment variable or sentry.token in config',
        context: 'Sentry API requires authentication to access project issues',
      };
    }

    try {
      const org = encodeURIComponent(sentry.organization);
      const project = encodeURIComponent(sentry.project);
      const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&sort=freq&per_page=100`;

      const response = await this.deps.fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            type: 'sentry',
            status: 'error',
            severity: 'high',
            confidence: 'high',
            message: 'Sentry authentication failed — check your token',
            actionable: 'Verify SENTRY_TOKEN is valid and has read access to the project',
            context: 'Sentry API returned 401 Unauthorized',
            details: { httpStatus: response.status },
          };
        }

        if (response.status === 404) {
          return {
            type: 'sentry',
            status: 'error',
            severity: 'high',
            confidence: 'high',
            message: `Sentry project ${sentry.organization}/${sentry.project} not found`,
            actionable: 'Verify organization and project slugs match your Sentry dashboard',
            context: 'Sentry API returned 404 — check org/project configuration',
            details: { httpStatus: response.status },
          };
        }

        return {
          type: 'sentry',
          status: 'error',
          severity: 'medium',
          confidence: 'medium',
          message: `Failed to fetch Sentry issues (HTTP ${response.status})`,
          actionable: 'Check Sentry service status and try again',
          context: 'Sentry API returned an unexpected error response',
          details: { httpStatus: response.status },
        };
      }

      const issues: SentryIssue[] = await response.json();

      if (!Array.isArray(issues)) {
        return {
          type: 'sentry',
          status: 'error',
          severity: 'medium',
          confidence: 'medium',
          message: 'Sentry API returned unexpected response format',
          actionable: 'Check Sentry API version compatibility',
          context: 'Expected an array of issues but received a different format',
        };
      }

      // No unresolved issues
      if (issues.length === 0) {
        return {
          type: 'sentry',
          status: 'success',
          severity: 'low',
          confidence: 'high',
          message: 'No unresolved issues in Sentry',
          actionable: 'No action needed — project has zero unresolved errors',
          context: 'All tracked errors have been resolved or muted',
          details: {
            unresolved: 0,
            totalEvents: 0,
            affectedUsers: 0,
          },
        };
      }

      // Compute metrics
      const unresolved = issues.length;
      const totalEvents = issues.reduce((sum, i) => sum + (i.count || 0), 0);
      const affectedUsers = issues.reduce((sum, i) => sum + (i.userCount || 0), 0);

      // Group by level
      const byLevel: Record<string, number> = {};
      for (const issue of issues) {
        const level = issue.level || 'error';
        byLevel[level] = (byLevel[level] || 0) + 1;
      }

      // Extract releases
      const releases = new Set<string>();
      for (const issue of issues) {
        if (issue.firstRelease?.version) {
          releases.add(issue.firstRelease.version);
        }
      }

      // Top 5 issues by frequency
      const topIssues = issues
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .slice(0, 5)
        .map(i => ({
          id: i.id,
          title: i.title,
          level: i.level,
          count: i.count,
          platform: i.platform,
          users: i.userCount,
          url: `https://sentry.io/organizations/${sentry.organization}/issues/${i.id}/`,
        }));

      // Determine overall status and severity
      const { status, severity } = this.classifyStatus(issues);

      // Generate actionable and context
      const { actionable, context } = this.generateGuidance(issues, byLevel, affectedUsers);

      return {
        type: 'sentry',
        status,
        severity,
        confidence: 'high',
        message: `${unresolved} unresolved issue${unresolved !== 1 ? 's' : ''} in Sentry`,
        actionable,
        context,
        details: {
          unresolved,
          totalEvents,
          affectedUsers,
          byLevel,
          topIssues,
          releases: Array.from(releases),
        },
      };

    } catch (error: any) {
      return {
        type: 'sentry',
        status: 'error',
        severity: 'medium',
        confidence: 'low',
        message: `Failed to fetch Sentry issues: ${error.message}`,
        actionable: 'Check Sentry connectivity and token configuration',
        context: 'Network or configuration error prevented Sentry API access',
      };
    }
  }

  private classifyStatus(issues: SentryIssue[]): { status: CheckResult['status']; severity: CheckResult['severity'] } {
    const unresolved = issues.length;
    const hasFatalOrError = issues.some(i => i.level === 'fatal' || i.level === 'error');
    const highEventCount = issues.some(i => (i.count || 0) > 100);

    if (unresolved >= 10 || highEventCount) {
      return { status: 'error', severity: 'critical' };
    }

    if (hasFatalOrError && unresolved >= 5) {
      return { status: 'error', severity: 'high' };
    }

    if (unresolved >= 3 || hasFatalOrError) {
      return { status: 'warning', severity: 'medium' };
    }

    return { status: 'warning', severity: 'low' };
  }

  private generateGuidance(issues: SentryIssue[], byLevel: Record<string, number>, affectedUsers: number): { actionable: string; context: string } {
    const topIssue = issues.sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    const parts: string[] = [];
    
    if (byLevel['fatal'] || byLevel['error']) {
      const criticalCount = (byLevel['fatal'] || 0) + (byLevel['error'] || 0);
      parts.push(`Fix ${criticalCount} critical error${criticalCount !== 1 ? 's' : ''} first`);
    }

    if (topIssue) {
      parts.push(`Top issue: "${topIssue.title}" (${topIssue.count} events, ${topIssue.userCount} users)`);
    }

    if (affectedUsers > 0) {
      parts.push(`${affectedUsers} users affected across all issues`);
    }

    const actionable = parts.join(' — ');
    const context = `${issues.length} unresolved issue${issues.length !== 1 ? 's' : ''} tracked in Sentry with ${Object.values(byLevel).reduce((a, b) => a + b, 0)} total events`;

    return { actionable, context };
  }
}

interface SentryIssue {
  id: string;
  title: string;
  level: string;
  count: number;
  platform: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
  userCount: number;
  firstRelease?: { version: string };
}