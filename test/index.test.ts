import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { VERSION } from '../src/version';

const cliPath = path.resolve(__dirname, '../dist/index.js');

describe('CLI entry point', () => {
  describe('--version', () => {
    it('outputs the current version', () => {
      const result = execFileSync('node', [cliPath, '--version'], { encoding: 'utf8' });
      expect(result.trim()).toBe(VERSION);
    });
  });

  describe('--help', () => {
    it('shows check, init, trends, anomalies, history commands', () => {
      const result = execFileSync('node', [cliPath, '--help'], { encoding: 'utf8' });
      expect(result).toContain('check');
      expect(result).toContain('init');
      expect(result).toContain('trends');
      expect(result).toContain('anomalies');
      expect(result).toContain('history');
    });
  });

  describe('check --help', () => {
    it('shows check options', () => {
      const result = execFileSync('node', [cliPath, 'check', '--help'], { encoding: 'utf8' });
      expect(result).toContain('--json');
      expect(result).toContain('--junit');
      expect(result).toContain('--fail-on-error');
      expect(result).toContain('--verbose');
    });
  });

  describe('check command', () => {
    it('runs checks and outputs results', () => {
      const tmpDir = '/tmp/pulsetel-check-test';
      mkdirSync(tmpDir, { recursive: true });
      const result = execFileSync('node', [cliPath, 'check', '--json'], {
        encoding: 'utf8',
        cwd: tmpDir,
        timeout: 30000,
      });
      const parsed = JSON.parse(result.trim());
      expect(typeof parsed).toBe('object');
      // JSON output may be array or object with results key
      if (parsed.results) {
        expect(Array.isArray(parsed.results)).toBe(true);
      }
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('init command', () => {
    it('creates .pulsetel.yml', () => {
      const tmpDir = '/tmp/pulsetel-init-test';
      mkdirSync(tmpDir, { recursive: true });
      execFileSync('node', [cliPath, 'init'], {
        encoding: 'utf8',
        cwd: tmpDir,
        timeout: 10000,
      });
      expect(existsSync(path.join(tmpDir, '.pulsetel.yml'))).toBe(true);
      const content = readFileSync(path.join(tmpDir, '.pulsetel.yml'), 'utf8');
      expect(content).toContain('github');
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('history command', () => {
    it('runs without error when no history exists', () => {
      const tmpDir = '/tmp/pulsetel-history-test';
      mkdirSync(tmpDir, { recursive: true });
      const result = execFileSync('node', [cliPath, 'history'], {
        encoding: 'utf8',
        cwd: tmpDir,
        timeout: 10000,
      });
      expect(result).toBeDefined();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('trends command', () => {
    it('runs without error when no history exists', () => {
      const tmpDir = '/tmp/pulsetel-trends-test';
      mkdirSync(tmpDir, { recursive: true });
      const result = execFileSync('node', [cliPath, 'trends'], {
        encoding: 'utf8',
        cwd: tmpDir,
        timeout: 10000,
      });
      expect(result).toBeDefined();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('anomalies command', () => {
    it('runs without error when no history exists', () => {
      const tmpDir = '/tmp/pulsetel-anomalies-test';
      mkdirSync(tmpDir, { recursive: true });
      const result = execFileSync('node', [cliPath, 'anomalies'], {
        encoding: 'utf8',
        cwd: tmpDir,
        timeout: 10000,
      });
      expect(result).toBeDefined();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});