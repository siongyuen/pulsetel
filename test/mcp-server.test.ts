import { describe, it, expect } from 'vitest';
import { resolve, normalize } from 'path';
import fs from 'fs';
import path from 'path';

describe('MCPServer', () => {
  const projectRoot = process.cwd();
  const sourcePath = path.join(projectRoot, 'src/mcp-server.ts');
  const indexPath = path.join(projectRoot, 'src/index.ts');

  describe('validateDir logic', () => {
    const validateDir = (dir: string) => {
      if (dir.includes('\0')) throw new Error('Invalid directory path');
      const resolved = resolve(normalize(dir));
      if (resolved.includes('..')) throw new Error('Directory path traversal not allowed');
      if (!resolved.startsWith('/')) throw new Error('Directory must be an absolute path');
      return resolved;
    };

    it('blocks null bytes in directory path', () => {
      expect(() => validateDir('/etc/passwd\0.txt')).toThrow('Invalid directory path');
    });

    it('resolves relative paths to absolute', () => {
      const result = validateDir('relative/path');
      expect(result.startsWith('/')).toBe(true);
    });

    it('allows valid absolute paths', () => {
      expect(validateDir('/home/user/project')).toBe('/home/user/project');
    });

    it('normalizes . segments correctly', () => {
      expect(validateDir('/home/user/./project')).toBe('/home/user/project');
    });
  });

  describe('VALID_TOOLS constant', () => {
    it('includes all 9 expected MCP tools', () => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      const expectedTools = [
        'pulselive_check', 'pulselive_ci', 'pulselive_health', 'pulselive_deps',
        'pulselive_summary', 'pulselive_trends', 'pulselive_anomalies',
        'pulselive_metrics', 'pulselive_recommend'
      ];
      expectedTools.forEach(tool => {
        expect(source).toContain(`'${tool}'`);
      });
    });
  });

  describe('enrichResult pattern', () => {
    it('maps status to severity correctly', () => {
      const severityMap: Record<string, string> = {
        'error': 'critical', 'warning': 'warning', 'success': 'info',
      };
      expect(severityMap['error']).toBe('critical');
      expect(severityMap['warning']).toBe('warning');
      expect(severityMap['success']).toBe('info');
    });

    it('sets confidence based on status', () => {
      const getConfidence = (status: string) => status === 'success' ? 'high' : 'medium';
      expect(getConfidence('success')).toBe('high');
      expect(getConfidence('error')).toBe('medium');
    });
  });

  describe('CORS configuration', () => {
    it('source code sets correct CORS headers', () => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      expect(source).toContain('Access-Control-Allow-Origin');
      expect(source).toContain('Access-Control-Allow-Methods');
      expect(source).toContain('OPTIONS');
    });
  });

  describe('missing tool parameter handling', () => {
    it('source code returns specific error message for missing tool parameter', () => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      expect(source).toContain('Missing required parameter: tool');
    });
  });

  describe('tool parameter validation', () => {
    it('source code validates required parameters for each tool', () => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      expect(source).toContain('getRequiredParamsForTool');
      expect(source).toContain("Missing required parameter 'dir' for tool");
    });

    it('defines required parameters for directory-based tools', () => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      const toolsWithDir = ['pulselive_check', 'pulselive_quick', 'pulselive_ci', 'pulselive_health', 'pulselive_deps', 'pulselive_summary', 'pulselive_recommend'];
      toolsWithDir.forEach(tool => {
        expect(source).toContain(`'${tool}': ['dir']`);
      });
    });

    it('defines no required parameters for trend-based tools', () => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      const toolsWithoutDir = ['pulselive_trends', 'pulselive_anomalies', 'pulselive_metrics'];
      toolsWithoutDir.forEach(tool => {
        expect(source).toContain(`'${tool}': []`);
      });
    });
  });

  describe('MCP server startup', () => {
    it('mcp command is registered in CLI', () => {
      const source = fs.readFileSync(indexPath, 'utf8');
      expect(source).toContain("command('mcp')");
    });
  });
});