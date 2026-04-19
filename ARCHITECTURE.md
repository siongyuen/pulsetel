# PulseTel Architecture

> Real-time project telemetry for AI agents. MCP-first, CLI-second.

## Product Direction

**Primary consumer:** AI agents via MCP server. Every feature must be exposed as an MCP tool first, with structured responses including `actionable`, `severity`, `confidence`, and `context` fields.

**Secondary consumer:** Developers via CLI. Human-readable output, coloured terminal, JSON/JSON/JUnit export.

## Source Layout

```
src/
├── index.ts          # CLI entry point (commander). Also exports loadHistory, saveHistory, VERSION
├── config.ts         # ConfigLoader — reads .pulsetel.yml, auto-detects GitHub repo, tokens
├── scanner.ts        # Scanner — orchestrates all checks, adds retry logic + duration tracking
├── reporter.ts       # Reporter — formats results for terminal (coloured, plain, verbose, JUnit)
├── mcp-server.ts     # MCPServer — HTTP server exposing MCP tools (agent-first interface)
├── trends.ts         # TrendAnalyzer — trend direction, anomaly detection (2σ), velocity
├── webhooks.ts       # WebhookNotifier — HMAC-signed POSTs on anomaly/degrading/flaky/critical
└── checks/
    ├── ci.ts         # CICheck — GitHub Actions runs (last 10), flakiness score, trend
    ├── coverage.ts   # CoverageCheck — local (Istanbul/lcov/Clover) + remote (Codecov/Coveralls)
    ├── deploy.ts     # DeployCheck — GitHub Deployments API
    ├── deps.ts       # DepsCheck — npm audit + outdated
    ├── git.ts        # GitCheck — branch, uncommitted, divergence (execFileSync, no shell)
    ├── health.ts     # HealthCheck — HTTP endpoints with SSRF protection, latency, baselines
    ├── issues.ts     # IssuesCheck — GitHub Issues (open/closed counts)
    └── prs.ts        # PRsCheck — GitHub PRs (open, needs review, conflicts, drafts)
```

## Key Types

```typescript
// scanner.ts
interface CheckResult {
  type: string;           // 'ci' | 'deps' | 'health' | 'git' | 'issues' | 'prs' | 'coverage' | 'deploy'
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: any;          // Check-type-specific data
  duration?: number;      // Execution time in ms (added by Scanner)
}

// config.ts
interface PulsetelConfig {
  github?: { repo?: string; token?: string };
  health?: { allow_local?: boolean; endpoints?: Array<{name, url, timeout?, baseline?}> };
  checks?: { ci?, deps?, git?, health?, issues?, deploy?, prs?, coverage? };
  webhooks?: Array<{ url: string; events: string[]; secret?: string }>;
}

// trends.ts
interface TrendResult {
  checkType: string;
  direction: 'improving' | 'stable' | 'degrading' | 'unknown';
  delta: number;         // Absolute change over window
  anomaly: boolean;      // Current value > 2σ from rolling mean
  velocity: number;      // Rate of change per run
  currentValue?: number;
  mean?: number;
  stdDev?: number;
}

interface AnomalyResult {
  checkType: string;
  metric: string;
  value: number;
  mean: number;
  stdDev: number;
  zScore: number;
  severity: 'low' | 'medium' | 'high';
}

interface HistoryEntry {
  timestamp: string;
  hostname?: string;
  pulsetel_version?: string;
  results: Array<{
    type: string;
    status: 'success' | 'warning' | 'error';
    message: string;
    duration?: number;
    metrics?: any;         // Check-type-specific metrics for trend analysis
  }>;
}
```

## Data Flow

```
CLI: pulsetel check
  → ConfigLoader.autoDetect()          # Reads .pulsetel.yml + env + git remote
  → Scanner.runAllChecks()             # Runs each enabled check, tracks duration
    → CICheck.run()                    # GitHub API → flakinessScore, trend
    → DepsCheck.run()                  # npm audit/outdated → vuln counts
    → HealthCheck.run()                # HTTP fetch → latency, baseline comparison
    → ... etc
  → WebhookNotifier.notify(results)   # Fire-and-forget webhook POSTs
  → saveHistory(results)               # Write to .pulsetel-history/run-*.json

MCP: GET /?tool=pulsetel_check
  → Same flow as CLI
  → enrichResult() adds: severity, confidence, actionable, context
  → If include_trends=true: TrendAnalyzer.analyze() + detectAnomalies()

Trends: pulsetel trends / pulsetel_anomalies (MCP)
  → loadHistory() from .pulsetel-history/
  → TrendAnalyzer.analyze(type, history, window)
    → Extract numeric metrics from history entries
    → Compute mean, stdDev, z-score
    → Determine direction (improving/stable/degrading)
    → Flag anomalies (>2σ)
```

## MCP Tools (Agent-First Interface)

All tools accessed via HTTP: `GET /?tool=<name>&dir=<path>&<params>`

| Tool | Purpose | Key Params |
|------|---------|------------|
| `pulsetel_check` | Full health check | `include_trends=true` for trend data |
| `pulsetel_ci` | CI check only | — |
| `pulsetel_health` | Endpoint check only | — |
| `pulsetel_deps` | Dependency check only | — |
| `pulsetel_summary` | Summary + top anomalies + overall trend | — |
| `pulsetel_trends` | Trend analysis | `check_type`, `window` (default 7) |
| `pulsetel_anomalies` | Anomaly detection | — |
| `pulsetel_metrics` | Full telemetry (history + trends + current) | `check_type` |
| `pulsetel_recommend` | Prioritised action items ranked by impact | — |

**Every MCP response includes:**
- `severity`: `'critical' | 'warning' | 'info'`
- `confidence`: `'high' | 'medium' | 'low'`
- `actionable`: What the agent should DO (e.g., "Run npm audit fix to address vulnerabilities")
- `context`: Why this matters (e.g., "CI flakiness 40% means test results are unreliable for gating merges")

## Check Details (per type)

### CI (`ci.ts`)
- Fetches last 10 GitHub Actions workflow runs
- Computes `flakinessScore` = % of failures in last 10
- Computes `trend` = "improving"/"stable"/"degrading" (last 3 vs prev 3 runs)
- Requires `GITHUB_TOKEN` env var

### Health (`health.ts`)
- HTTP GET each configured endpoint
- SSRF protection: blocks private IPs, loopback, cloud metadata (169.254.x.x)
- DNS validation: resolves hostnames, blocks resolved IPs in banned ranges
- `allow_local: true` bypasses private/loopback (still blocks metadata)
- Baseline comparison: warns at 2x, errors at 5x or >10s
- Max 20 endpoints, timeout 1-30s

### Dependencies (`deps.ts`)
- `npm audit` + `npm outdated` via `execFileSync` (no shell injection)
- Returns vulnerable count (by severity) and outdated count

### Coverage (`coverage.ts`)
- Local: Istanbul coverage-summary.json, lcov.info, clover.xml
- Remote: Codecov API (v5 then v2), Coveralls API
- Configurable threshold (default 80%)

### Issues (`issues.ts`) / PRs (`prs.ts`)
- GitHub REST API, paginated
- Issues: open/closed counts
- PRs: open, needs review, has conflicts, drafts

### Git (`git.ts`)
- `execFileSync('git', ...)` — no shell spawned
- Branch, uncommitted file count, divergence, recent commits

### Deploy (`deploy.ts`)
- GitHub Deployments API (underused, rarely useful)

## Security Model

- **No `execSync`** — all child_process uses `execFileSync` (no shell)
- **SSRF protection** — private IP + metadata IP blocking, DNS validation
- **No token leaks** — `init` never writes tokens to config; errors use generic messages
- **YAML hardening** — `schema: 'core'` prevents dangerous YAML types
- **Path traversal** — MCP `dir` param blocks `..` and null bytes
- **Config size limit** — 64KB max
- **Endpoint limits** — max 20, timeout 1-30s
- **Redirect blocking** — `redirect: 'manual'` in health checks
- **HMAC signing** — webhooks sign payload with `sha256=${hmac}` if secret configured
- **Error sanitisation** — no stack traces, no tokens in output

## History Storage

Location: `.pulsetel-history/run-<timestamp>.json`

Each entry is a `HistoryEntry` with enriched metrics per check type. This is the telemetry time-series that powers trends and anomaly detection.

MCP self-telemetry: `.pulsetel-history/mcp-usage.json` — logs every MCP tool call (tool, timestamp, duration, status). Capped at 1000 entries.

## Webhook Events

| Event | Trigger | Payload Fields |
|-------|---------|---------------|
| `critical` | Any check status = 'error' | checkType, message |
| `anomaly` | Metric > 2σ from rolling mean | checkType, metric, zScore |
| `degrading` | Trend direction = 'degrading' | checkType, delta, velocity |
| `flaky` | CI flakinessScore > 30% | flakinessScore, failCount, runCount |

## Testing

- **Framework:** Vitest
- **Location:** `test/` (mirrors `src/` structure)
- **Run:** `npm test`
- **Current:** 66 tests, 11 test files
- **Fixtures:** `test/fixtures/sample-project/`

## Build

```bash
npm run build    # tsc → dist/
npm test         # vitest run
npm run dev      # tsc --watch
```

## Current Version: 0.3.0

## Conventions

- TypeScript strict mode
- No `any` in new code (use proper types)
- All network calls wrapped in `withRetry` (2 retries, exponential backoff on 5xx/429)
- Every new MCP tool MUST return `actionable`, `severity`, `confidence`, `context`
- Every new check MUST populate `metrics` in history entries for trend analysis
- History entries are append-only, never modified
- Webhook fires are fire-and-forget (never block check completion)