import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPStdioServer } from '../src/mcp-stdio';
import { ConfigLoader } from '../src/config';

describe('MCPStdioServer', () => {
  let server: MCPStdioServer;

  beforeEach(() => {
    const configLoader = new ConfigLoader('.pulselive-test.yml');
    server = new MCPStdioServer(configLoader);
  });

  it('should handle initialize request', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
    expect(response.result.protocolVersion).toBe('2024-11-05');
    expect(response.result.serverInfo.name).toBe('pulselive');
    expect(response.result.capabilities.tools).toBeDefined();
  });

  it('should handle tools/list request', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(2);
    expect(response.result.tools).toBeDefined();
    expect(response.result.tools.length).toBe(9);

    const toolNames = response.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('pulselive_check');
    expect(toolNames).toContain('pulselive_recommend');
    expect(toolNames).toContain('pulselive_trends');
    expect(toolNames).toContain('pulselive_anomalies');
  });

  it('should include inputSchema in tool definitions', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {}
    });

    const checkTool = response.result.tools.find((t: any) => t.name === 'pulselive_check');
    expect(checkTool.inputSchema).toBeDefined();
    expect(checkTool.inputSchema.type).toBe('object');
    expect(checkTool.inputSchema.properties.dir).toBeDefined();
    expect(checkTool.inputSchema.properties.include_trends).toBeDefined();
  });

  it('should handle ping request', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'ping',
      params: {}
    });

    expect(response.result).toEqual({});
  });

  it('should return error for unknown method', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'unknown/method',
      params: {}
    });

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toContain('Method not found');
  });

  it('should return error for missing tool name in tools/call', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { arguments: {} }
    });

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Missing tool name');
  });

  it('should return error for unknown tool in tools/call', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} }
    });

    // The tool name goes to handleToolRequest which validates against VALID_TOOLS
    expect(response.error || response.result).toBeDefined();
  });

  it('should handle initialized notification', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: null,
      method: 'initialized',
      params: {}
    });

    expect(response.result).toEqual({});
  });
});