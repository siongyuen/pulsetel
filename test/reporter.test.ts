import { describe, it, expect } from 'vitest';
import { Reporter } from '../src/reporter';
import { CheckResult } from '../src/scanner';

describe('Reporter', () => {
  describe('formatJunit', () => {
    it('should generate valid JUnit XML', () => {
      const reporter = new Reporter(false);
      
      const results: CheckResult[] = [
        {
          type: 'ci',
          status: 'success',
          message: 'CI check passed'
        },
        {
          type: 'health',
          status: 'warning',
          message: 'Some endpoints have issues'
        },
        {
          type: 'deps',
          status: 'error',
          message: 'Vulnerabilities found',
          details: {
            vulnerabilities: { critical: 2, high: 3 }
          }
        }
      ];
      
      const xml = reporter.formatJunit(results);
      
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<testsuites>');
      expect(xml).toContain('<testsuite name="pulselive" tests="3">');
      expect(xml).toContain('<testcase name="ci" classname="pulselive.ci">');
      expect(xml).toContain('<testcase name="health" classname="pulselive.health">');
      expect(xml).toContain('<testcase name="deps" classname="pulselive.deps">');
      expect(xml).toContain('<failure message="Vulnerabilities found">');
      expect(xml).toContain('</testsuites>');
    });

    it('should escape XML special characters', () => {
      const reporter = new Reporter(false);
      
      const results: CheckResult[] = [
        {
          type: 'test',
          status: 'error',
          message: 'Error with special chars: <>&"\'',
          details: {
            info: 'More special chars: <>&"\''
          }
        }
      ];
      
      const xml = reporter.formatJunit(results);
      
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&quot;');
      expect(xml).toContain('&apos;');
    });
  });

  describe('escapeXml', () => {
    it('should escape XML special characters', () => {
      const reporter = new Reporter(false);
      // Access the private method through a workaround
      const escapeXml = (reporter as any).escapeXml;
      
      const result = escapeXml('Test <>&"\'');
      expect(result).toBe('Test &lt;&gt;&amp;&quot;&apos;');
    });
  });
});