# PulseLive

**Real-time project telemetry for AI agents and developers. One command to check CI, deploys, endpoints, dependencies, and issues — with trend analysis and anomaly detection.**

## Why PulseLive?

If you're an AI agent trying to assess project health, you have two options today:

1. **Raw API wrappers** — GitHub MCP Server, Datadog MCP. You make 5+ calls, parse different schemas, and piece together what's actually wrong. No prioritisation, no trends, no actionable output.
2. **Enterprise platforms** — Datadog, New Relic, OneUptime. Comprehensive, but require paid accounts and don't speak agent-native.

PulseLive fills the gap. One call gives you the full picture: what's broken, what's degrading, what to fix first — with severity, confidence, and context built into every response.

**For developers**, it's a CLI that runs 8 health checks, tracks trends over time, and alerts you via webhooks when things degrade. **For AI agents**, it's an MCP server with 9 tools that return structured, prioritised, actionable data — no interpretation required.

### What makes it different

- **Agent-first responses**: Every MCP tool returns `actionable`, `severity`, `confidence`, `context` — not raw data you have to interpret
- **`pulselive_recommend`**: A ranked action list. Rank 1 is what you should fix right now
- **Trend analysis**: Not just "is it broken now?" but "is it getting worse?" with direction, delta, and velocity
- **Anomaly detection**: Statistical (2σ from rolling mean), not threshold-based
- **Webhook alerts**: HMAC-signed push on anomalies, degrading trends, flaky CI
- **Security hardened**: SSRF protection (IPv4 + IPv6), no shell injection, no token leaks

## Installation

```bash
npx @siongyuencheah/pulselive check
# or install globally
npm install -g @siongyuencheah/pulselive
pulselive check
```

## Quick Start

### 1. Initialise configuration

```bash
cd your-project
pulselive init
```

Creates `.pulselive.yml` with auto-detected GitHub repo, language, and health endpoints.

### 2. Run a check

```bash
pulselive check
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

Every `pulselive check` saves a history entry. After a few runs:

```bash
pulselive trends
pulselive anomalies
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
pulselive mcp-stdio
```

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pulselive": {
      "command": "npx",
      "args": ["-y", "@siongyuencheah/pulselive", "mcp-stdio"]
    }
  }
}
```

Or for Cursor — same config in `.cursor/mcp.json`.

### HTTP Transport

```bash
pulselive mcp
```

Starts an HTTP server on port 3000.

### 9 Tools

| Tool | What It Returns |
|------|----------------|
| `pulselive_check` | Full health check (all modules) + optional trends |
| `pulselive_ci` | CI status + flakiness score + trend |
| `pulselive_health` | Endpoint health + latency + baseline comparison |
| `pulselive_deps` | Dependency audit (vulnerable + outdated) |
| `pulselive_summary` | Summary + top anomalies + overall trend direction |
| `pulselive_trends` | Trend analysis: direction, delta, velocity per check |
| `pulselive_anomalies` | Anomaly detection (2σ from rolling mean) |
| `pulselive_metrics` | Full telemetry: history + trends + current values |
| `pulselive_recommend` | **Prioritised action items** ranked by severity + confidence |

### HTTP Query Parameters

```
GET /?tool=pulselive_check&include_trends=true
GET /?tool=pulselive_trends&check_type=deps&window=14
GET /?tool=pulselive_metrics&check_type=ci
GET /?tool=pulselive_recommend
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

`pulselive_recommend` ranks what matters most, so agents don't waste time on low-impact items:

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
pulselive check

# JSON output (for scripts and agents)
pulselive check --json

# Include trends in JSON
pulselive check --json --include-trends

# JUnit XML (for CI/CD pipelines)
pulselive check --junit

# Exit 1 on critical (CI gating)
pulselive check --fail-on-error

# Verbose output with timing
pulselive check --verbose

# Compare with previous run
pulselive check --compare

# Trend analysis
pulselive trends
pulselive trends --type deps --window 14
pulselive trends --json

# Anomaly detection
pulselive anomalies
pulselive anomalies --json

# Run history
pulselive history --limit 20 --json

# Initialise config
pulselive init

# Start MCP server (HTTP)
pulselive mcp

# Start MCP stdio transport (Claude Desktop / Cursor)
pulselive mcp-stdio
```

## Configuration

`.pulselive.yml`:

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
  - url: https://hooks.example.com/pulselive
    events: [anomaly, degrading, flaky, critical]
    secret: optional-hmac-secret
```

## 8 Check Modules

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

## Webhook Events

| Event | Trigger |
|-------|---------|
| `critical` | Any check with error status |
| `anomaly` | Metric exceeds 2σ from rolling mean |
| `degrading` | Trend direction is degrading |
| `flaky` | CI flakiness score > 30% |

Webhooks are HMAC-SHA256 signed when a secret is configured. Payload includes `event`, `checkType`, `severity`, `actionable`, `context`.

## Security

- **No shell injection** — all `child_process` calls use `execFileSync` (no shell spawned)
- **SSRF protection** — blocks private IPs, loopback, cloud metadata (IPv4 + IPv6), DNS resolution validation, no redirect following
- **No token leaks** — `init` never writes tokens to config, error messages are generic, tokens via env vars only
- **YAML hardening** — `schema: 'core'` prevents dangerous types, 64KB size limit, repo regex validation
- **Path traversal blocking** — MCP `dir` param validated against `..` and null bytes
- **DoS protection** — max 20 endpoints, 1–30s timeouts, 64KB config limit

## Comparison

| Feature | PulseLive | GitHub MCP Server | Datadog MCP |
|---------|-----------|-------------------|-------------|
| Single-call health check | ✅ | ❌ (5+ calls) | ❌ (paid) |
| Agent-first responses | ✅ | ❌ (raw data) | ❌ (dashboards) |
| Prioritised recommendations | ✅ | ❌ | ❌ |
| Trend analysis | ✅ | ❌ | ✅ |
| Anomaly detection | ✅ | ❌ | ✅ |
| Webhook alerts | ✅ | ❌ | ✅ |
| SSRF protection | ✅ | — | — |
| No account required | ✅ | ✅ | ❌ |
| Open source | ✅ (MIT) | ✅ | ❌ |

## License

MIT