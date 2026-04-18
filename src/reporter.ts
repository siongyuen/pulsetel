import { CheckResult } from './scanner';
import chalk from 'chalk';

export class Reporter {
  private useColors: boolean;

  constructor(useColors: boolean = true) {
    this.useColors = useColors;
  }

  format(results: CheckResult[]): string {
    if (this.useColors) {
      return this.formatColored(results);
    } else {
      return this.formatPlain(results);
    }
  }

  formatJson(results: CheckResult[]): string {
    return JSON.stringify(results, null, 2);
  }

  private formatColored(results: CheckResult[]): string {
    let output = chalk.bold('PULSELIVE — your project, right now') + '\n\n';

    const groupedResults = this.groupResults(results);

    for (const [type, typeResults] of Object.entries(groupedResults)) {
      const icon = this.getIcon(typeResults[0].status);
      const header = this.getHeader(type);
      output += `${header}\n`;

      for (const result of typeResults) {
        const statusIcon = this.getStatusIcon(result.status);
        const statusColor = this.getStatusColor(result.status);
        output += `  ${statusIcon} ${statusColor(result.message)}\n`;
        
        if (result.details) {
          this.addDetails(output, result);
        }
      }
      output += '\n';
    }

    output += this.formatSummary(results);
    return output;
  }

  private formatPlain(results: CheckResult[]): string {
    let output = 'PULSELIVE — your project, right now\n\n';

    const groupedResults = this.groupResults(results);

    for (const [type, typeResults] of Object.entries(groupedResults)) {
      const header = this.getHeader(type);
      output += `${header}\n`;

      for (const result of typeResults) {
        const statusIcon = this.getStatusIcon(result.status);
        output += `  ${statusIcon} ${result.message}\n`;
        
        if (result.details) {
          this.addDetails(output, result);
        }
      }
      output += '\n';
    }

    output += this.formatSummary(results);
    return output;
  }

  private groupResults(results: CheckResult[]): Record<string, CheckResult[]> {
    const grouped: Record<string, CheckResult[]> = {};
    
    for (const result of results) {
      const type = this.getTypeHeader(result.type);
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(result);
    }
    
    return grouped;
  }

  private getTypeHeader(type: string): string {
    switch (type) {
      case 'ci': return 'CI/CD';
      case 'deploy': return 'Deploys';
      case 'health': return 'Endpoints';
      case 'git': return 'Git';
      case 'issues': return 'Issues';
      case 'deps': return 'Dependencies';
      default: return type;
    }
  }

  private getHeader(type: string): string {
    const icons: Record<string, string> = {
      'CI/CD': '🔄',
      'Deploys': '🚀',
      'Endpoints': '🌐',
      'Git': '📋',
      'Issues': '🐛',
      'Dependencies': '📦'
    };
    
    const icon = icons[type] || '📊';
    return `${icon} ${type}:`;
  }

  private getIcon(status: string): string {
    switch (status) {
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return 'ℹ️';
    }
  }

  private getStatusIcon(status: string): string {
    return this.getIcon(status);
  }

  private getStatusColor(status: string): (text: string) => string {
    if (!this.useColors) {
      return (text: string) => text;
    }
    
    switch (status) {
      case 'success': return chalk.green;
      case 'warning': return chalk.yellow;
      case 'error': return chalk.red;
      default: return chalk.white;
    }
  }

  private addDetails(output: string, result: CheckResult): void {
    // Add details in a more readable format
    if (result.details) {
      if (result.type === 'git' && result.details) {
        output += `    Branch: ${result.details.branch}\n`;
        output += `    Uncommitted: ${result.details.uncommitted} files\n`;
        if (result.details.recentCommits && result.details.recentCommits.length > 0) {
          output += `    Recent: "${result.details.recentCommits[0]}"\n`;
        }
        output += `    Divergence: ${result.details.divergence}\n`;
      } else if (result.type === 'deps' && result.details) {
        const vuln = result.details.vulnerabilities;
        if (vuln.critical > 0 || vuln.high > 0) {
          output += `    ❌ ${vuln.critical + vuln.high} high/critical vulnerabilities\n`;
        }
        if (result.details.outdated > 0) {
          output += `    ⚠️  ${result.details.outdated} outdated packages\n`;
        }
      }
    }
  }

  private formatSummary(results: CheckResult[]): string {
    const criticalCount = results.filter(r => r.status === 'error').length;
    const warningCount = results.filter(r => r.status === 'warning').length;
    
    if (this.useColors) {
      return chalk.bold('📊 Summary:') + 
             ` ${chalk.red(criticalCount)} critical, ` +
             `${chalk.yellow(warningCount)} warnings\n`;
    } else {
      return '📊 Summary: ' + criticalCount + ' critical, ' + warningCount + ' warnings\n';
    }
  }
}