# PulseTel

**Real-time project telemetry for AI agents and developers. One command to check CI, deploys, endpoints, dependencies, and issues — with trend analysis and anomaly detection.**

[![npm version](https://img.shields.io/npm/v/pulsetel-cli.svg)](https://www.npmjs.com/package/pulsetel-cli) [![Test Coverage](https://img.shields.io/badge/coverage-81%25%20statements-brightgreen)](https://github.com/siongyuen/pulsetel) [![Tests](https://img.shields.io/badge/tests-638%20passing-brightgreen)](https://github.com/siongyuen/pulsetel) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Why PulseTel?

If you're an AI agent trying to assess project health, you have two options today:

1. **Raw API wrappers** — GitHub MCP Server, Datadog MCP. You make 5+ calls, parse different schemas, and piece together what's actually wrong. No prioritisation, no trends, no actionable output.
2. **Enterprise platforms** — Datadog, New Relic, OneUptime. Comprehensive, but require paid accounts and don't speak agent-native.

PulseTel fills the gap. One call gives you the full picture: what's broken, what's degrading, what to fix first — with severity, confidence, and context built into every response.

**For developers**, it's a CLI that runs 8 health checks, tracks trends over time, and alerts you via webhooks when things degrade. **For AI agents**, it's an MCP server with 9 tools that return structured, prioritised, actionable data — no interpretation required.

### What makes it different

- **Agent-first responses**: Every MCP tool returns `actionable`, `severity`, `confidence`, `context` — not raw data you have to interpret
- **`pulsetel_recommend`**: A ranked action list. Rank 1 is what you should fix right now
- **Trend analysis**: Not just "is it broken now?" but "is it getting worse?" with direction, delta, and velocity
- **Anomaly detection**: Statistical (2σ from rolling mean), not threshold-based
- **Webhook alerts**: HMAC-signed push on anomalies, degrading trends, flaky CI
- **Security hardened**: SSRF protection (IPv4 + IPv6), no shell injection, no token leaks

## Installation

```bash
npx pulsetel-cli check
# or install globally
npm install -g pulsetel-cli
pulsetel check
```

## Quick Start

### 1. Initialise configuration

```bash
cd your-project
pulsetel init
```

Creates `.pulsetel.yml` with auto-detected GitHub repo, language, and health endpoints.

### 2. Run a check

```bash
pulsetel check
```

```
🔄 CI/CD:
  ✅ Latest run: CI (success)
  ⚠️  2 need review

📋 Git:
  ✅ main branch, 0 uncommitted, up to date

📖 Dependencies:
  ⚠️  5 outdated, 2 vulnerable

📊 Summary: 0 critical, 3 warnings
```

### 3. Track trends over time

Every `pulsetel check` saves a history entry. After a few runs:

```bash
pulsetel trends
pulsetel anomalies
```

```
📈 deps: degrading ⚠️ ANOMALY
   Delta: +3.00
   Velocity: 1.50/run
   Mean: 4.33, σ: 1.53
```

## MCP Server (Agent Interface)

The primary interface for AI agents. Two transport modes:

### stdio Transport (Claude Desktop, Cursor, Smithery)

```bash
pulsetel mcp-stdio
```

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pulsetel": {
      "command": "npx",
      "args": ["-y", "pulsetel-cli", "mcp-stdio"]
    }
  }
}
```

Or for Cursor — same config in `.cursor/mcp.json`.

### HTTP Transport

```bash
pulsetel mcp
```

Starts an HTTP server on port 3000.

### 11 Tools

| Tool | What It Returns |
|------|----------------|
| `pulsetel_check` | Full health check (all modules) + optional trends |
| `pulsetel_quick` | Fast triage (~2s) — skips deps and coverage |
| `pulsetel_ci` | CI status + flakiness score + trend |
| `pulsetel_health` | Endpoint health + latency + baseline comparison |
| `pulsetel_deps` | Dependency audit (vulnerable + outdated) |
| `pulsetel_summary` | Summary + top anomalies + overall trend direction |
| `pulsetel_trends` | Trend analysis: direction, delta, velocity per check |
| `pulsetel_anomalies` | Anomaly detection (2σ from rolling mean) |
| `pulsetel_metrics` | Full telemetry: history + trends + current values |
| `pulsetel_recommend` | **Prioritised action items** ranked by severity + confidence |
| `pulsetel_status` | Lightweight health ping (sub-10ms, no API calls) |

### HTTP Query Parameters

```
GET /?tool=pulsetel_check&include_trends=true
GET /?tool=pulsetel_trends&check_type=deps&window=14
GET /?tool=pulsetel_metrics&check_type=ci
GET /?tool=pulsetel_recommend
GET /?dir=/path/to/project
```

### Response Format

Every response includes structured, actionable data:

```json
{
  "type": "deps",
  "status": "warning",
  "severity": "warning",
  "confidence": "high",
  "actionable": "Update 5 outdated packages — run npm update",
  "context": "Outdated or vulnerable dependencies are security and stability risks",
  "message": "5 outdated, 2 vulnerable",
  "details": { "outdated": 5, "vulnerable": 2, "total": 48 }
}
```

### Recommendations — The Killer Feature

`pulsetel_recommend` ranks what matters most, so agents don't waste time on low-impact items:

```json
{
  "recommendations": [
    {
      "rank": 1,
      "checkType": "deps",
      "severity": "critical",
      "confidence": "high",
      "title": "deps check failed",
      "actionable": "Run npm audit fix to address vulnerabilities",
      "context": "2 critical vulnerabilities found"
    },
    {
      "rank": 2,
      "checkType": "ci",
      "severity": "warning",
      "confidence": "medium",
      "title": "Anomaly in ci: flakiness_score",
      "actionable": "CI anomaly — check for flaky tests or config drift",
      "context": "Value 60.00 is 3.2σ from mean 8.33"
    }
  ]
}
```

## CLI Commands

```bash
# Basic check
pulsetel check

# JSON output (for scripts and agents)
pulsetel check --json

# Include trends in JSON
pulsetel check --json --include-trends

# JUnit XML (for CI/CD pipelines)
pulsetel check --junit

# Exit 1 on critical (CI gating)
pulsetel check --fail-on-error

# Structured exit codes (0=healthy, 1=critical, 2=warnings, 3=partial)
pulsetel check --exit-code

# Verbose output with timing
pulsetel check --verbose

# Compare with previous run
pulsetel check --compare

# Trend analysis
pulsetel trends
pulsetel trends --type deps --window 14
pulsetel trends --json

# Anomaly detection
pulsetel anomalies
pulsetel anomalies --json

# Run history
pulsetel history --limit 20 --json

# Initialise config
pulsetel init

# Start MCP server (HTTP)
pulsetel mcp

# Start MCP stdio transport (Claude Desktop / Cursor)
pulsetel mcp-stdio

# Automated remediation
pulsetel fix --deps --dry-run          # Show what would be fixed
pulsetel fix --deps                    # Actually fix vulnerabilities
pulsetel fix --deps --json             # JSON output for automation
pulsetel fix --all                     # Run all available fixes
```

## Configuration

`.pulsetel.yml`:

```yaml
github:
  repo: owner/repo
  # token: use GITHUB_TOKEN env var instead

health:
  allow_local: false
  endpoints:
    - name: api
      url: https://api.example.com/health
      timeout: 5000
      baseline: 200

checks:
  ci: true
  deps: true
  git: true
  health: true
  issues: true
  prs: true
  deploy: true
  coverage:
    enabled: true
    threshold: 80
    remote:
      provider: codecov

webhooks:
  - url: https://hooks.example.com/pulsetel
    events: [anomaly, degrading, flaky, critical]
    secret: optional-hmac-secret

sentry:
  organization: my-org
  project: my-project
  # token: use SENTRY_TOKEN env var instead
```

## 9 Check Modules

| Check | What It Does | Key Metrics |
|-------|-------------|------------|
| **CI** | GitHub Actions last 10 runs | flakinessScore, trend (improving/stable/degrading) |
| **Health** | HTTP endpoint checks + baseline comparison | latency, baseline ratio |
| **Deps** | npm audit + outdated count | vulnerable, outdated, total |
| **Coverage** | Local (Istanbul/lcov/Clover) + remote (Codecov/Coveralls) | percentage vs threshold |
| **Issues** | GitHub Issues | open, closed, critical, bugs |
| **PRs** | GitHub Pull Requests | open, needsReview, conflicts, drafts |
| **Git** | Branch, uncommitted, divergence from default | uncommitted files, ahead/behind |
| **Deploy** | GitHub Deployments | status, environment |
| **Sentry** | Sentry error tracking — unresolved issues, error rates, affected users | unresolved, totalEvents, affectedUsers, byLevel, topIssues, releases |

## Webhook Events

| Event | Trigger |
|-------|---------|
| `critical` | Any check with error status |
| `anomaly` | Metric exceeds 2σ from rolling mean |
| `degrading` | Trend direction is degrading |
| `flaky` | CI flakiness score > 30% |

Webhooks are HMAC-SHA256 signed when a secret is configured. Payload includes `event`, `checkType`, `severity`, `actionable`, `context`.

## Test Coverage

PulseTel has **638 tests** across **38 test files** with **81.5% statement coverage** and **85.7% function coverage**. All check modules use dependency injection for testability — no module-level mocking.

| Module | Statements | Functions | Lines |
|--------|-----------|----------|-------|
| Overall | **81.5%** | **85.7%** | **81.2%** |
| Checks (8 modules) | 86% | 90% | 88% |
| Scanner | 88% | 92% | 89% |
| Reporter | 99% | 100% | 99% |
| Config | 88% | 100% | 88% |
| Webhooks | 96% | 94% | 96% |
| Trends | 87% | 100% | 87% |

Run tests: `npx vitest run` · Coverage report: `npx vitest run --coverage`

## Security

- **No shell injection** — all `child_process` calls use `execFileSync` (no shell spawned)
- **SSRF protection** — blocks private IPs, loopback, cloud metadata (IPv4 + IPv6), DNS resolution validation, no redirect following
- **No token leaks** — `init` never writes tokens to config, error messages are generic, tokens via env vars only
- **YAML hardening** — `schema: 'core'` prevents dangerous types, 64KB size limit, repo regex validation
- **Path traversal blocking** — MCP `dir` param validated against `..` and null bytes
- **DoS protection** — max 20 endpoints, 1–30s timeouts, 64KB config limit

## Structured Exit Codes

PulseTel provides deterministic exit codes for CI/CD integration:

| Exit Code | Meaning | Trigger |
|-----------|---------|---------|
| `0` | All checks healthy | No errors or warnings found |
| `1` | Critical issues found | At least one check with status "error" |
| `2` | Warnings only | No errors, but at least one warning |
| `3` | Partial failure | Some checks couldn't run (e.g., no GitHub token) |

Enable structured exit codes with `--exit-code`:

```bash
# Opt-in structured exit codes
pulsetel check --exit-code

# Exit code 0: All healthy
pulsetel check --exit-code && echo "All checks passed"

# Exit code 1: Critical issues
pulsetel check --exit-code || echo "Critical issues found: $?"

# Exit code 2: Warnings only
pulsetel check --exit-code
exit_code=$?
if [ $exit_code -eq 2 ]; then
  echo "Warnings found but no critical issues"
fi
```

The `--fail-on-error` flag provides backward compatibility (exit code 1 on errors only).

| Feature | PulseTel | GitHub MCP Server | Datadog MCP |
|---------|-----------|-------------------|-------------|
| Single-call health check | ✅ | ❌ (5+ calls) | ❌ (paid) |
| Agent-first responses | ✅ | ❌ (raw data) | ❌ (dashboards) |
| Prioritised recommendations | ✅ | ❌ | ❌ |
| Trend analysis | ✅ | ❌ | ✅ |
| Anomaly detection | ✅ | ❌ | ✅ |
| Webhook alerts | ✅ | ❌ | ✅ |
| Sentry error tracking | ✅ | ❌ | ❌ |
| OpenTelemetry export | ✅ | ❌ | ✅ |
| SSRF protection | ✅ | — | — |
| No account required | ✅ | ✅ | ❌ |
| Open source | ✅ (MIT) | ✅ | ❌ |

## OpenTelemetry Integration

PulseTel supports OpenTelemetry (OTel) for exporting traces, metrics, and logs to observability backends like Jaeger, Prometheus, and Grafana.

### Configuration

Add OpenTelemetry configuration to your `.pulsetel.yml`:

```yaml
otel:
  enabled: true
  protocol: http  # or 'file' for file-based export
  service_name: my-pulsetel-service
  endpoint: http://localhost:4318  # OTLP endpoint (optional, defaults to http://localhost:4318)
  export_dir: .pulsetel/otel  # For file protocol (optional, defaults to .pulsetel/otel)
```

### CLI Usage

Enable OTel export with the `--otel` flag:

```bash
pulsetel check --otel
```

Or configure it in your `.pulsetel.yml`:

```yaml
otel:
  enabled: true
```

### Export Protocols

#### OTLP HTTP (Primary)

Exports data to an OTLP-compatible endpoint (default: `http://localhost:4318`):

- Traces: `/v1/traces`
- Metrics: `/v1/metrics`
- Logs: `/v1/logs`

#### File Export

Writes NDJSON files to `.pulsetel/otel/` directory:

- `traces.jsonl` - Trace data
- `metrics.jsonl` - Metrics data  
- `logs.jsonl` - Log data

### Traces

PulseTel creates detailed traces for each check:

- **Root span**: `pulsetel.check` with total duration and summary attributes
- **Child spans**: `pulsetel.check.{type}` for each check type with attributes:
  - `pulsetel.check_type`
  - `pulsetel.severity`
  - `pulsetel.confidence`
  - `pulsetel.status`
  - `pulsetel.actionable`
  - `pulsetel.duration_ms`

### Metrics

PulseTel exports the following metrics:

- `pulsetel.health.score` - Gauge (0-100) per check type
- `pulsetel.anomalies.total` - Counter of detected anomalies
- `pulsetel.deps.vulnerable` - Counter of vulnerable dependencies
- `pulsetel.deps.outdated` - Counter of outdated dependencies
- `pulsetel.issues.open` - Counter of open issues
- `pulsetel.ci.flakiness_score` - Gauge of CI flakiness

### Logs

Structured logs are emitted for:

- Anomaly events
- Degrading trends
- Flaky CI detection

### MCP Tool: pulsetel_telemetry

Get current OTel configuration and status:

```bash
# Summary format
pulsetel mcp-stdio --tool pulsetel_telemetry --format summary

# Full format  
pulsetel mcp-stdio --tool pulsetel_telemetry --format full
```

### Example Setup with Grafana

1. **Run OTel Collector**:
   ```bash
   docker run -p 4318:4318 otel/opentelemetry-collector
   ```

2. **Configure PulseTel**:
   ```yaml
   otel:
     enabled: true
     protocol: http
     endpoint: http://localhost:4318
     service_name: pulsetel
   ```

3. **Run checks with OTel export**:
   ```bash
   pulsetel check --otel
   ```

4. **Visualize in Grafana**:
   - Import OTel data source
   - Create dashboards for PulseTel metrics
   - Set up alerts for anomalies

### Installation

OpenTelemetry dependencies are optional:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-metrics \
  @opentelemetry/semantic-conventions
```

If dependencies are not installed, OTel features are silently disabled.


The `fix` command provides automated remediation for common issues:

### Dependency Fixes

```bash
# Dry run - show what would be fixed
pulsetel fix --deps --dry-run

# Actually fix vulnerabilities
pulsetel fix --deps

# Skip confirmation prompts
pulsetel fix --deps --yes

# JSON output for automation
pulsetel fix --deps --json
```

### Fix Command Features

- **Safety first**: Always shows what will change before making modifications (unless `--yes`)
- **Dry run mode**: `--dry-run` shows what would be fixed without making changes
- **Structured output**: JSON format includes status, changes, and success indicators
- **Exit codes**: Same structured exit codes as check commands (0=success, 1=failed, 2=partial)
- **Extensible**: `--all` runs all available fix targets

### JSON Output Format

```json
{
  "schema_version": "1.0.0",
  "schema_url": "https://github.com/siongyuen/pulsetel/blob/master/SCHEMA.md",
  "version": "0.5.0",
  "timestamp": "2024-04-18T15:00:00.000Z",
  "duration": 1250,
  "fix_results": [
    {
      "target": "deps",
      "status": "success",
      "success": true,
      "message": "Successfully fixed all 2 vulnerabilities",
      "changes": [
        "2 vulnerabilities detected",
        "Fixed 2 vulnerabilities"
      ],
      "dryRun": false
    }
  ]
}
```

### Status Values

- `success`: Fix completed successfully
- `partial`: Some fixes applied, but issues remain
- `failed`: Fix could not be completed

### Current Fix Targets

| Target | Description | Scope |
|--------|-------------|-------|
| `deps` | Fix vulnerable dependencies | Runs `npm audit fix` |

Future targets (planned):
- `stale-branches`: Delete merged GitHub branches
- `pr-cleanup`: Close stale pull requests
- `issue-triage`: Auto-label and prioritize issues

## Sentry Error Tracking

PulseTel integrates with [Sentry](https://sentry.io) for production error tracking. The Sentry check queries the Sentry API for unresolved issues and returns a structured report with actionable recommendations.

### Configuration

Add to your `.pulsetel.yml`:

```yaml
sentry:
  organization: my-org
  project: my-project
  # token: prefer SENTRY_TOKEN env var instead
```

Set your Sentry auth token via environment variable:

```bash
export SENTRY_TOKEN=your-sentry-auth-token
```

The token needs `org:read` and `project:read` scopes.

### MCP Tool: pulsetel_sentry

```bash
# Via MCP HTTP
GET /?tool=pulsetel_sentry

# Via MCP stdio (Claude Desktop, Cursor)
# Automatically available when sentry is configured
```

### Response Format

```json
{
  "type": "sentry",
  "status": "warning",
  "severity": "medium",
  "confidence": "high",
  "actionable": "Fix 2 critical errors first — Top issue: \"TypeError: Cannot read property\" (150 events, 25 users)",
  "context": "5 unresolved issues tracked in Sentry with 5 total events",
  "message": "5 unresolved issues in Sentry",
  "details": {
    "unresolved": 5,
    "totalEvents": 200,
    "affectedUsers": 35,
    "byLevel": {
      "fatal": 1,
      "error": 2,
      "warning": 2
    },
    "topIssues": [
      {
        "id": "12345",
        "title": "TypeError: Cannot read property",
        "level": "error",
        "count": 150,
        "platform": "javascript",
        "users": 25,
        "url": "https://sentry.io/organizations/my-org/issues/12345/"
      }
    ],
    "releases": ["2.1.0", "2.0.1"]
  }
}
```

### Error Classification

| Condition | Status | Severity |
|-----------|--------|----------|
| 10+ unresolved or 100+ event count | `error` | `critical` |
| 5+ with fatal/error | `error` | `high` |
| 3+ or any fatal/error | `warning` | `medium` |
| 1-2 low-level issues | `warning` | `low` |
| 0 unresolved | `success` | `low` |

MIT