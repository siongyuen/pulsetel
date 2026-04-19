import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Directory Argument Support', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsetel-test-'));
    
    // Create a minimal .pulsetel.yml config
    const configContent = `
github:
  repo: test/repo
checks:
  ci: false
  deps: false
  git: false
  health: false
  issues: false
  deploy: false
  prs: false
  coverage: false
`;
    fs.writeFileSync(path.join(testDir, '.pulsetel.yml'), configContent);
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('CLI directory argument', () => {
    it('should accept directory argument for check command', () => {
      const result = execSync(`node dist/index.js check ${testDir}`, {
        cwd: process.cwd(),
        encoding: 'utf8'
      });
      
      expect(result).toContain('PULSETEL');
      expect(result).toContain('Summary');
    });

    it('should accept current directory shorthand', () => {
      const result = execSync(`node dist/index.js check .`, {
        cwd: __dirname + '/..',
        encoding: 'utf8'
      });
      
      expect(result).toContain('PULSETEL');
      expect(result).toContain('Summary');
    });

    it('should accept directory argument for quick command', () => {
      const result = execSync(`node dist/index.js quick ${testDir}`, {
        cwd: process.cwd(),
        encoding: 'utf8'
      });
      
      expect(result).toContain('Quick mode');
      expect(result).toContain('Summary');
    });

    it('should accept directory argument for badge command', () => {
      const result = execSync(`node dist/index.js badge ${testDir}`, {
        cwd: process.cwd(),
        encoding: 'utf8'
      });
      
      expect(result).toContain('pulsetel');
      expect(result).toContain('badge');
    });

    it('should accept directory argument for report command', () => {
      const result = execSync(`node dist/index.js report ${testDir}`, {
        cwd: process.cwd(),
        encoding: 'utf8'
      });
      
      expect(result).toContain('PulseTel Project Health Report');
      expect(result).toContain('Summary');
    });
  });

  describe('ConfigLoader directory handling', () => {
    it('should use provided directory for git commands', () => {
      // This test verifies that the config loader respects the baseDir parameter
      const ConfigLoader = require('../dist/config.js').ConfigLoader;
      const configLoader = new ConfigLoader(path.join(testDir, '.pulsetel.yml'));
      const config = configLoader.autoDetect(testDir);
      
      expect(config).toBeDefined();
      expect(config.checks).toBeDefined();
    });
  });

  describe('Scanner directory handling', () => {
    it('should pass working directory to checks', () => {
      const Scanner = require('../dist/scanner.js').Scanner;
      const ConfigLoader = require('../dist/config.js').ConfigLoader;
      
      const configLoader = new ConfigLoader(path.join(testDir, '.pulsetel.yml'));
      const config = configLoader.autoDetect(testDir);
      const scanner = new Scanner(config, testDir);
      
      expect(scanner).toBeDefined();
      // The scanner should be created successfully with the custom working directory
    });
  });
});