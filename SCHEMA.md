# PulseLive JSON Schema Contract

This document defines the structured JSON output format for PulseLive CLI and MCP responses.

## Schema Version

All JSON responses include schema versioning for backward compatibility:

```json
{
  "schema_version": "1.0.0",
  "schema_url": "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md"
}
```

## Common Fields

All JSON responses include these common fields:

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `schema_version` | string | Schema version (semantic versioning) | ✅ |
| `schema_url` | string | URL to schema definition | ✅ |
| `version` | string | PulseLive tool version | ✅ |
| `timestamp` | string | ISO 8601 timestamp | ✅ |
| `duration` | number | Execution time in milliseconds | ✅ |
| `results` | array | Array of check results | ✅ |

## Check Result Object

Each result in the `results[]` array has this structure:

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `check` | string | Check type identifier | ✅ |
| `status` | string | Check status: "success", "warning", "error" | ✅ |
| `severity` | string | Severity level: "low", "medium", "high", "critical" | ✅ |
| `confidence` | string | Confidence level: "low", "medium", "high" | ✅ |
| `actionable` | string | Actionable recommendation | ✅ |
| `context` | string | Context/explanation | ✅ |
| `message` | string | Human-readable message | ✅ |
| `details` | object | Detailed metrics and data | ❌ |
| `duration` | number | Check execution time in ms | ❌ |

## Status Values

- `success`: Check passed, no issues found
- `warning`: Issues found but not critical
- `error`: Critical issues found

## Severity Values

- `low`: Informational, no immediate action needed
- `medium`: Should be addressed soon
- `high`: Important, should be addressed
- `critical`: Urgent, requires immediate attention

## Confidence Values

- `low`: Uncertain or heuristic-based detection
- `medium`: Reasonably confident
- `high`: High confidence in accuracy

## Example Response

```json
{
  "schema_version": "1.0.0",
  "schema_url": "https://github.com/siongyuen/pulselive/blob/master/SCHEMA.md",
  "version": "0.5.5",
  "timestamp": "2024-04-18T15:10:00.000Z",
  "duration": 1250,
  "results": [
    {
      "check": "deps",
      "status": "warning",
      "severity": "high",
      "confidence": "high",
      "actionable": "Run npm audit fix to address 2 critical vulnerabilities",
      "context": "Vulnerable dependencies pose security risks",
      "message": "2 critical vulnerabilities found",
      "details": {
        "vulnerabilities": {
          "critical": 2,
          "high": 0,
          "medium": 1,
          "low": 3
        },
        "outdated": 5,
        "total": 48
      },
      "duration": 450
    }
  ]
}
```

## MCP Tool Responses

MCP tool responses follow the same schema contract with the same common fields and result structure.

## Backward Compatibility

The schema version allows for evolution while maintaining compatibility:
- New optional fields may be added in minor versions
- Breaking changes require major version bumps
- Agents should check `schema_version` and handle unknown fields gracefully

## Changelog

### 1.0.0 (2024-04-18)
- Initial schema definition
- Standardized result structure with actionable fields
- Added severity and confidence levels
- Unified CLI and MCP response formats