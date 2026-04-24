import { createInterface } from 'readline';
import { MCPServer } from './mcp-server.js';
import { ConfigLoader } from './config.js';
import { Scanner } from './scanner.js';
import { TrendAnalyzer } from './trends.js';
import { VERSION } from './version.js';
import { generateAgentGuidance } from './agent-guidance.js';
import { PulsetelDiff } from './diff/index.js';
import { PulsetelGuard } from './guard/index.js';

/**
 * MCP stdio transport — JSON-RPC over stdin/stdout.
 * Compatible with Claude Desktop, Cursor, Smithery, and any MCP client
 * that uses the standard stdio transport.
 *
 * Usage: pulsetel mcp-stdio
 * Config (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "pulsetel": {
 *       "command": "npx",
 *       "args": ["-y", "pulsetel-cli", "mcp-stdio"]
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
    name: 'pulsetel_check',
    description: 'Run all health checks (CI, deploy, health, git, issues, PRs, coverage, deps) and return a structured report with severity, confidence, and actionable recommendations. Takes ~8-12 seconds due to npm audit. Use pulsetel_quick for fast triage (~1-2s).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory to check. Defaults to current working directory.'
        },
        repos: {
          type: 'string',
          description: 'Check multiple repositories (format: owner/repo1,owner/repo2). When specified, dir is ignored.'
        },
        include_trends: {
          type: 'boolean',
          description: 'Include trend analysis in the response. Defaults to false.'
        }
      },
      estimated_duration_ms: 10000
    }
  },
  {
    name: 'pulsetel_quick',
    description: 'Fast triage — runs CI, deploy, health, git, issues, and PRs checks only (skips deps and coverage for speed). Returns in ~1-2 seconds instead of ~8-12. Use this for quick triage, then pulsetel_check for full results if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        },
        repos: {
          type: 'string',
          description: 'Check multiple repositories (format: owner/repo1,owner/repo2). When specified, dir is ignored.'
        }
      },
      estimated_duration_ms: 2000
    }
  },
  {
    name: 'pulsetel_ci',
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
    name: 'pulsetel_health',
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
    name: 'pulsetel_deps',
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
    name: 'pulsetel_summary',
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
    name: 'pulsetel_trends',
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
    name: 'pulsetel_anomalies',
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
    name: 'pulsetel_telemetry',
    description: 'Get current OpenTelemetry configuration status and last export info. Returns OTel configuration, service name, endpoint, protocol, and export status.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: 'Output format (summary or full)',
          enum: ['summary', 'full'],
          default: 'summary'
        }
      },
      estimated_duration_ms: 100
    }
  },
  {
    name: 'pulsetel_correlate',
    description: 'Run cross-signal correlation engine to detect causal chains across CI/deps/coverage/health/deploy/Sentry checks. Detects 7 patterns: dependency_cascade, security_scan_gap, bad_merge, coverage_quality_divergence, deploy_regression, delivery_bottleneck, untested_performance_regression.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to current working directory.'
        }
      },
      estimated_duration_ms: 8000
    }
  },
  {
    name: 'pulsetel_gate',
    description: 'Run ship gate decision based on correlation patterns. Returns proceed/caution/block with blocking issues and proceed conditions. Exit codes: 0=proceed, 1=block, 2=caution.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to current working directory.'
        }
      },
      estimated_duration_ms: 8000
    }
  },
  {
    name: 'pulsetel_status',
    description: 'Lightweight health ping — reads most recent check result from history (no API calls, no network). Returns immediately with healthy boolean, critical/warning counts, and last check timestamp. Sub-10ms response time.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      },
      estimated_duration_ms: 5
    }
  },
  {
    name: 'pulsetel_sentry',
    description: 'Check Sentry error tracking. Returns unresolved issue counts, top issues by frequency, error level breakdown, affected users, and release attribution. Requires sentry.organization and sentry.project in config, SENTRY_TOKEN env var.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      },
      estimated_duration_ms: 2000
    }
  },
  {
    name: 'pulsetel_guidance',
    description: 'Generate structured agent guidance from the most recent health check. Returns observations, cross-signal correlations, investigation prompts, and a decision tree with confidence scores. Use after pulsetel_check for reasoning assistance.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        }
      },
      estimated_duration_ms: 500
    }
  },
  {
    name: 'pulsetel_diff',
    description: 'Compare the most recent health check against a previous run. Returns added, removed, and changed checks with risk assessment. Use --since to specify a timestamp, or omit for last-vs-current comparison.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        },
        since: {
          type: 'string',
          description: 'ISO timestamp to compare against. Defaults to previous run.'
        },
        threshold: {
          type: 'number',
          description: 'Drift threshold percentage (0-100). Defaults to 30.',
          default: 30
        }
      },
      estimated_duration_ms: 1000
    }
  },
  {
    name: 'pulsetel_guard',
    description: 'Run pre-action and post-action health checks around a command. Returns before/after state, drift analysis, and exit code. Useful for validating that a command (e.g., npm install) did not break project health.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to cwd.'
        },
        command: {
          type: 'string',
          description: 'Shell command to execute between pre/post checks. Required.'
        },
        threshold: {
          type: 'number',
          description: 'Drift threshold percentage (0-100). Defaults to 30.',
          default: 30
        }
      },
      required: ['command'],
      estimated_duration_ms: 15000
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
    process.stderr.write('PulseTel MCP stdio server ready\n');
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
              name: 'pulsetel',
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
          let result: any;

          // Handle guidance, diff, guard locally; delegate others to mcpServer
          if (toolName === 'pulsetel_guidance') {
            result = await this.handleGuidance(toolArgs.dir);
          } else if (toolName === 'pulsetel_diff') {
            result = await this.handleDiff(toolArgs.dir, toolArgs.since, toolArgs.threshold);
          } else if (toolName === 'pulsetel_correlate') {
            result = await this.handleCorrelate(toolArgs.dir);
          } else if (toolName === 'pulsetel_gate') {
            result = await this.handleGate(toolArgs.dir);
          } else {
            result = await this.mcpServer.handleToolRequest(
              toolName,
              toolArgs.dir,
              {
                includeTrends: toolArgs.include_trends || false,
                checkType: toolArgs.check_type,
                window: toolArgs.window || 7,
                repos: toolArgs.repos
              }
            );
          }

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

  // ── Local tool handlers for guidance, diff, guard ──

  private async handleGuidance(dir?: string): Promise<any> {
    const scanner = this.mcpServer.getScanner(dir);
    const history = this.mcpServer.loadHistory();
    const results = await scanner.runAllChecks();
    const guidance = generateAgentGuidance(results);
    return {
      schema_version: '1.0.0',
      timestamp: new Date().toISOString(),
      _agent_guidance: guidance
    };
  }

  private async handleDiff(dir?: string, since?: string, threshold?: number): Promise<any> {
    const config = this.configLoader.autoDetect(dir);
    const diff = new PulsetelDiff(config, dir || process.cwd());
    const history = diff.loadHistory();
    if (history.length === 0) {
      return { error: 'No history found. Run pulsetel check at least twice first.' };
    }
    const oldSnap = history[0].data;
    const newSnap = history[1] ? history[1].data : history[0].data;
    return diff.diffSnapshots(oldSnap, newSnap);
  }

  private async handleCorrelate(dir?: string): Promise<any> {
    const { CorrelationEngine } = await import('./correlate.js');
    const correlationEngine = new CorrelationEngine();
    
    const scanner = this.mcpServer.getScanner(dir);
    const history = this.mcpServer.loadHistory();
    const results = await scanner.runAllChecks();
    const patterns = correlationEngine.detectPatterns(results, history);
    
    return {
      schema_version: '1.0.0',
      timestamp: new Date().toISOString(),
      patterns,
      patternCount: patterns.length,
      hasBlockingIssues: patterns.some(p => ['dependency_cascade', 'security_scan_gap', 'deploy_regression'].includes(p.pattern))
    };
  }

  private async handleGate(dir?: string): Promise<any> {
    const { CorrelationEngine } = await import('./correlate.js');
    const correlationEngine = new CorrelationEngine();
    
    const scanner = this.mcpServer.getScanner(dir);
    const history = this.mcpServer.loadHistory();
    const results = await scanner.runAllChecks();
    const patterns = correlationEngine.detectPatterns(results, history);
    const decision = correlationEngine.makeShipDecision(patterns);
    
    return {
      schema_version: '1.0.0',
      timestamp: new Date().toISOString(),
      decision: decision.decision,
      blockingIssues: decision.blockingIssues,
      proceedConditions: decision.proceedConditions,
      confidence: decision.confidence,
      patterns: patterns.map(p => ({
        pattern: p.pattern,
        confidence: p.confidence,
        actionable: p.actionable
      }))
    };
  }
}