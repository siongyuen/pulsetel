import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Safely execute an npm command using execFileSync to prevent shell injection.
 * execFileSync does not spawn a shell — arguments are passed directly to the binary.
 */
function npmCmd(args: string[]): string {
  return execFileSync('npm', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export class DepsCheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const hasPackageJson = existsSync(packageJsonPath);

      if (!hasPackageJson) {
        // Try other package managers
        return this.checkOtherPackageManagers();
      }

      // Check npm vulnerabilities
      let vulnerabilities = { critical: 0, high: 0, medium: 0, low: 0 };
      let outdated = 0;

      try {
        let auditData: any;
        try {
          const auditOutput = npmCmd(['audit', '--json']);
          auditData = JSON.parse(auditOutput);
        } catch (error: any) {
          // npm audit exits 1 when vulnerabilities found, but still outputs valid JSON
          if (error.stdout) {
            try {
              auditData = JSON.parse(error.stdout);
            } catch {
              // Genuine parse failure — not a vulns-found exit
            }
          }
        }

        if (auditData?.vulnerabilities) {
          Object.values(auditData.vulnerabilities).forEach((vuln: any) => {
            const severity = vuln.severity.toLowerCase();
            if (severity in vulnerabilities) {
              vulnerabilities[severity as keyof typeof vulnerabilities]++;
            }
          });
        }
      } catch (error) {
        // Unexpected error during audit processing
      }

      // Check outdated packages
      try {
        let outdatedData: any;
        try {
          const outdatedOutput = npmCmd(['outdated', '--json']);
          outdatedData = JSON.parse(outdatedOutput);
        } catch (error: any) {
          // npm outdated exits 1 when outdated packages found, but still outputs JSON
          if (error.stdout) {
            try {
              outdatedData = JSON.parse(error.stdout);
            } catch {
              // Genuine parse failure
            }
          }
        }

        if (outdatedData && typeof outdatedData === 'object') {
          outdated = Object.keys(outdatedData).length;
        }
      } catch (error) {
        // Unexpected error during outdated processing
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
        message: 'Dependencies check failed'
      };
    }
  }

  private checkOtherPackageManagers(): CheckResult {
    // Try pip-audit
    try {
      const output = execFileSync('pip-audit', ['--format', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      return {
        type: 'deps',
        status: 'success',
        message: 'No Python dependency issues found'
      };
    } catch (error: any) {
      // pip-audit exits 1 when vulnerabilities found — parse stdout
      if (error.stdout) {
        try {
          const auditData = JSON.parse(error.stdout);
          const vulnCount = auditData.dependencies?.reduce(
            (sum: number, dep: any) => sum + (dep.vulns?.length || 0), 0
          ) || 0;
          if (vulnCount > 0) {
            return {
              type: 'deps',
              status: 'warning',
              message: `${vulnCount} Python vulnerabilities found`,
              details: { vulnerabilities: { critical: 0, high: 0, medium: vulnCount, low: 0 }, outdated: 0 }
            };
          }
        } catch {
          // Parse failure
        }
      }
    }

    // Try govulncheck
    try {
      execFileSync('govulncheck', ['./...'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return {
        type: 'deps',
        status: 'success',
        message: 'No Go dependency issues found'
      };
    } catch (error: any) {
      // govulncheck exits non-zero when vulnerabilities found
      const output = error.stdout || error.stderr || '';
      if (output) {
        const vulnCount = (output.match(/Vulnerability/g) || []).length;
        if (vulnCount > 0) {
          return {
            type: 'deps',
            status: 'warning',
            message: `${vulnCount} Go vulnerabilities found`,
            details: { vulnerabilities: { critical: 0, high: 0, medium: vulnCount, low: 0 }, outdated: 0 }
          };
        }
      }
    }

    return {
      type: 'deps',
      status: 'warning',
      message: 'No supported package manager found'
    };
  }
}