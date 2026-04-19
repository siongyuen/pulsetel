import { describe, it, expect, beforeEach } from 'vitest';
import { Reporter } from '../src/reporter';
import { CheckResult } from '../src/scanner';

describe('Reporter', () => {
  let reporter: Reporter;

  beforeEach(() => {
    reporter = new Reporter(true);
  });

  describe('format', () => {
    it('should format results with colors when useColors is true', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI checks passed', duration: 100 },
        { type: 'deps', status: 'warning', message: 'Outdated dependencies', duration: 50 }
      ];

      const output = reporter.format(results);
      expect(output).toContain('PULSETEL');
      expect(output).toContain('CI checks passed');
      expect(output).toContain('Outdated dependencies');
      expect(output).toContain('Summary:');
    });

    it('should format results without colors when useColors is false', () => {
      const reporterNoColor = new Reporter(false);
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI checks passed', duration: 100 }
      ];

      const output = reporterNoColor.format(results);
      expect(output).toContain('PULSETEL');
      expect(output).toContain('CI checks passed');
      expect(output).not.toContain('\u001b['); // No ANSI color codes
    });
  });

  describe('formatJson', () => {
    it('should format results as JSON', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI checks passed', duration: 100 },
        { type: 'deps', status: 'warning', message: 'Outdated dependencies', duration: 50 }
      ];

      const output = reporter.formatJson(results);
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('ci');
      expect(parsed[1].type).toBe('deps');
    });

    it('should handle empty results array', () => {
      const output = reporter.formatJson([]);
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(0);
    });
  });

  describe('formatVerbose', () => {
    it('should format results with verbose details including duration', () => {
      const results: CheckResult[] = [
        { 
          type: 'ci', 
          status: 'success', 
          message: 'CI checks passed', 
          duration: 100,
          details: { runCount: 10, failCount: 0 }
        }
      ];

      const output = reporter.formatVerbose(results);
      expect(output).toContain('PULSETEL');
      expect(output).toContain('verbose');
      expect(output).toContain('CI checks passed');
      expect(output).toContain('[100ms]');
      expect(output).toContain('runCount');
      expect(output).toContain('failCount');
    });

    it('should include details for each result type', () => {
      const results: CheckResult[] = [
        { 
          type: 'git', 
          status: 'warning', 
          message: 'Uncommitted changes', 
          duration: 50,
          details: { 
            branch: 'main',
            uncommitted: 2,
            recentCommits: ['Fix bug'],
            divergence: 0
          }
        }
      ];

      const output = reporter.formatVerbose(results);
      expect(output).toContain('Uncommitted changes');
      expect(output).toContain('branch');
      expect(output).toContain('uncommitted');
      expect(output).toContain('recentCommits');
    });

    it('should include summary in verbose output', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'error', message: 'CI failed', duration: 100 },
        { type: 'deps', status: 'warning', message: 'Outdated', duration: 50 }
      ];

      const output = reporter.formatVerbose(results);
      expect(output).toContain('Summary:');
      expect(output).toContain('critical');
      expect(output).toContain('warnings');
    });
  });

  describe('formatJunit', () => {
    it('should format results as JUnit XML', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI checks passed', duration: 100 },
        { type: 'deps', status: 'error', message: 'Critical vulnerability', duration: 50, 
          details: { vulnerabilities: { critical: 1, high: 2 } } }
      ];

      const output = reporter.formatJunit(results);
      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(output).toContain('<testsuites>');
      expect(output).toContain('<testsuite name="pulsetel" tests="2">');
      expect(output).toContain('<testcase name="ci" classname="pulsetel.ci">');
      expect(output).toContain('<testcase name="deps" classname="pulsetel.deps">');
      expect(output).toContain('<failure message="Critical vulnerability">');
      expect(output).toContain('</testsuites>');
    });

    it('should escape XML special characters in messages', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'error', message: 'CI failed with error: <test> & "more"', duration: 100 }
      ];

      const output = reporter.formatJunit(results);
      expect(output).toContain('&lt;test&gt;');
      expect(output).toContain('&amp;');
      expect(output).toContain('&quot;');
    });

    it('should include failure details for error status', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'error', message: 'CI failed', duration: 100, 
          details: { error: 'Build failed', exitCode: 1 } }
      ];

      const output = reporter.formatJunit(results);
      expect(output).toContain('<failure message="CI failed">');
      expect(output).toContain('Build failed');
      expect(output).toContain('exitCode');
    });

    it('should not include failure section for non-error status', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI passed', duration: 100 }
      ];

      const output = reporter.formatJunit(results);
      expect(output).not.toContain('<failure');
      expect(output).toContain('<testcase name="ci"');
    });

    it('should handle empty details object', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'error', message: 'CI failed', duration: 100, details: {} }
      ];

      const output = reporter.formatJunit(results);
      expect(output).toContain('<failure message="CI failed">');
      expect(output).toContain('{}');
    });
  });

  describe('escapeXml', () => {
    it('should escape XML special characters', () => {
      const input = 'Test <script> & "quoted" \'text\'';
      const expected = 'Test &lt;script&gt; &amp; &quot;quoted&quot; &apos;text&apos;';
      
      const output = (reporter as any).escapeXml(input);
      expect(output).toBe(expected);
    });

    it('should handle empty string', () => {
      const output = (reporter as any).escapeXml('');
      expect(output).toBe('');
    });

    it('should handle string with no special characters', () => {
      const output = (reporter as any).escapeXml('Hello World');
      expect(output).toBe('Hello World');
    });
  });

  describe('groupResults', () => {
    it('should group results by type header', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI passed', duration: 100 },
        { type: 'ci', status: 'warning', message: 'CI warning', duration: 50 },
        { type: 'deps', status: 'error', message: 'Deps failed', duration: 30 }
      ];

      const grouped = (reporter as any).groupResults(results);
      expect(grouped['CI/CD']).toHaveLength(2);
      expect(grouped['CI/CD'][0].type).toBe('ci');
      expect(grouped['CI/CD'][1].type).toBe('ci');
      expect(grouped['Dependencies']).toHaveLength(1);
      expect(grouped['Dependencies'][0].type).toBe('deps');
    });

    it('should handle all check types', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI', duration: 100 },
        { type: 'deploy', status: 'success', message: 'Deploy', duration: 100 },
        { type: 'health', status: 'success', message: 'Health', duration: 100 },
        { type: 'git', status: 'success', message: 'Git', duration: 100 },
        { type: 'issues', status: 'success', message: 'Issues', duration: 100 },
        { type: 'prs', status: 'success', message: 'PRs', duration: 100 },
        { type: 'coverage', status: 'success', message: 'Coverage', duration: 100 },
        { type: 'deps', status: 'success', message: 'Deps', duration: 100 }
      ];

      const grouped = (reporter as any).groupResults(results);
      expect(Object.keys(grouped)).toHaveLength(8);
      expect(grouped['CI/CD']).toBeDefined();
      expect(grouped['Deploys']).toBeDefined();
      expect(grouped['Endpoints']).toBeDefined();
      expect(grouped['Git']).toBeDefined();
      expect(grouped['Issues']).toBeDefined();
      expect(grouped['Pull Requests']).toBeDefined();
      expect(grouped['Coverage']).toBeDefined();
      expect(grouped['Dependencies']).toBeDefined();
    });
  });

  describe('getTypeHeader', () => {
    it('should return correct headers for all check types', () => {
      const typeHeader = (reporter as any).getTypeHeader;
      
      expect(typeHeader('ci')).toBe('CI/CD');
      expect(typeHeader('deploy')).toBe('Deploys');
      expect(typeHeader('health')).toBe('Endpoints');
      expect(typeHeader('git')).toBe('Git');
      expect(typeHeader('issues')).toBe('Issues');
      expect(typeHeader('prs')).toBe('Pull Requests');
      expect(typeHeader('coverage')).toBe('Coverage');
      expect(typeHeader('deps')).toBe('Dependencies');
      expect(typeHeader('unknown')).toBe('unknown');
    });
  });

  describe('getHeader', () => {
    it('should return correct headers with icons', () => {
      const header = (reporter as any).getHeader;
      
      expect(header('CI/CD')).toBe('🔄 CI/CD:');
      expect(header('Deploys')).toBe('🚀 Deploys:');
      expect(header('Endpoints')).toBe('🌐 Endpoints:');
      expect(header('Git')).toBe('📋 Git:');
      expect(header('Issues')).toBe('🐛 Issues:');
      expect(header('Pull Requests')).toBe('🔀 Pull Requests:');
      expect(header('Coverage')).toBe('📊 Coverage:');
      expect(header('Dependencies')).toBe('📖 Dependencies:');
      expect(header('Unknown')).toBe('📊 Unknown:');
    });
  });

  describe('getIcon', () => {
    it('should return correct icons for statuses', () => {
      const icon = (reporter as any).getIcon;
      
      expect(icon('success')).toBe('✅');
      expect(icon('warning')).toBe('⚠️');
      expect(icon('error')).toBe('❌');
      expect(icon('unknown')).toBe('ℹ️');
    });
  });

  describe('getStatusIcon', () => {
    it('should return status icons', () => {
      const statusIcon = (reporter as any).getStatusIcon.bind(reporter);
      
      expect(statusIcon('success')).toBe('✅');
      expect(statusIcon('warning')).toBe('⚠️');
      expect(statusIcon('error')).toBe('❌');
    });
  });

  describe('getStatusColor', () => {
    it('should return color functions when useColors is true', () => {
      const statusColor = (reporter as any).getStatusColor('success');
      const result = statusColor('test');
      expect(typeof result).toBe('string');
      expect(result).toContain('test');
    });

    it('should return identity function when useColors is false', () => {
      const reporterNoColor = new Reporter(false);
      const statusColor = (reporterNoColor as any).getStatusColor('success');
      const result = statusColor('test');
      expect(result).toBe('test');
    });

    it('should return different colors for different statuses', () => {
      const successColor = (reporter as any).getStatusColor('success');
      const warningColor = (reporter as any).getStatusColor('warning');
      const errorColor = (reporter as any).getStatusColor('error');
      
      const successResult = successColor('success');
      const warningResult = warningColor('warning');
      const errorResult = errorColor('error');
      
      expect(successResult).not.toBe(warningResult);
      expect(warningResult).not.toBe(errorResult);
    });
  });

  describe('addDetails', () => {
    it('should add git details in readable format', () => {
      const result: CheckResult = {
        type: 'git',
        status: 'warning',
        message: 'Uncommitted changes',
        duration: 50,
        details: {
          branch: 'main',
          uncommitted: 2,
          recentCommits: ['Fix bug', 'Update docs'],
          divergence: 0
        }
      };

      const output = (reporter as any).addDetails('', result);
      expect(output).toContain('Branch: main');
      expect(output).toContain('Uncommitted: 2 files');
      expect(output).toContain('Recent: "Fix bug"');
      expect(output).toContain('Divergence: 0');
    });

    it('should add deps details with vulnerability counts', () => {
      const result: CheckResult = {
        type: 'deps',
        status: 'error',
        message: 'Critical vulnerabilities',
        duration: 30,
        details: {
          vulnerabilities: { critical: 2, high: 3, moderate: 5 },
          outdated: 10
        }
      };

      const output = (reporter as any).addDetails('', result);
      expect(output).toContain('❌ 5 high/critical vulnerabilities');
      expect(output).toContain('⚠️  10 outdated packages');
    });

    it('should add PR details with review status', () => {
      const result: CheckResult = {
        type: 'prs',
        status: 'warning',
        message: 'PRs need review',
        duration: 40,
        details: {
          open: 5,
          needsReview: 3,
          hasConflicts: 1,
          drafts: 2
        }
      };

      const output = (reporter as any).addDetails('', result);
      expect(output).toContain('⚠️  3 need review');
      expect(output).toContain('❌ 1 have conflicts');
      expect(output).toContain('📝 2 drafts');
    });

    it('should add health details with endpoint latencies', () => {
      const result: CheckResult = {
        type: 'health',
        status: 'warning',
        message: 'Endpoint slow',
        duration: 60,
        details: [
          { name: 'api', responseTime: 200, baseline: 100 },
          { name: 'web', responseTime: 50 }
        ]
      };

      const output = (reporter as any).addDetails('', result);
      expect(output).toContain('api: 200ms');
      expect(output).toContain('2.0x baseline');
      expect(output).toContain('web: 50ms');
    });

    it('should handle result with no details', () => {
      const result: CheckResult = {
        type: 'ci',
        status: 'success',
        message: 'CI passed',
        duration: 100
      };

      const output = (reporter as any).addDetails('', result);
      expect(output).toBe('');
    });

    it('should handle unknown result type with details', () => {
      const result: CheckResult = {
        type: 'unknown',
        status: 'warning',
        message: 'Unknown check',
        duration: 50,
        details: { some: 'data' }
      };

      const output = (reporter as any).addDetails('', result);
      expect(output).toBe('');
    });
  });

  describe('formatSummary', () => {
    it('should format summary with critical and warning counts', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'error', message: 'CI failed', duration: 100 },
        { type: 'deps', status: 'warning', message: 'Outdated', duration: 50 },
        { type: 'health', status: 'success', message: 'Healthy', duration: 30 }
      ];

      const summary = (reporter as any).formatSummary(results);
      expect(summary).toContain('Summary:');
      expect(summary).toContain('1 critical');
      expect(summary).toContain('1 warnings');
    });

    it('should handle zero counts', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI passed', duration: 100 }
      ];

      const summary = (reporter as any).formatSummary(results);
      expect(summary).toContain('0 critical');
      expect(summary).toContain('0 warnings');
    });

    it('should format without colors when useColors is false', () => {
      const reporterNoColor = new Reporter(false);
      const results: CheckResult[] = [
        { type: 'ci', status: 'error', message: 'CI failed', duration: 100 }
      ];

      const summary = (reporterNoColor as any).formatSummary(results);
      expect(summary).toContain('1 critical');
      expect(summary).not.toContain('\u001b['); // No ANSI color codes
    });
  });

  describe('formatColored', () => {
    it('should format with colors and icons', () => {
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI passed', duration: 100 }
      ];

      const output = (reporter as any).formatColored(results);
      expect(output).toContain('PULSETEL');
      expect(output).toContain('🔄 CI/CD:');
      expect(output).toContain('✅');
      expect(output).toContain('CI passed');
      expect(output).toContain('Summary:');
    });

    it('should include details for git results', () => {
      const results: CheckResult[] = [
        { 
          type: 'git', 
          status: 'warning', 
          message: 'Uncommitted changes', 
          duration: 50,
          details: { 
            branch: 'main',
            uncommitted: 2,
            recentCommits: ['Fix bug'],
            divergence: 0
          }
        }
      ];

      const output = (reporter as any).formatColored(results);
      expect(output).toContain('Branch: main');
      expect(output).toContain('Uncommitted: 2 files');
    });
  });

  describe('formatPlain', () => {
    it('should format without colors but with icons', () => {
      const reporterPlain = new Reporter(false);
      const results: CheckResult[] = [
        { type: 'ci', status: 'success', message: 'CI passed', duration: 100 }
      ];

      const output = (reporterPlain as any).formatPlain(results);
      expect(output).toContain('PULSETEL');
      expect(output).toContain('🔄 CI/CD:');
      expect(output).toContain('✅');
      expect(output).toContain('CI passed');
      expect(output).not.toContain('\u001b['); // No ANSI color codes
    });

    it('should include details in plain format', () => {
      const reporterPlain = new Reporter(false);
      const results: CheckResult[] = [
        { 
          type: 'deps', 
          status: 'error', 
          message: 'Critical vulnerabilities', 
          duration: 30,
          details: { 
            vulnerabilities: { critical: 2, high: 3 },
            outdated: 10
          }
        }
      ];

      const output = (reporterPlain as any).formatPlain(results);
      expect(output).toContain('❌ 5 high/critical vulnerabilities');
      expect(output).toContain('⚠️  10 outdated packages');
    });
  });
});