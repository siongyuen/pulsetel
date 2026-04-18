# Security Audit Report: PulseLive MCP Server

**Author:** Charlie (AI Mentor & Architectural Auditor)  
**Project:** [PulseLive](https://github.com/siongyuen/pulselive)  
**Status:** Critical Review  
**Tone:** Technical / Professional (British English)

---

## 1. Executive Summary

This report delineates a comprehensive security assessment of the PulseLive Model Context Protocol (MCP) Server. While the repository demonstrates a commendable level of engineering discipline—evidenced by robust transport flexibility and high test coverage—the "Agentic Multiplier" inherent to AI-integrated tools necessitates an exceptionally high security bar.

The audit identifies three primary vectors of concern that could allow a malicious actor to leverage an LLM as a "confused deputy" to compromise the host environment. These findings are not merely theoretical; they represent systemic risks to the trust boundary between the AI agent and the local infrastructure.

---

## 2. Critical Finding: SSRF & DNS Rebinding (Severity: Critical)

### 2.1 Description
The current SSRF (Server-Side Request Forgery) protections employ a "check-then-request" logic using IP deny-listing. However, this is susceptible to Time of Check to Time of Use (TOCTOU) attacks via DNS Rebinding.

### 2.2 Attack Scenario
1. The server validates a domain (e.g., `attacker.com`) which initially resolves to a benign public IP.
2. After validation, but before the HTTP fetch occurs, the DNS record is updated to point to `127.0.0.1` or the AWS/Azure Metadata Service (`169.254.169.254`).
3. PulseLive fetches sensitive internal data and returns it to the LLM, effectively bypassing the internal firewall.

### 2.3 Remediation Strategy
1. **IP Pinning:** Resolve the DNS entry once and use the resulting IP address directly for the socket connection.
2. **Socket-Level Validation:** Customise the HTTP agent to validate the remote IP address *after* the connection is established but *before* any payload data is transmitted.

---

## 3. High Finding: Path Traversal & Escaping (Severity: High)

### 3.1 Description
Tools designed to provide project summaries or telemetry (e.g., `pulselive_check`) necessitate file system access. Without rigorous sanitisation, an agent can be coerced into reading files outside the designated project root.

### 3.2 Vulnerability Vector
An attacker might provide a payload such as `../../../../etc/passwd` or `~/.ssh/config`. If the logic does not resolve the absolute path and compare it against a "Safe Root," the integrity of the host system is compromised.

### 3.3 Remediation Strategy
1. **Absolute Resolution:** Use `path.resolve()` on all user-supplied paths.
2. **Prefix Verification:** Explicitly verify that the resolved path starts with the authorised `PROJECT_ROOT`.
3. **Null Byte Stripping:** Ensure control characters are purged from path strings to prevent bypasses in lower-level C++ file APIs.

### 3.4 Status (v1.0.1)
✅ **Partially addressed.** v1.0.1 patches `validateDir()` in `mcp-server.ts` to reject `..`, null bytes, and relative paths. However, the prefix verification against a `PROJECT_ROOT` safe root has not been implemented — the current fix validates path *form* but does not enforce a *boundary*. A path like `/etc/passwd` (absolute, no `..`, no null bytes) would still pass validation.

**Recommended next step:** Implement safe root prefix checking so only paths under the project directory are permitted.

---

## 4. Medium Finding: Argument Injection in execFileSync (Severity: Medium/High)

### 4.1 Description
PulseLive correctly avoids the shell-spawning `exec()` in favour of `execFileSync()`. However, if user-controlled input (like a branch name or tag) is passed as a direct argument, an attacker can still inject command flags.

### 4.2 Attack Scenario
In a command like `git checkout [user_input]`, a user providing `-n` or `--attr-path` could manipulate the command's behaviour to leak attributes or skip security checks.

### 4.3 Remediation Strategy
1. **The Double-Dash Pattern:** Utilise the `--` separator to signify the end of command options (e.g., `git checkout -- [input]`).
2. **Input Whitelisting:** Implement strict regex validation for branch names and identifiers to ensure they contain only alphanumeric characters and safe delimiters.

---

## 5. Systemic Recommendations (Architectural Hardening)

To align with world-class security standards, the following "Defence in Depth" measures are recommended:

### 5.1 Output Sanitisation (Heuristic Filters)
Implement a post-processing layer that scans all MCP tool responses for patterns matching:
- Private IP addresses (RFC 1918 ranges)
- AWS/Azure/GCP metadata endpoints
- SSH keys, API tokens, and credential patterns
- File system paths that leak host architecture

### 5.2 Rate Limiting & Resource Bounds
- Enforce per-tool rate limits to prevent DoS via rapid successive calls
- Cap response payload sizes to prevent memory exhaustion
- Implement circuit breakers for health check endpoints that consistently timeout

### 5.3 Audit Logging
- Log all MCP tool invocations with caller identity, arguments, and response status
- Make logs available for forensic review (already partially implemented via `mcp-usage.json`)
- Consider structured audit events for security-significant operations

### 5.4 Least-Privilege Execution
- Run health checks with minimal network permissions
- Consider sandboxing git operations (e.g., via `git -C <dir>` with strict path validation)
- Restrict file system access to explicitly configured directories only

### 5.5 Transport Security
- For HTTP MCP transport, enforce TLS and validate certificates
- Implement authentication for MCP endpoints (API key or token-based)
- Add request signing for webhook callbacks (already implemented via HMAC-SHA256)

---

## 6. Finding Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | SSRF & DNS Rebinding | 🔴 Critical | Open — needs IP pinning |
| 2 | Path Traversal & Escaping | 🟠 High | Partially fixed (v1.0.1) — needs safe root prefix |
| 3 | Argument Injection in execFileSync | 🟡 Medium/High | Open — needs double-dash pattern |
| 4 | Output Sanitisation | 🟡 Medium | Not started |
| 5 | Rate Limiting | 🟢 Low | Not started |
| 6 | Audit Logging | 🟢 Low | Partial (`mcp-usage.json`) |
| 7 | Least-Privilege Execution | 🟢 Low | Not started |
| 8 | Transport Security | 🟡 Medium | Partial (HMAC webhooks) |

---

## 7. Conclusion

PulseLive's MCP server represents a thoughtful implementation with strong foundations. The identified vulnerabilities stem not from negligence, but from the inherent challenge of securing AI-agent tool interfaces where the attack surface is amplified by the "confused deputy" problem. The v1.0.1 patch addresses the most immediate path traversal vector, but the DNS rebinding SSRF risk remains critical and should be prioritised for v1.0.2.

**Overall Security Posture:** 7/10 — Good foundations, targeted remediation needed for production trust.

---

*Audit date: 2026-04-19*  
*Auditor: Charlie (AI Mentor & Architectural Auditor)*  
*Version reviewed: v1.0.1*