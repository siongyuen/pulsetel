import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Dependency injection interface for DepsCheck.
 * Allows injecting filesystem and process execution for testability.
 */
export interface DepsDeps {
  execFile: (command: string, args: string[], options: any) => string;
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, options?: { encoding?: string }) => string;
}

/**
 * Default implementation using real child_process and fs.
 */
export const defaultDepsDeps: DepsDeps = {
  execFile: (cmd, args, opts) => {
    return execFileSync(cmd, args, opts).toString();
  },
  existsSync: (p) => existsSync(p),
  readFileSync: (path, options) => {
    return readFileSync(path, options as any).toString();
  }
};

export class DepsCheck {
  private config: PulseliveConfig;
  private deps: DepsDeps;

  constructor(config: PulseliveConfig, deps: DepsDeps = defaultDepsDeps) {
    this.config = config;
    this.deps = deps;
  }

  async run(): Promise<CheckResult> {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const hasPackageJson = this.deps.existsSync(packageJsonPath);

      if (!hasPackageJson) {
        // Try other package managers
        return this.checkOtherPackageManagers();
      }

      // Validate package.json is valid JSON before proceeding
      try {
        const packageJsonContent = this.deps.readFileSync(packageJsonPath, { encoding: 'utf8' });
        JSON.parse(packageJsonContent); // Validate JSON structure
      } catch (error) {
        return {
          type: 'deps',
          status: 'warning',
          message: '⚠️ Invalid package.json — skipping dependency checks',
          details: { error: 'Invalid JSON syntax in package.json' }
        };
      }

      // Check npm vulnerabilities
      let vulnerabilities = { critical: 0, high: 0, medium: 0, low: 0 };
      let outdated = 0;

      try {
        let auditData: any;
        try {
          const auditOutput = this.deps.execFile('npm', ['audit', '--json'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000 // Prevent hanging on slow networks
          });
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
          // Map npm severity names to internal severity levels
          // npm uses: 'critical', 'high', 'moderate', 'low', 'info'
          // internal uses: 'critical', 'high', 'medium', 'low'
          const severityMap: Record<string, keyof typeof vulnerabilities> = {
            'critical': 'critical',
            'high': 'high',
            'moderate': 'medium',
            'low': 'low',
            'info': 'low'
          };
          Object.values(auditData.vulnerabilities).forEach((vuln: any) => {
            const severity = vuln.severity?.toLowerCase();
            const mappedSeverity = severityMap[severity];
            if (mappedSeverity) {
              vulnerabilities[mappedSeverity]++;
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
          const outdatedOutput = this.deps.execFile('npm', ['outdated', '--json'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000 // Prevent hanging on slow networks
          });
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
        message: `Dependencies check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private checkOtherPackageManagers(): CheckResult {
    // Try pip-audit
    try {
      const output = this.deps.execFile('pip-audit', ['--format', 'json'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000
      }).trim();
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
      this.deps.execFile('govulncheck', ['./...'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000
      });
      return {
        type: 'deps',
        status: 'success',
        message: 'No Go dependency issues found'
      };
    } catch (error: any) {
      // govulncheck exits non-zero when vulnerabilities found
      if (error.stdout && error.stdout.includes('Vulnerability')) {
        return {
          type: 'deps',
          status: 'warning',
          message: 'Go vulnerabilities found — review govulncheck output',
          details: { error: error.stdout }
        };
      }
    }

    // No package manager detected
    return {
      type: 'deps',
      status: 'success',
      message: 'No package manager detected — skipping dependency check',
      details: { skipped: true }
    };
  }
}
