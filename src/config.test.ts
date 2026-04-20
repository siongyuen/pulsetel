import { describe, it, expect } from 'vitest';
import { ConfigLoader, PulseliveConfig } from './config.js';

function makeDeps(configContent: string) {
  return {
    readFileSync: () => configContent,
    statSync: () => ({ size: 100 }),
    execFileSync: () => '',
    existsSync: () => true
  };
}

describe('ConfigLoader validateConfig', () => {
  it('accepts otel as a valid top-level key', () => {
    const yaml = `
otel:
  enabled: true
  endpoint: http://localhost:4318
  protocol: http
  service_name: my-service
  export_dir: ./traces
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    const otelWarnings = result.warnings.filter(w => w.includes('otel'));
    expect(otelWarnings).toEqual([]);
  });

  it('accepts sentry as a valid top-level key', () => {
    const yaml = `
sentry:
  organization: my-org
  project: my-project
  token: my-token
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    const sentryWarnings = result.warnings.filter(w => w.includes('sentry') && w.includes('Unknown'));
    expect(sentryWarnings).toEqual([]);
  });

  it('rejects unknown top-level keys', () => {
    const yaml = `
unknown_section:
  foo: bar
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    expect(result.warnings).toContain('Unknown top-level key: "unknown_section"');
  });

  it('warns on invalid otel protocol', () => {
    const yaml = `
otel:
  enabled: true
  protocol: grpc
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    expect(result.warnings.some(w => w.includes('Invalid otel protocol'))).toBe(true);
  });

  it('warns on unknown otel key', () => {
    const yaml = `
otel:
  enabled: true
  bogus_key: true
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    expect(result.warnings.some(w => w.includes('Unknown otel key'))).toBe(true);
  });

  it('warns on missing sentry required fields', () => {
    const yaml = `
sentry:
  organization: my-org
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    expect(result.warnings.some(w => w.includes('"project" field'))).toBe(true);
  });

  it('warns on unknown sentry key', () => {
    const yaml = `
sentry:
  organization: my-org
  project: my-proj
  bogus: true
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    expect(result.warnings.some(w => w.includes('Unknown sentry key'))).toBe(true);
  });

  it('accepts all valid top-level keys together', () => {
    const yaml = `
github:
  repo: owner/repo
health:
  allow_local: true
checks:
  ci: true
webhooks:
  - url: https://example.com/hook
    events: [anomaly]
otel:
  enabled: true
sentry:
  organization: org
  project: proj
`;
    const loader = new ConfigLoader('.pulsetel.yml', makeDeps(yaml));
    const result = loader.validateConfig();
    const unknownKeyWarnings = result.warnings.filter(w => w.includes('Unknown top-level'));
    expect(unknownKeyWarnings).toEqual([]);
  });
});