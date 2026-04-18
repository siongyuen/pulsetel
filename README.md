# pulselive

**Real-time project telemetry for AI agents. One command to check CI, deploys, endpoints, dependencies, issues, and code coverage — with trend analysis and anomaly detection.**

## Why pulselive?

AI agents can't see live project state. They don't know if CI is flaky, if dependencies are drifting, if coverage is declining, or if endpoints are degrading. PulseLive gives agents the answer in one call — with trend direction, anomaly detection, and prioritised recommendations.

- **Agent-first**: Built-in MCP server with 9 tools, every response includes `actionable`, `severity`, `confidence`, `context`
- **Telemetry**: Trend analysis (improving/stable/degrading), anomaly detection (2σ), velocity tracking
- **Webhook alerts**: HMAC-signed push notifications on anomalies, degrading trends, flaky CI
- **8 check modules**: CI, deploy, health, git, issues, PRs, coverage, deps
- **CI/CD integration**: Exit codes, JSON, JUnit XML output
- **Security hardened**: SSRF protection, no shell injection, no token leaks

## Installation

```bash
npx pulselive
# or
npm install -g pulselive
```

## Quick Start

### 1. Initialize configuration

```bash
cd your-project
pulselive init
```

This creates a `.pulselive.yml` file with auto-detected defaults.

### 2. Run a check

```bash
pulselive check
```

### 3. Review trends

```bash
pulselive trends
pulselive anomalies
```

## MCP Server (Agent Interface)

The primary interface for AI agents. Start the MCP server:

```bash
pulselive mcp
```

### Available Tools

| Tool | Purpose |
|------|---------|
| `pulselive_check` | Full health check (all modules) |
| `pulselive_ci` | CI status + flakiness score |
| `pulselive_health` | Endpoint health + latency |
| `pulselive_deps` | Dependency audit |
| `pulselive_summary` | Summary + top anomalies + overall trend |
| `pulselive_trends` | Trend analysis (direction, delta, velocity) |
| `pulselive_anomalies` | Anomaly detection (2σ from rolling mean) |
| `pulselive_metrics` | Full telemetry: history + trends + current |
| `pulselive_recommend` | Prioritised action items ranked by impact |

### Query Parameters

```
GET /?tool=pulselive_check&include_trends=true
GET /?tool=pulselive_trends&check_type=deps&window=14
GET /?tool=pulselive_metrics&check_type=ci
GET /?tool=pulselive_recommend
GET /?dir=/path/to/project
```

### Response Format (Agent-Optimised)

Every MCP response includes structured, actionable data:

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

### Recommendations

`pulselive_recommend` returns a ranked action list:

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

# JSON output
pulselive check --json

# Include trends in JSON
pulselive check --json --include-trends

# JUnit XML (for CI/CD)
pulselive check --junit

# CI mode (exit 1 on critical)
pulselive check --fail-on-error

# Verbose output
pulselive check --verbose

# Compare with previous run
pulselive check --compare

# Single check type
pulselive check --type ci

# Trend analysis
pulselive trends
pulselive trends --type deps
pulselive trends --window 14
pulselive trends --json

# Anomaly detection
pulselive anomalies
pulselive anomalies --json

# Run history
pulselive history
pulselive history --limit 20
pulselive history --json

# Initialize config
pulselive init

# Start MCP server
pulselive mcp
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

## Check Modules

| Check | What It Does | Key Metrics |
|-------|-------------|------------|
| **CI** | GitHub Actions last 10 runs | flakinessScore, trend |
| **Health** | HTTP endpoint checks + SSRF protection | latency, baseline ratio |
| **Deps** | npm audit + outdated | vulnerable, outdated |
| **Coverage** | Local (Istanbul/lcov/Clover) + remote (Codecov/Coveralls) | percentage |
| **Issues** | GitHub Issues | open, closed |
| **PRs** | GitHub Pull Requests | open, needsReview, conflicts |
| **Git** | Branch, uncommitted, divergence | uncommitted, divergence |
| **Deploy** | GitHub Deployments | status |

## Webhook Events

| Event | Trigger |
|-------|---------|
| `critical` | Any check with error status |
| `anomaly` | Metric exceeds 2σ from rolling mean |
| `degrading` | Trend direction is degrading |
| `flaky` | CI flakiness > 30% |

Webhooks are HMAC-SHA256 signed when a secret is configured. Payload includes `event`, `checkType`, `severity`, `actionable`, `context`.

## Security

- No `execSync` — all child_process uses `execFileSync`
- SSRF protection — blocks private IPs, loopback, cloud metadata
- DNS validation — resolves hostnames, blocks banned IPs
- No token leaks — errors use generic messages, `init` never writes tokens
- YAML hardening — `schema: 'core'` prevents dangerous types
- Path traversal blocking — MCP `dir` param validated
- 64KB config limit, max 20 endpoints, 1-30s timeouts

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full data flow, types, and conventions.

## License

MIT