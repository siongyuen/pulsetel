import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

export class DepsCheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const hasPackageJson = require('fs').existsSync(packageJsonPath);

      if (!hasPackageJson) {
        // Try other package managers
        return this.checkOtherPackageManagers();
      }

      // Check npm vulnerabilities
      let vulnerabilities = { critical: 0, high: 0, medium: 0, low: 0 };
      let outdated = 0;

      try {
        const auditOutput = execSync('npm audit --json', { encoding: 'utf8' });
        const auditData = JSON.parse(auditOutput);
        
        if (auditData.vulnerabilities) {
          Object.values(auditData.vulnerabilities).forEach((vuln: any) => {
            const severity = vuln.severity.toLowerCase();
            if (severity in vulnerabilities) {
              vulnerabilities[severity as keyof typeof vulnerabilities]++;
            }
          });
        }
      } catch (error) {
        // npm audit failed or no vulnerabilities
      }

      // Check outdated packages
      try {
        const outdatedOutput = execSync('npm outdated --json', { encoding: 'utf8' });
        const outdatedData = JSON.parse(outdatedOutput);
        outdated = Object.keys(outdatedData).length;
      } catch (error) {
        // npm outdated failed
      }

      const totalVulnerabilities = 
        vulnerabilities.critical + vulnerabilities.high + vulnerabilities.medium + vulnerabilities.low;

      if (totalVulnerabilities > 0 || outdated > 0) {
        const hasCritical = vulnerabilities.critical > 0 || vulnerabilities.high > 0;
        return {
          type: 'deps',
          status: hasCritical ? 'error' : 'warning',
          message: `${totalVulnerabilities} vulnerabilities, ${outdated} outdated packages`,
          details: { vulnerabilities, outdated }
        };
      }

      return {
        type: 'deps',
        status: 'success',
        message: 'No dependency issues found',
        details: { vulnerabilities, outdated }
      };
    } catch (error) {
      return {
        type: 'deps',
        status: 'error',
        message: `Dependencies check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private checkOtherPackageManagers(): CheckResult {
    // Try pip audit
    try {
      execSync('pip audit', { stdio: 'pipe' });
      return {
        type: 'deps',
        status: 'success',
        message: 'No Python dependency issues found'
      };
    } catch (error) {
      // pip audit failed or not available
    }

    // Try go vulncheck
    try {
      execSync('go vulncheck ./...', { stdio: 'pipe' });
      return {
        type: 'deps',
        status: 'success',
        message: 'No Go dependency issues found'
      };
    } catch (error) {
      // go vulncheck failed or not available
    }

    return {
      type: 'deps',
      status: 'warning',
      message: 'No supported package manager found'
    };
  }
}