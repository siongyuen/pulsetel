# PulseTel

**MCP server that gives AI agents structured ground truth about the project they're working on.**

[![npm version](https://img.shields.io/npm/v/pulsetel-cli.svg)](https://www.npmjs.com/package/pulsetel-cli) [![Test Coverage](https://img.shields.io/badge/coverage-80%25%20statements-brightgreen)](https://github.com/siongyuen/pulsetel) [![Tests](https://img.shields.io/badge/tests-741%20passing-brightgreen)](https://github.com/siongyuen/pulsetel) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Why This Exists

AI agents working on codebases fly blind on project health. They don't know if CI is red, if coverage dropped, or if dependencies have critical vulnerabilities — until something breaks.

PulseTel closes that loop. An agent queries PulseTel, gets structured ground truth about the project, and **acts on it**. Not dashboards. Not graphs. Just the signals an agent needs, in the format it can use.

**Other agents guess. PulseTel agents know.**

## The Agent Feedback Loop

```
Agent starts task → checks PulseTel → sees CI is red + coverage dropped 3%
                                    → adjusts plan, fixes CI first, then continues
```

This is the novel loop: **agent queries project health mid-task and gets steered by the result.** No human in the loop, no dashboards to read. Just structured truth, delivered when the agent needs it.

## Installation

```bash
npx pulsetel-cli check
# or install globally
npm install -g pulsetel-cli
pulsetel check
```

## Quick Start

### 1. Initialize

```bash
cd your-project
pulsetel init
```

Auto-detects GitHub repo, health endpoints, and creates `.pulsetel.yml`.

### 2. Check

```bash
pulsetel check          # Full project health check
pulsetel check --quick  # Fast triage (~2s, skips slow checks)
pulsetel check --json   # Machine-readable output for agents
```

Every run persists structured data to `.pulsetel-history/` for trend analysis.

### 3. Analyze

```bash
pulsetel trends          # Direction, delta, velocity per check type
pulsetel anomalies       # Statistical anomaly detection (z-score)
pulsetel diff --delta    # Significant changes only (token-efficient)
pulsetel ping            # Lightweight health ping (0-100 score)
```

### 4. For AI Agents (MCP)

PulseTel exposes 12 MCP tools that return structured, agent-native responses:

| Tool | Purpose |
|------|---------|
| `pulsetel_check` | Full health check — all signals |
| `pulsetel_quick` | Fast triage (~2s) |
| `pulsetel_trends` | Trend direction, delta, velocity |
| `pulsetel_anomalies` | Statistical anomaly detection |
| `pulsetel_recommend` | Prioritized fix list with severity + confidence |
| `pulsetel_telemetry` | OpenTelemetry export |

Every response includes `actionable`, `severity`, `confidence`, and `context` — no interpretation required.

## What PulseTel Actually Does

| Signal | What It Checks | Why It Matters |
|--------|---------------|----------------|
| **CI** | GitHub Actions status, flakiness | Don't commit on red |
| **Dependencies** | Vulnerabilities, outdated packages | Critical vulns block deploys |
| **Coverage** | Test coverage vs threshold | Catch regressions before merge |
| **Git** | Branch status, uncommitted changes, divergence | Know the state before acting |
| **Health** | Endpoint availability, latency | Production health at a glance |
| **Issues** | Open issue counts and trends | Stale issues signal neglect |
| **PRs** | Open pull requests | Merge conflicts and review debt |
| **Deploy** | Recent deployment status | Know what's live |

Every check returns a single schema: `{status, message, details, severity, confidence, actionable}`. Apples to apples, every time.

## The Opinion

PulseTel refuses to be a monitoring dashboard. It's a CLI that gives you:

1. **A single health score** (0-100) — not a wall of graphs
2. **Actionable next steps** — not "it depends"
3. **Structured data agents can use** — not prose for humans to interpret

If you want dashboards, use Grafana. If you want an agent to know whether it's safe to ship, use PulseTel.

## Delta Mode

```bash
pulsetel diff --delta --threshold 5
```

Returns only significant changes with risk assessment. ~90% smaller than full check output — designed for token-efficient agent consumption.

## Schema

Versioned data contract. See [SCHEMA.md](./SCHEMA.md):

```json
{
  "schema_version": "1.0.0",
  "checks": {
    "ci": { "status": "success", "severity": "low", "actionable": "No action needed" },
    "deps": { "status": "error", "severity": "critical", "actionable": "Fix 2 critical vulnerabilities before next deploy" },
    "coverage": { "status": "error", "percentage": 59.5, "threshold": 80 }
  },
  "confidence": 65
}
```

## Documentation

- [SCHEMA.md](./SCHEMA.md) — Versioned data contract
- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design
- [CHANGELOG.md](./CHANGELOG.md) — Release history
- [SECURITY.md](./SECURITY.md) — Security model and SSRF protection

## License

Apache 2.0