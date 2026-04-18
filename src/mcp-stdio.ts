import { createInterface } from 'readline';
import { MCPServer } from './mcp-server';
import { ConfigLoader } from './config';
import { Scanner } from './scanner';
import { TrendAnalyzer } from './trends';
import { VERSION } from './version';

/**
 * MCP stdio transport — JSON-RPC over stdin/stdout.
 * Compatible with Claude Desktop, Cursor, Smithery, and any MCP client
 * that uses the standard stdio transport.
 *
 * Usage: pulselive mcp-stdio
 * Config (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "pulselive": {
 *       "command": "npx",
 *       "args": ["-y", "@siongyuencheah/pulselive", "mcp-stdio"]
 *     }
 *   }
 * }
 */

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const TOOLS = [
  {
    name: 'pulselive_check',
    description: 'Run all health checks (CI, deploy, health, git, issues, PRs, coverage, deps) and return a structured report with severity, confidence, and actionable recommendations. Optionally include trend analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory to check. Defaults to current working directory.'
        },
        include_trends: {
          type: 'boolean',
          description: 'Include trend analysis in the response. Defaults to false.'
        }
      }
    }
  },
  {
    name: 'pulselive_ci',
    description: 'Check CI status. Returns flakiness score, recent run results, and trend direction for the project\'s CI pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      }
    }
  },
  {
    name: 'pulselive_health',
    description: 'Check HTTP endpoint health. Returns response times, baseline comparisons, and status codes for configured endpoints. SSRF-protected.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      }
    }
  },
  {
    name: 'pulselive_deps',
    description: 'Check dependency health. Returns vulnerability counts, outdated packages, and total dependency count from npm audit.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      }
    }
  },
  {
    name: 'pulselive_summary',
    description: 'Get a concise project health summary: critical/warning/passing counts, overall status, top anomalies, and overall trend direction.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      }
    }
  },
  {
    name: 'pulselive_trends',
    description: 'Analyze trends for check types over recent history. Returns direction (improving/stable/degrading), delta, velocity, and anomaly flags.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        },
        check_type: {
          type: 'string',
          description: 'Specific check type to analyze (ci, deploy, health, git, issues, prs, coverage, deps). Omit for all types.',
          enum: ['ci', 'deploy', 'health', 'git', 'issues', 'prs', 'coverage', 'deps']
        },
        window: {
          type: 'number',
          description: 'Number of recent runs to analyze. Defaults to 7.'
        }
      }
    }
  },
  {
    name: 'pulselive_anomalies',
    description: 'Detect anomalies in project health metrics. Uses 2σ from rolling mean to identify statistically significant deviations.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      }
    }
  },
  {
    name: 'pulselive_metrics',
    description: 'Get detailed metrics for all or a specific check type, including trend analysis and historical data.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        },
        check_type: {
          type: 'string',
          description: 'Specific check type. Omit for all types.',
          enum: ['ci', 'deploy', 'health', 'git', 'issues', 'prs', 'coverage', 'deps']
        }
      }
    }
  },
  {
    name: 'pulselive_recommend',
    description: 'Get prioritised, actionable recommendations ranked by severity and confidence. The highest-ranked item is what you should fix right now.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      }
    }
  }
];

export class MCPStdioServer {
  private configLoader: ConfigLoader;
  private mcpServer: MCPServer;

  constructor(configLoader?: ConfigLoader) {
    this.configLoader = configLoader || new ConfigLoader();
    this.mcpServer = new MCPServer(this.configLoader);
  }

  async start(): Promise<void> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', (line: string) => {
      try {
        const request: JSONRPCRequest = JSON.parse(line.trim());
        this.handleRequest(request).then(response => {
          // Write response to stdout — MCP clients read from stdout
          process.stdout.write(JSON.stringify(response) + '\n');
        }).catch(error => {
          const errorResponse: JSONRPCResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error.message
            }
          };
          process.stderr.write(JSON.stringify(errorResponse) + '\n');
        });
      } catch {
        // Invalid JSON — skip
      }
    });

    rl.on('close', () => {
      process.exit(0);
    });

    // Signal ready on stderr (not stdout — stdout is for JSON-RPC)
    process.stderr.write('PulseLive MCP stdio server ready\n');
  }

  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {
                listChanged: false
              }
            },
            serverInfo: {
              name: 'pulselive',
              version: VERSION,
              description: 'Real-time project telemetry for AI agents'
            }
          }
        };

      case 'initialized':
        // No response needed for notification
        return { jsonrpc: '2.0', id: id ?? null, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            tools: TOOLS
          }
        };

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: {
              code: -32602,
              message: 'Missing tool name'
            }
          };
        }

        try {
          const result = await this.mcpServer.handleToolRequest(
            toolName,
            toolArgs.dir,
            {
              includeTrends: toolArgs.include_trends || false,
              checkType: toolArgs.check_type,
              window: toolArgs.window || 7
            }
          );

          return {
            jsonrpc: '2.0',
            id: id ?? null,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          };
        } catch (error: any) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: {
              code: -32603,
              message: 'Tool execution failed',
              data: error.message
            }
          };
        }
      }

      case 'ping':
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {}
        };

      default:
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
    }
  }
}