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

  formatVerbose(results: CheckResult[]): string {
    let output = 'PULSETEL \u2014 your project, right now (verbose)\n\n';

    for (const result of results) {
      const statusIcon = this.getStatusIcon(result.status);
      const statusColor = this.getStatusColor(result.status);
      const duration = result.duration ? ` [${result.duration}ms]` : '';
      output += `${statusIcon} ${statusColor(result.type)}: ${statusColor(result.message)}${duration}\n`;
      
      if (result.details) {
        output += `    ${JSON.stringify(result.details, null, 2).split('\n').join('\n    ')}\n`;
      }
      output += '\n';
    }

    output += this.formatSummary(results);
    return output;
  }

  formatJunit(results: CheckResult[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<testsuites>\n';
    xml += '  <testsuite name="pulsetel" tests="' + results.length + '">\n';
    
    for (const result of results) {
      const status = result.status;
      const isFailure = status === 'error';
      
      xml += '    <testcase name="' + this.escapeXml(result.type) + '" classname="pulsetel.' + result.type + '">';
      
      if (isFailure) {
        xml += '\n      <failure message="' + this.escapeXml(result.message) + '">';
        xml += this.escapeXml(JSON.stringify(result.details || {}, null, 2));
        xml += '</failure>';
      }
      
      xml += '\n    </testcase>\n';
    }
    
    xml += '  </testsuite>\n';
    xml += '</testsuites>';
    
    return xml;
  }

  private escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&apos;');
  }

  private formatColored(results: CheckResult[]): string {
    let output = chalk.bold('PULSETEL — your project, right now') + '\n\n';

    const groupedResults = this.groupResults(results);

    for (const [type, typeResults] of Object.entries(groupedResults)) {
const header = this.getHeader(type);
      output += `${header}\n`;

      for (const result of typeResults) {
        const statusIcon = this.getStatusIcon(result.status);
        const statusColor = this.getStatusColor(result.status);
        output += `  ${statusIcon} ${statusColor(result.message)}\n`;
        
        if (result.details) {
          output = this.addDetails(output, result);
        }
      }
      output += '\n';
    }

    output += this.formatSummary(results);
    return output;
  }

  private formatPlain(results: CheckResult[]): string {
    let output = 'PULSETEL — your project, right now\n\n';

    const groupedResults = this.groupResults(results);

    for (const [type, typeResults] of Object.entries(groupedResults)) {
      const header = this.getHeader(type);
      output += `${header}\n`;

      for (const result of typeResults) {
        const statusIcon = this.getStatusIcon(result.status);
        output += `  ${statusIcon} ${result.message}\n`;
        
        if (result.details) {
          output = this.addDetails(output, result);
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
      case 'deps': return 'Dependencies';
      case 'health': return 'Endpoints';
      case 'git': return 'Git';
      case 'issues': return 'Issues';
      case 'prs': return 'Pull Requests';
      case 'coverage': return 'Coverage';
      case 'sentry': return 'Sentry';
      default: return type;
    }
  }

  private getHeader(type: string): string {
    const icons: Record<string, string> = {
      'CI/CD': '🔄',
      'Deploys': '🚀',
      'Dependencies': '📖',
      'Endpoints': '🌐',
      'Git': '📋',
      'Issues': '🐛',
      'Pull Requests': '🔀',
      'Coverage': '📊',
      'Sentry': '🔴',
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

  private addDetails(output: string, result: CheckResult): string {
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
      } else if (result.type === 'prs' && result.details) {
        if (result.details.needsReview > 0) {
          output += `    ⚠️  ${result.details.needsReview} need review\n`;
        }
        if (result.details.hasConflicts > 0) {
          output += `    ❌ ${result.details.hasConflicts} have conflicts\n`;
        }
        if (result.details.drafts > 0) {
          output += `    📝 ${result.details.drafts} drafts\n`;
        }
      } else if (result.type === 'health' && result.details) {
        result.details.forEach((endpoint: any) => {
          if (endpoint.baseline && endpoint.responseTime > 0) {
            const ratio = endpoint.responseTime / endpoint.baseline;
            const baselineMsg = ` (${ratio.toFixed(1)}x baseline of ${endpoint.baseline}ms)`;
            output += `    ${endpoint.name}: ${endpoint.responseTime}ms${baselineMsg}\n`;
          } else {
            output += `    ${endpoint.name}: ${endpoint.responseTime}ms\n`;
          }
        });
      }
    }
    return output;
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