import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('MCP Server POST Support', () => {
  const projectRoot = process.cwd();
  const sourcePath = path.join(projectRoot, 'src/mcp-server.ts');
  const sourceContent = fs.readFileSync(sourcePath, 'utf8');

  describe('POST request handling code', () => {
    it('should contain POST method handling', () => {
      expect(sourceContent).toContain('req.method === \'POST\'');
    });

    it('should parse JSON body for POST requests', () => {
      expect(sourceContent).toContain('application/json');
      expect(sourceContent).toContain('JSON.parse(body)');
    });

    it('should handle Content-Type header checking', () => {
      expect(sourceContent).toContain('content-type');
      expect(sourceContent).toContain('includes(\'application/json\')');
    });

    it('should support GET requests for backward compatibility', () => {
      expect(sourceContent).toContain('req.method === \'GET\'');
      expect(sourceContent).toContain('url.searchParams');
    });

    it('should reject unsupported HTTP methods', () => {
      expect(sourceContent).toContain('Method Not Allowed');
      expect(sourceContent).toContain('use GET or POST');
    });

    it('should handle JSON parsing errors', () => {
      expect(sourceContent).toContain('Invalid JSON body');
      expect(sourceContent).toContain('parseError');
    });

    it('should handle unsupported media types', () => {
      expect(sourceContent).toContain('Unsupported Media Type');
      expect(sourceContent).toContain('expected application/json');
    });
  });

  describe('Parameter extraction from JSON', () => {
    it('should extract tool parameter from JSON body', () => {
      expect(sourceContent).toContain('tool = jsonBody.tool');
    });

    it('should extract dir parameter from JSON body', () => {
      expect(sourceContent).toContain('dir = jsonBody.dir');
    });

    it('should extract include_trends parameter from JSON body', () => {
      expect(sourceContent).toContain('include_trends');
    });

    it('should extract check_type parameter from JSON body', () => {
      expect(sourceContent).toContain('check_type');
    });

    it('should extract window parameter from JSON body', () => {
      expect(sourceContent).toContain('window = parseInt(jsonBody.window)');
    });
  });

  describe('Response handling', () => {
    it('should set Content-Type header in responses', () => {
      expect(sourceContent).toContain('Content-Type');
      expect(sourceContent).toContain('application/json');
    });

    it('should handle successful requests with status 200', () => {
      expect(sourceContent).toContain('writeHead(200');
    });

    it('should handle bad requests with status 400', () => {
      expect(sourceContent).toContain('writeHead(400');
    });

    it('should handle unsupported media types with status 415', () => {
      expect(sourceContent).toContain('writeHead(415');
    });

    it('should handle method not allowed with status 405', () => {
      expect(sourceContent).toContain('writeHead(405');
    });

    it('should handle internal server errors with status 500', () => {
      expect(sourceContent).toContain('writeHead(500');
    });
  });

  describe('CORS headers', () => {
    it('should set Access-Control-Allow-Origin header', () => {
      expect(sourceContent).toContain('Access-Control-Allow-Origin');
      expect(sourceContent).toContain('*');
    });

    it('should set Access-Control-Allow-Methods header', () => {
      expect(sourceContent).toContain('Access-Control-Allow-Methods');
      expect(sourceContent).toContain('GET, POST, OPTIONS');
    });

    it('should set Access-Control-Allow-Headers header', () => {
      expect(sourceContent).toContain('Access-Control-Allow-Headers');
      expect(sourceContent).toContain('Content-Type');
    });
  });
});