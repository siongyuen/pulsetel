# PulseTel

**The opinionated project health framework for AI agents.**

[![npm version](https://img.shields.io/npm/v/pulsetel-cli.svg)](https://www.npmjs.com/package/pulsetel-cli) [![Test Coverage](https://img.shields.io/badge/coverage-81%25%20statements-brightgreen)](https://github.com/siongyuen/pulsetel) [![Tests](https://img.shields.io/badge/tests-680%20passing-brightgreen)](https://github.com/siongyuen/pulsetel) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## The Problem

AI agents working on codebases face a common challenge: **project health data is fragmented, unstructured, and ephemeral.**

- CI status is in GitHub Actions
- Security vulnerabilities are in `npm audit`
- Test coverage is in a coverage report
- Git status requires `git status`, `git log`, `git diff`
- Endpoint health requires manual HTTP checks

An agent *could* collect all this manually. But it requires:
- Knowing which signals matter
- Normalizing data across different formats
- Persisting history for trend analysis
- Correlating failures across signals

**Most agents don't do this.** They fly blind on project health until something breaks.

## The Solution

PulseTel provides **structured, persistent, analyzable project health telemetry** — the framework agents need to track and understand project health over time.

### What PulseTel Provides

| Layer | What It Does | Why Agents Need It |
|-------|--------------|-------------------|
| **Telemetry Collection** | Curated check suite (CI, deps, coverage, git, health) | Agents don't know what signals matter |
| **Schema Normalization** | Every check returns `{status, message, details, severity}` | Compare apples to apples across different sources |
| **History Persistence** | Automatic `.pulsetel-history/` with structured entries | Track trends, detect degradation |
| **Statistical Analytics** | Z-score anomaly detection, trend analysis, confidence scoring | Intelligence agents can't calculate manually |
| **Multi-Signal Correlation** | Detect when CI failures correlate with coverage drops | Root cause analysis |

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

### 2. Collect Telemetry

```bash
pulsetel check
```

Every run saves structured data to `.pulsetel-history/` for trend analysis.

### 3. Analyze

```bash
pulsetel trends          # Trend analysis with direction, delta, velocity
pulsetel anomalies       # Statistical anomaly detection (2σ threshold)
pulsetel diff --delta    # Significant changes only, token-efficient
```

### 4. Intelligence

```bash
pulsetel recommend       # Prioritized action list — what to fix first
```

## For AI Agents (MCP)

PulseTel exposes 12 MCP tools that return structured, agent-native responses:

| Tool | Purpose |
|------|---------|
| `pulsetel_check` | Full health check with all signals |
| `pulsetel_quick` | Fast triage (~2s), skips slow checks |
| `pulsetel_trends` | Trend analysis for specific check types |
| `pulsetel_anomalies` | Detect statistical anomalies across history |
| `pulsetel_recommend` | Prioritized fix list with severity/confidence |
| `pulsetel_telemetry` | OpenTelemetry export for observability |

Every response includes `actionable`, `severity`, `confidence`, and `context` — no interpretation required.

## Key Features

### Statistical Analytics
- **Z-score anomaly detection**: 2σ threshold, not naive thresholds
- **Trend analysis**: Direction, delta, velocity calculations
- **Confidence scoring**: Multi-factor health aggregation (0-100)

### Delta Mode (Token Efficient)
```bash
pulsetel diff --delta --threshold 5
```
Returns only significant changes with risk assessment — ~90% smaller than full check output.

### Security Hardened
- SSRF protection (IPv4 + IPv6)
- No shell injection
- No token leaks to logs

## Schema

PulseTel uses a versioned schema contract ([SCHEMA.md](./SCHEMA.md)):

```json
{
  "schema_version": "1.0.0",
  "timestamp": "2026-04-20T14:00:00Z",
  "checks": {
    "ci": { "status": "success", "message": "...", "severity": "low" },
    "deps": { "status": "warning", "message": "...", "vulnerabilities": {...} },
    "coverage": { "status": "error", "percentage": 59.5, "threshold": 80 }
  },
  "confidence": 65,
  "recommendation": "Fix 2 critical vulnerabilities before next deploy"
}
```

## Documentation

- [SCHEMA.md](./SCHEMA.md) — Versioned data contract
- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design
- [CHANGELOG.md](./CHANGELOG.md) — Release history

## License

Apache 2.0