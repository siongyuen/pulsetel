import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPStdioServer } from '../src/mcp-stdio';
import { MCPServer } from '../src/mcp-server';
import { ConfigLoader } from '../src/config';
import { CheckResult } from '../src/scanner';

function makeMockConfigLoader(): ConfigLoader {
  return {
    autoDetect: vi.fn().mockReturnValue({
      github: { repo: 'test/repo' },
      checks: { ci: true },
    }),
    getConfig: vi.fn().mockReturnValue({}),
    validateConfig: vi.fn().mockReturnValue({ warnings: [], errors: [] }),
  } as any;
}

// Mock MCPServer.handleToolRequest to avoid Scanner creation
function mockHandleToolRequest(result: any = { schema_version: '1.0.0', results: [] }) {
  return vi.fn().mockResolvedValue(result);
}

describe('MCPStdioServer', () => {
  let server: MCPStdioServer;
  let configLoader: ConfigLoader;

  beforeEach(() => {
    configLoader = makeMockConfigLoader();
    server = new MCPStdioServer(configLoader);
  });

  describe('handleRequest', () => {
    it('handles initialize method', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result.protocolVersion).toBe('2024-11-05');
      expect(response.result.serverInfo.name).toBe('pulsetel');
    });

    it('handles initialized notification', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialized',
        params: {}
      });

      expect(response.result).toEqual({});
    });

    it('handles tools/list', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {}
      });

      expect(response.result.tools).toBeDefined();
      expect(response.result.tools.length).toBeGreaterThan(0);
      expect(response.result.tools[0].name).toBe('pulsetel_check');
    });

    it('handles tools/call', async () => {
      // Mock the internal mcpServer
      (server as any).mcpServer = {
        handleToolRequest: mockHandleToolRequest({
          schema_version: '1.0.0',
          results: [{ type: 'ci', status: 'success', message: 'OK' }]
        })
      } as any;

      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'pulsetel_check',
          arguments: {}
        }
      });

      expect(response.result.content).toBeDefined();
      expect(response.result.content[0].type).toBe('text');
      const parsed = JSON.parse(response.result.content[0].text);
      expect(parsed.schema_version).toBe('1.0.0');
    });

    it('handles tools/call with dir argument', async () => {
      const mockHandle = mockHandleToolRequest({ schema_version: '1.0.0', results: [] });
      (server as any).mcpServer = {
        handleToolRequest: mockHandle
      } as any;

      await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'pulsetel_check',
          arguments: { dir: '/test/project' }
        }
      });

      expect(mockHandle).toHaveBeenCalledWith('pulsetel_check', '/test/project', expect.any(Object));
    });

    it('returns error for missing tool name', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { arguments: {} }
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
    });

    it('handles tool execution failure', async () => {
      (server as any).mcpServer = {
        handleToolRequest: vi.fn().mockRejectedValue(new Error('Scanner failed'))
      } as any;

      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'pulsetel_check',
          arguments: {}
        }
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32603);
      expect(response.error.data).toBe('Scanner failed');
    });

    it('handles ping', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 8,
        method: 'ping',
        params: {}
      });

      expect(response.result).toEqual({});
    });

    it('returns method not found for unknown method', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 9,
        method: 'unknown_method',
        params: {}
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601);
    });

    it('handles null id', async () => {
      const response = await (server as any).handleRequest({
        jsonrpc: '2.0',
        method: 'ping',
        params: {}
      });

      expect(response.id).toBeNull();
    });

    it('passes include_trends argument', async () => {
      const mockHandle = mockHandleToolRequest({ schema_version: '1.0.0', results: [] });
      (server as any).mcpServer = {
        handleToolRequest: mockHandle
      } as any;

      await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'pulsetel_check',
          arguments: { include_trends: true }
        }
      });

      expect(mockHandle).toHaveBeenCalledWith('pulsetel_check', undefined, expect.objectContaining({ includeTrends: true }));
    });

    it('passes check_type and window arguments', async () => {
      const mockHandle = mockHandleToolRequest({ schema_version: '1.0.0', results: [] });
      (server as any).mcpServer = {
        handleToolRequest: mockHandle
      } as any;

      await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'pulsetel_trends',
          arguments: { check_type: 'ci', window: 14 }
        }
      });

      expect(mockHandle).toHaveBeenCalledWith('pulsetel_trends', undefined, expect.objectContaining({
        checkType: 'ci',
        window: 14
      }));
    });

    it('passes repos argument', async () => {
      const mockHandle = mockHandleToolRequest({ schema_version: '1.0.0', results: [] });
      (server as any).mcpServer = {
        handleToolRequest: mockHandle
      } as any;

      await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'pulsetel_check',
          arguments: { repos: 'org/repo1,org/repo2' }
        }
      });

      expect(mockHandle).toHaveBeenCalledWith('pulsetel_check', undefined, expect.objectContaining({
        repos: 'org/repo1,org/repo2'
      }));
    });

    it('defaults window to 7', async () => {
      const mockHandle = mockHandleToolRequest({ available: true, trends: {} });
      (server as any).mcpServer = {
        handleToolRequest: mockHandle
      } as any;

      await (server as any).handleRequest({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'pulsetel_trends',
          arguments: {}
        }
      });

      expect(mockHandle).toHaveBeenCalledWith('pulsetel_trends', undefined, expect.objectContaining({
        window: 7
      }));
    });
  });

  describe('constructor', () => {
    it('creates server with default config loader', () => {
      const s = new MCPStdioServer();
      expect(s).toBeDefined();
    });

    it('creates server with custom config loader', () => {
      const s = new MCPStdioServer(configLoader);
      expect(s).toBeDefined();
    });
  });
});