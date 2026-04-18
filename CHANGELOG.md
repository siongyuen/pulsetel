# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2-0-0.html).

## [0.3.0] - 2026-04-18
## [1.0.1] - 2026-04-19

### Fixed
- **P0: Path traversal vulnerability** in MCP server — `validateDir()` now uses `path.resolve()` + `path.normalize()`, rejects `..`, null bytes, relative paths, and escape attempts
- **P0: Trends/Anomalies crash** — TypeError on cold start replaced with friendly message: "📊 Insufficient data — need at least 3/5 data points"
- **P0: Status crash** — TypeError on missing history replaced with: "No status history found. Run `pulselive check` first to establish a baseline."


### Added - Telemetry Focus
- **Trend analysis engine** (`src/trends.ts`) - TrendAnalyzer with direction, delta, anomaly (2 sigma), velocity
- **Anomaly detection** - cross-check all types, ranked by severity (z-score based)
- **CLI: `pulselive trends`** - trend analysis for all or specific check types (--json, --window)
- **CLI: `pulselive anomalies`** - detected anomalies with severity ranking (--json)
- **CLI: `--include-trends` flag** on `check` command - trends + anomalies in JSON output
- **Enriched history** - per-check duration, metrics objects, hostname, pulselive_version
- **MCP tool: `pulselive_trends`** - trend analysis for agents (check_type, window params)
- **MCP tool: `pulselive_anomalies`** - anomaly detection for agents
- **MCP tool: `pulselive_metrics`** - full telemetry (history + trends + current) per check type
- **MCP tool: `pulselive_recommend`** - prioritised action items ranked by impact
- **MCP agent-first response format** - every MCP result includes actionable, severity, confidence, context
- **MCP self-telemetry** - logs every tool call to `.pulselive-history/mcp-usage.json`
- **`pulselive_summary` enhanced** - includes top anomalies and overall trend direction
- **Webhook notifications** (`src/webhooks.ts`) - HMAC-SHA256 signed POSTs on anomaly/degrading/flaky/critical
- **Webhook config** - `webhooks` array in `.pulselive.yml` with url, events, optional secret
- **New tests** - 16 new tests for trends (10) and webhooks (6). Total: 66 passing.
- **Architecture docs** - `ARCHITECTURE.md`

### Changed
- Product direction: **MCP-first (agents), CLI-second (humans)**
- Description: "Real-time project telemetry for AI agents"

## [0.2.0] - 2026-04-18

### Added
- **PR status check** - open PRs, needs review, conflicts, drafts (`prs` check type)
- **Code coverage check** - local (Istanbul, lcov, Clover) + remote (Codecov, Coveralls APIs)
- **JUnit XML output** - `--junit` flag for CI/CD integration
- **Historical data & trends** - `pulselive history` command, `--compare` flag for run-to-run comparison
- **Performance baselines** - `baseline` field in endpoint config with 2x/5x threshold alerts
- **`allow_local` config** - SSRF escape hatch for local dev health endpoints (`health.allow_local: true`)
- **`--verbose` flag** - detailed output including full error details and check execution times
- **Execution metadata in JSON** - timestamps, execution duration, version info in `--json` output
- **Retry logic** - GitHub API calls retry up to 2 times on 5xx/rate-limit errors
- **Config file size limit** - 64KB max to prevent DoS via large YAML

### Security
- **Command injection fix** - replaced all `execSync` with `execFileSync` (no shell spawned)
- **SSRF protection** - blocks private IPs, loopback, cloud metadata (169.254.x.x) in health checks
- **DNS validation** - resolves hostnames and blocks IPs in banned ranges
- **Token leak fix** - `pulselive init` no longer writes GITHUB_TOKEN to config file
- **YAML hardening** - `schema: 'core'` prevents dangerous YAML constructs
- **Repo validation** - regex validation on `github.repo` config field
- **MCP path traversal** - blocks `..` and null bytes in directory parameters
- **Error sanitization** - generic error messages, no stack traces or tokens in output
- **Redirect blocking** - `redirect: 'manual'` in health check to prevent redirect-based SSRF
- **Endpoint limits** - max 20 endpoints, 1-30s timeout bounds

### Changed
- Health check: `startTime` tracked before try block for accurate failure timing
- All GitHub API checks: `statusText` removed from error messages, uses `status` code only
- MCP server: returns generic `'Unknown tool'` instead of echoing invalid tool names
- `pulselive init`: generates empty endpoints list and `token: ""` by default

## [0.1.0] - 2026-04-18

### Added
- Initial release
- 6 check modules: CI, deploy, health, git, issues, deps
- CLI: `pulselive check`, `pulselive init`, `pulselive mcp`
- MCP server mode with 5 tools
- JSON output (`--json`) and CI mode (`--fail-on-error`)
- Auto-detection of GitHub repo, package manager, git directory
- `.pulselive.yml` configuration with auto-detect
- Colored terminal output with status icons
- 32 tests passing