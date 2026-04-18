import { ConfigLoader, PulseliveConfig } from './config';
import { CICheck } from './checks/ci';
import { DeployCheck } from './checks/deploy';
import { HealthCheck } from './checks/health';
import { GitCheck } from './checks/git';
import { IssuesCheck } from './checks/issues';
import { DepsCheck } from './checks/deps';

export interface CheckResult {
  type: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: any;
}

export class Scanner {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async runAllChecks(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    // Run CI check
    if (this.config.checks?.ci !== false) {
      const ciCheck = new CICheck(this.config);
      const ciResult = await ciCheck.run();
      results.push(ciResult);
    }

    // Run Deploy check
    if (this.config.checks?.deploy !== false) {
      const deployCheck = new DeployCheck(this.config);
      const deployResult = await deployCheck.run();
      results.push(deployResult);
    }

    // Run Health check
    if (this.config.checks?.health !== false) {
      const healthCheck = new HealthCheck(this.config);
      const healthResult = await healthCheck.run();
      results.push(healthResult);
    }

    // Run Git check
    if (this.config.checks?.git !== false) {
      const gitCheck = new GitCheck(this.config);
      const gitResult = await gitCheck.run();
      results.push(gitResult);
    }

    // Run Issues check
    if (this.config.checks?.issues !== false) {
      const issuesCheck = new IssuesCheck(this.config);
      const issuesResult = await issuesCheck.run();
      results.push(issuesResult);
    }

    // Run Deps check
    if (this.config.checks?.deps !== false) {
      const depsCheck = new DepsCheck(this.config);
      const depsResult = await depsCheck.run();
      results.push(depsResult);
    }

    return results;
  }

  async runSingleCheck(checkType: string): Promise<CheckResult> {
    switch (checkType) {
      case 'ci':
        return new CICheck(this.config).run();
      case 'deploy':
        return new DeployCheck(this.config).run();
      case 'health':
        return new HealthCheck(this.config).run();
      case 'git':
        return new GitCheck(this.config).run();
      case 'issues':
        return new IssuesCheck(this.config).run();
      case 'deps':
        return new DepsCheck(this.config).run();
      default:
        throw new Error(`Unknown check type: ${checkType}`);
    }
  }
}