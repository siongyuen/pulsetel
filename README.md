# pulselive

**Real-time project health for AI agents and developers. One command to check CI, deploys, endpoints, dependencies, and issues.**

## Why pulselive?

In today's fast-paced development environment, you need instant visibility into your project's health. pulselive provides:

- **Comprehensive checks**: CI/CD status, deployments, endpoint health, git status, issues, and dependencies
- **AI-agent ready**: Built-in MCP (Model Context Protocol) server for AI agent integration
- **Developer-friendly**: Simple CLI with colorful output and JSON support
- **CI/CD integration**: Exit codes for automated workflows
- **Auto-detection**: Smart configuration detection for GitHub repos and package managers

## Installation

```bash
npx pulselive
# or
npm install -g pulselive
```

## Usage

### Basic check
```bash
pulselive check
```

### JSON output
```bash
pulselive check --json
```

### CI mode (exit 1 on critical issues)
```bash
pulselive check --ci
```

### Single check type
```bash
pulselive check --type ci
pulselive check --type health
pulselive check --type deps
```

### Initialize configuration
```bash
pulselive init
```

### Start MCP server
```bash
pulselive mcp --port 3000
```

## Example Output

```
PULSELIVE — your project, right now

🔄 CI/CD:
  ✅ main — All checks passed (3 min ago)

🚀 Deploys:
  ✅ Production — deployed 2h ago

🌐 Endpoints:
  ✅ API — 200 (42ms)

📋 Git:
  Branch: feature/auth
  Uncommitted: 3 files
  Recent: "fix: auth token refresh" (2h ago)

🐛 Issues:
  Open: 23 (3 critical, 5 bugs)

📦 Dependencies:
  ❌ 2 high vulnerabilities
  ⚠️  7 outdated packages

📊 Summary: 2 critical, 2 warnings
```

## MCP Integration

pulselive includes a built-in MCP (Model Context Protocol) server for AI agent integration:

```bash
pulselive mcp --port 3000
```

The server exposes these tools:

- `pulselive_check` - Full project health report
- `pulselive_ci` - CI/CD status only
- `pulselive_health` - Endpoint health status
- `pulselive_deps` - Dependency status
- `pulselive_summary` - Summary statistics

Each tool returns structured JSON for easy AI consumption.

## Configuration

Create a `.pulselive.yml` file:

```yaml
github:
  repo: "your-org/your-repo"
  token: "ghp_your_token_here"

health:
  endpoints:
    - name: "API"
      url: "http://localhost:3000/health"
      timeout: 3000
    - name: "Admin"
      url: "http://localhost:3001/health"
      timeout: 2000

checks:
  ci: true
  deps: true
  git: true
  health: true
  issues: true
  deploy: true
```

## Comparison

| Feature | pulselive | GitHub MCP Server | Datadog MCP | DevPulse |
|---------|-----------|-------------------|-------------|----------|
| **CLI Support** | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| **MCP Server** | ✅ Built-in | ✅ Yes | ✅ Yes | ❌ No |
| **CI/CD Status** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Deployments** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| **Endpoint Health** | ✅ Yes | ❌ No | ✅ Yes | ❌ No |
| **Git Status** | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| **Issues Tracking** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Dependencies** | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| **Auto-detection** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Multi-language** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Open Source** | ✅ MIT | ✅ MIT | ❌ Proprietary | ✅ MIT |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start MCP server
npm start
```

## License

MIT © pulselive