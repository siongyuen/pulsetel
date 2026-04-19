# Security Audit Report: PulseLive MCP Server

**Author:** Charlie (AI Mentor & Architectural Auditor)  
**Project:** [PulseTel](https://github.com/siongyuen/pulsetel)  
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
Tools designed to provide project summaries or telemetry (e.g., `pulsetel_check`) necessitate file system access. Without rigorous sanitisation, an agent can be coerced into reading files outside the designated project root.

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
Implement a post-processing layer that scans all MCP tool responses for patterns resembling:
- API keys, Bearer tokens, or private environment variables before they are returned to the LLM
- Private IP addresses (RFC 1918 ranges)
- AWS/Azure/GCP metadata endpoints
- SSH keys and credential patterns
- File system paths that leak host architecture

This is the single most impactful defence against the "confused deputy" problem: even if an attacker tricks the LLM into requesting sensitive data, the sanitisation layer ensures it never leaves the tool boundary.

### 5.2 Rate Limiting & Resource Bounds
- Enforce per-tool rate limits to prevent DoS via rapid successive calls
- Cap response payload sizes to prevent memory exhaustion
- Implement circuit breakers for health check endpoints that consistently timeout
- Implement hard timeouts and payload size limits for all subprocesses and network requests to prevent Resource Exhaustion (DoS) attacks

### 5.3 Audit Logging
- Log all MCP tool invocations with caller identity, arguments, and response status
- Make logs available for forensic review (already partially implemented via `mcp-usage.json`)
- Consider structured audit events for security-significant operations

### 5.4 Least-Privilege Execution
- The README should explicitly mandate running the MCP server under a non-privileged service account (Least Privilege Principle)
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

Sean, your engineering on PulseLive is technically sophisticated, but in the domain of AI Agency, security is not a feature—it is the foundation. An AI tool that can be manipulated into exfiltrating data is a liability, not an asset.

Your Action Plan:
1. **Prioritise:** Address the DNS Rebinding vulnerability immediately; it is the most sophisticated and dangerous vector.
2. **Hardening:** Replace all path-joining logic with the "Prefix Verification" pattern.
3. **Accountability:** Once these remediations are implemented, update the documentation to reflect the server's hardened posture.

This project has the potential to be a definitive tool for AI-driven telemetry. Ensure its security matches its utility.

---

*Audit date: 2026-04-19*  
*Auditor: Charlie (AI Mentor & Architectural Auditor)*  
*Version reviewed: v1.0.1*