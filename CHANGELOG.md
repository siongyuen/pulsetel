# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2-0-0.html).

## [0.3.0] - 2026-04-18
## [1.0.2] - 2026-04-19

### Fixed
- **Critical: DNS rebinding SSRF protection** — IP pinning via custom HTTP agent (`PinnedAgent`/`PinnedHttpsAgent`) resolves DNS once and validates connected IP matches, preventing TOCTOU attacks
- **High: Path traversal safe root boundary** — `validateDir()` now enforces project root prefix verification; absolute paths like `/etc/passwd` are rejected
- **IPv6 SSRF blocking** — Fixed IPv6 addresses (fd00:ec2::254, fe80::, fc00::) bypassing SSRF validation in health checks
- **Cloud metadata IP list** — Added explicit `CLOUD_METADATA_IPS` blocklist for both IPv4 and IPv6 metadata endpoints

## [1.0.1] - 2026-04-19

### Fixed
- **P0: Path traversal vulnerability** in MCP server — `validateDir()` now uses `path.resolve()` + `path.normalize()`, rejects `..`, null bytes, relative paths, and escape attempts
- **P0: Trends/Anomalies crash** — TypeError on cold start replaced with friendly message: "📊 Insufficient data — need at least 3/5 data points"
- **P0: Status crash** — TypeError on missing history replaced with: "No status history found. Run `pulsetel check` first to establish a baseline."


### Added - Telemetry Focus
- **Trend analysis engine** (`src/trends.ts`) - TrendAnalyzer with direction, delta, anomaly (2 sigma), velocity
- **Anomaly detection** - cross-check all types, ranked by severity (z-score based)
- **CLI: `pulsetel trends`** - trend analysis for all or specific check types (--json, --window)
- **CLI: `pulsetel anomalies`** - detected anomalies with severity ranking (--json)
- **CLI: `--include-trends` flag** on `check` command - trends + anomalies in JSON output
- **Enriched history** - per-check duration, metrics objects, hostname, pulsetel_version
- **MCP tool: `pulsetel_trends`** - trend analysis for agents (check_type, window params)
- **MCP tool: `pulsetel_anomalies`** - anomaly detection for agents
- **MCP tool: `pulsetel_metrics`** - full telemetry (history + trends + current) per check type
- **MCP tool: `pulsetel_recommend`** - prioritised action items ranked by impact
- **MCP agent-first response format** - every MCP result includes actionable, severity, confidence, context
- **MCP self-telemetry** - logs every tool call to `.pulsetel-history/mcp-usage.json`
- **`pulsetel_summary` enhanced** - includes top anomalies and overall trend direction
- **Webhook notifications** (`src/webhooks.ts`) - HMAC-SHA256 signed POSTs on anomaly/degrading/flaky/critical
- **Webhook config** - `webhooks` array in `.pulsetel.yml` with url, events, optional secret
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
- **Historical data & trends** - `pulsetel history` command, `--compare` flag for run-to-run comparison
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
- **Token leak fix** - `pulsetel init` no longer writes GITHUB_TOKEN to config file
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
- `pulsetel init`: generates empty endpoints list and `token: ""` by default

## [0.1.0] - 2026-04-18

### Added
- Initial release
- 6 check modules: CI, deploy, health, git, issues, deps
- CLI: `pulsetel check`, `pulsetel init`, `pulsetel mcp`
- MCP server mode with 5 tools
- JSON output (`--json`) and CI mode (`--fail-on-error`)
- Auto-detection of GitHub repo, package manager, git directory
- `.pulsetel.yml` configuration with auto-detect
- Colored terminal output with status icons
- 32 tests passing