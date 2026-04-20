# PulseTel Preflight — Design Specification

## Problem Statement

Agents are blocked waiting for GitHub Actions to validate fixes. An 8-minute CI cycle creates idle time and breaks flow state. PulseTel needs a **local, fast validation mode** that gives agents confidence before pushing.

## Design Philosophy

**"Fail fast, fix local, push confident"**

- Sub-30 second validation (vs 8+ minute CI)
- Simulate what CI would check
- Provide actionable feedback immediately
- No external dependencies (GitHub, webhooks)

## Command Interface

```bash
# Basic preflight — local validation only
pulsetel preflight

# Full simulation — includes what CI would check
pulsetel preflight --full

# Dry-run CI steps
pulsetel preflight --ci-only

# Focus on specific concerns
pulsetel preflight --type build,test,lint
pulsetel preflight --fix-verified  # check if last fix worked

# JSON for agents
pulsetel preflight --json
```

## Output Schema (PreflightResult)

```typescript
interface PreflightResult {
  schema_version: "1.0.0";
  timestamp: string;
  duration_ms: number;
  
  // Overall assessment
  confidence: 'high' | 'medium' | 'low' | 'none';
  ready_to_push: boolean;
  blockers: string[];
  
  // Local validation (fast)
  local: {
    build: { passed: boolean; duration_ms: number; errors: string[] };
    test: { passed: boolean; duration_ms: number; failed: number; total: number };
    lint: { passed: boolean; duration_ms: number; errors: number; warnings: number };
    typecheck: { passed: boolean; duration_ms: number; errors: string[] };
  };
  
  // Simulated CI checks (based on local state)
  simulated: {
    ci_likely_status: 'pass' | 'fail' | 'uncertain';
    coverage_estimate: number;  // based on changed files
    risk_factors: string[];
    files_changed: number;
    test_files_affected: number;
  };
  
  // Actionable guidance
  recommendation: string;
  suggested_next_steps: string[];
  estimated_ci_time_minutes: number;
}
```

## Validation Categories

### 1. Build Validation (Fast)
- Compile/transpile without errors
- Bundle size check (warn if >threshold)
- Circular dependency detection

### 2. Test Validation (Focused)
- Run tests for **changed files only** (not full suite)
- Use git diff to identify affected test files
- Fail fast on first error

### 3. Lint/Format (Instant)
- ESLint/Prettier on changed files
- Fast fail

### 4. Type Check (Incremental)
- `tsc --noEmit` or equivalent
- Focus on changed modules

### 5. Coverage Impact (Estimate)
- Which files lost coverage?
- Estimate based on changed lines
- Flag high-risk changes

## Smart Test Selection

```typescript
// Only run tests that could be affected by changes
function getAffectedTests(changedFiles: string[]): string[] {
  const patterns = {
    'src/utils/*.ts': ['test/utils/*.test.ts'],
    'src/components/*.tsx': ['test/components/*.test.tsx', 'e2e/*.spec.ts'],
    'package.json': ['test/install.test.ts'],
  };
  // Return minimal test set
}
```

## CI Simulation Logic

Without waiting for GitHub, predict CI outcome:

| Local Check | CI Prediction |
|-------------|---------------|
| Build failed | CI will fail |
| Tests passed (affected only) | CI likely pass |
| Coverage dropped >10% | CI may fail threshold |
| No tests for changed code | CI risky |
| Lint errors | CI will fail |

## Example Agent Workflow

```bash
# Agent makes a fix
$ pulsetel preflight

🛫 PulseTel Preflight — Local Validation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build:     ✅ 2.1s
Test:      ✅ 1.3s (12 affected tests)
Lint:      ✅ 0.4s
TypeCheck: ✅ 3.2s

Confidence: HIGH
Ready to push: YES
Estimated CI time: 8 minutes → 0 minutes saved

💡 Recommendation: Push confidently. Local validation covers
   all affected code paths. CI will likely pass.

# Agent pushes, CI passes
```

## MCP Tool Integration

```typescript
// New MCP tool: pulsetel_preflight
{
  name: "pulsetel_preflight",
  description: "Validate changes locally before pushing to CI",
  inputSchema: {
    type: "object",
    properties: {
      full: { type: "boolean", description: "Run full validation including CI simulation" },
      focus: { type: "string", enum: ["build", "test", "lint", "typecheck"] }
    }
  }
}
```

## Implementation Phases

### Phase 1: Core Local Checks
- Build, test (affected only), lint
- Duration target: <30 seconds

### Phase 2: CI Simulation
- Predict CI outcome
- Risk assessment
- Coverage estimation

### Phase 3: Smart Test Runner
- Git-based test selection
- Incremental coverage
- Parallel execution

## Risk: False Confidence

**Mitigation:**
- Clear labeling: "Local validation only — CI may catch integration issues"
- Coverage estimation is approximate
- Flag when preflight coverage is insufficient

## Success Metrics

- Preflight duration: <30 seconds
- CI prediction accuracy: >90%
- Agent adoption: preflight used before 80% of pushes
- Time saved: 8 min → 30 sec per validation cycle
