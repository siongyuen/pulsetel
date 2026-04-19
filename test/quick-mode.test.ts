import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { Scanner } from '../src/scanner';
import { ConfigLoader } from '../src/config';
import { MCPServer } from '../src/mcp-server';
import { MCPStdioServer } from '../src/mcp-stdio';

describe('Quick mode', () => {
  let scanner: Scanner;
  let config: any;

  beforeEach(() => {
    const configLoader = new ConfigLoader();
    config = configLoader.autoDetect();
    scanner = new Scanner(config);
  });

  describe('Scanner.runQuickChecks', () => {
    it('returns results for fast checks only', async () => {
      const results = await scanner.runQuickChecks();
      const types = results.map(r => r.type);

      // deps should appear as a skipped placeholder, not a real check result
      const depsResult = results.find(r => r.type === 'deps');
      if (depsResult) {
        expect(depsResult.status).toBe('warning');
        expect(depsResult.message).toContain('skipped in quick mode');
      }

      // Skipped checks should appear as warnings
      const skipped = results.filter(r => r.status === 'warning' && r.message.includes('skipped in quick mode'));
      expect(skipped.length).toBeGreaterThanOrEqual(1);
    });

    it('includes warning placeholders for skipped checks', async () => {
      const results = await scanner.runQuickChecks();
      const skipped = results.filter(r => r.status === 'warning' && r.message.includes('skipped in quick mode'));

      for (const skip of skipped) {
        expect(skip.duration).toBe(0);
        expect(skip.message).toContain('quick mode');
      }
    });

    it('runs faster than full check', async () => {
      const quickStart = Date.now();
      await scanner.runQuickChecks();
      const quickDuration = Date.now() - quickStart;

      const fullStart = Date.now();
      await scanner.runAllChecks();
      const fullDuration = Date.now() - fullStart;

      // Quick should be faster (or at least not slower)
      expect(quickDuration).toBeLessThanOrEqual(fullDuration);
    });
  });

  describe('MCP pulsetel_quick tool', () => {
    it('handleToolRequest dispatches pulsetel_quick', async () => {
      const server = new MCPServer(new ConfigLoader());
      const result = await (server as any).handleToolRequest('pulsetel_quick', undefined, {});
      expect(result).toBeDefined();
      expect(result.quick).toBe(true);
      expect(result.results).toBeDefined();
      expect(result.summary.note).toContain('Quick mode');
    });

    it('quick response includes duration', async () => {
      const server = new MCPServer(new ConfigLoader());
      const result = await (server as any).handleToolRequest('pulsetel_quick', undefined, {});
      expect(result.duration).toBeDefined();
      expect(typeof result.duration).toBe('number');
    });

    it('pulsetel_quick is in VALID_TOOLS', async () => {
      const server = new MCPServer(new ConfigLoader());
      // Should not throw for pulsetel_quick
      const result = await (server as any).handleToolRequest('pulsetel_quick', undefined, {});
      expect(result).toBeDefined();
    });
  });

  describe('CLI --quick flag and quick command', () => {
    it('pulsetel check --quick is a valid option', () => {
      const cliPath = path.resolve(__dirname, '../dist/index.js');
      const result = execFileSync('node', [cliPath, 'check', '--help'], { encoding: 'utf8' });
      expect(result).toContain('--quick');
    });

    it('pulsetel quick command exists', () => {
      const cliPath = path.resolve(__dirname, '../dist/index.js');
      const result = execFileSync('node', [cliPath, '--help'], { encoding: 'utf8' });
      expect(result).toContain('quick');
    });
  });
});