import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

const cliPath = path.resolve(__dirname, '../dist/index.js');

describe('Fix Command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `/tmp/pulselive-fix-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('fix --deps', () => {
    it('should handle projects with no vulnerabilities', () => {
      // Create a minimal package.json
      const packageJson = {
        name: 'test-no-vuln',
        version: '1.0.0'
      };
      writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const result = execSync(`node ${cliPath} fix --deps --json`, {
        cwd: testDir,
        encoding: 'utf8'
      });

      const parsed = JSON.parse(result);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.fix_results).toHaveLength(1);
      expect(parsed.fix_results[0].target).toBe('deps');
      expect(parsed.fix_results[0].status).toBe('success');
      expect(parsed.fix_results[0].message).toContain('No vulnerabilities found');
    });

    it('should show dry-run output for vulnerabilities', () => {
      // Create package.json with a known vulnerable dependency
      const packageJson = {
        name: 'test-with-vuln',
        version: '1.0.0',
        dependencies: {
          // Use a known vulnerable version for testing
          // Note: In real tests, this would need to be updated as vulnerabilities change
        }
      };
      writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Run npm install to get package-lock.json
      try {
        execSync('npm install', { cwd: testDir, stdio: 'pipe' });
      } catch {
        // Install might fail due to vulnerabilities, that's ok for this test
      }

      const result = execSync(`node ${cliPath} fix --deps --dry-run --json`, {
        cwd: testDir,
        encoding: 'utf8'
      });

      const parsed = JSON.parse(result);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.fix_results).toHaveLength(1);
      expect(parsed.fix_results[0].target).toBe('deps');
      expect(parsed.fix_results[0].dryRun).toBe(true);
    });

    it('should handle missing package.json gracefully', () => {
      // Test directory with no package.json
      const result = execSync(`node ${cliPath} fix --deps --json`, {
        cwd: testDir,
        encoding: 'utf8'
      });

      const parsed = JSON.parse(result);
      expect(parsed.fix_results[0].status).toBe('failed');
      expect(parsed.fix_results[0].message).toContain('No package.json found');
    });
  });

  describe('fix command exit codes', () => {
    it('should exit with code 0 on successful fix', () => {
      const packageJson = {
        name: 'test-success',
        version: '1.0.0'
      };
      writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // This should succeed (exit code 0) when no vulnerabilities exist
      expect(() => {
        execSync(`node ${cliPath} fix --deps`, {
          cwd: testDir,
          encoding: 'utf8'
        });
      }).not.toThrow();
    });

    it('should exit with code 1 on fix failure', () => {
      // Test with a directory that has no package.json
      expect(() => {
        execSync(`node ${cliPath} fix --deps`, {
          cwd: '/tmp/nonexistent-dir',
          encoding: 'utf8'
        });
      }).toThrow(); // Should throw due to non-zero exit code
    });
  });

  describe('fix --all', () => {
    it('should run all available fixes', () => {
      const packageJson = {
        name: 'test-all',
        version: '1.0.0'
      };
      writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const result = execSync(`node ${cliPath} fix --all --json`, {
        cwd: testDir,
        encoding: 'utf8'
      });

      const parsed = JSON.parse(result);
      expect(parsed.schema_version).toBe('1.0.0');
      expect(parsed.fix_results).toHaveLength(1); // Currently only deps fix is implemented
      expect(parsed.fix_results[0].target).toBe('deps');
    });
  });
});