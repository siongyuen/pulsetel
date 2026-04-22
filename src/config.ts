import { readFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import yaml from 'yaml';
import path from 'path';

const MAX_CONFIG_SIZE = 64 * 1024; // 64KB max config file size
const GITHUB_REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export interface ConfigLoaderDeps {
  readFileSync: (path: string, encoding?: string) => string | Buffer;
  statSync: (path: string) => { size: number };
  execFileSync: (command: string, args: string[], options: any) => string;
  existsSync: (path: string) => boolean;
}

export const defaultConfigLoaderDeps: ConfigLoaderDeps = {
  readFileSync: (path: string, encoding?: string) => readFileSync(path, encoding as any),
  statSync,
  execFileSync,
  existsSync: (path: string) => require('fs').existsSync(path)
};

export interface WebhookConfig {
  url: string;
  events: string[];  // 'anomaly' | 'degrading' | 'flaky' | 'critical'
  secret?: string;
}

export interface PulseliveConfig {
  github?: {
    repo?: string;
    token?: string;
  };
  health?: {
    allow_local?: boolean;
    endpoints?: Array<{
      name: string;
      url: string;
      timeout?: number;
      baseline?: number;
    }>;
  };
  checks?: {
    ci?: boolean;
    deps?: boolean;
    git?: boolean;
    health?: boolean;
    issues?: boolean;
    deploy?: boolean;
    prs?: boolean;
    sentry?: boolean;
    coverage?: {
      enabled?: boolean;
      threshold?: number;
      remote?: {
        provider?: 'codecov' | 'coveralls';
        repo?: string;
        token?: string;
      };
    };
    timeouts?: {
      deps?: number;    // Timeout for dependency checks (ms)
      health?: number;  // Timeout for health endpoint checks (ms)
      git?: number;     // Timeout for git checks (ms)
      ci?: number;      // Timeout for CI checks (ms)
      issues?: number;  // Timeout for issue checks (ms)
      deploy?: number;  // Timeout for deploy checks (ms)
      prs?: number;     // Timeout for PR checks (ms)
      sentry?: number;  // Timeout for sentry checks (ms)
      coverage?: number; // Timeout for coverage checks (ms)
    };
  };
  webhooks?: WebhookConfig[];
  otel?: {
    enabled?: boolean;
    endpoint?: string;
    protocol?: 'http' | 'file';
    service_name?: string;
    export_dir?: string;
  };
  sentry?: {
    organization: string;
    project: string;
    token?: string;
  };
}

export class ConfigLoader {
  private configPath: string;
  private config: PulseliveConfig;
  private deps: ConfigLoaderDeps;

  constructor(configPath: string = '.pulsetel.yml', deps: ConfigLoaderDeps = defaultConfigLoaderDeps) {
    // Auto-detect JSON config if YAML doesn't exist but JSON does
    if (configPath === '.pulsetel.yml' && !deps.existsSync('.pulsetel.yml') && deps.existsSync('.pulsetel.json')) {
      configPath = '.pulsetel.json';
    }
    this.configPath = configPath;
    this.deps = deps;
    this.config = this.loadConfig();
    
    // Validate the loaded configuration and print warnings to stderr
    const validation = this.validateConfig();
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        console.error(`[pulsetel] Config warning: ${warning}`);
      });
    }
  }

  private loadConfig(): PulseliveConfig {
    try {
      // Enforce file size limit to prevent DoS via large config
      if (!this.deps.existsSync(this.configPath)) {
        return {};
      }
      const stats = this.deps.statSync(this.configPath);
      if (stats.size > MAX_CONFIG_SIZE) {
        console.error(`[pulsetel] Error: Config file ${this.configPath} exceeds ${MAX_CONFIG_SIZE / 1024}KB limit — ignoring`);
        return {};
      }

      const configContent = this.deps.readFileSync(this.configPath, 'utf8');
      if (typeof configContent !== 'string') {
        return {};
      }

      let parsed: any;

      if (this.configPath.endsWith('.json')) {
        // Parse JSON config with clear error messages
        try {
          parsed = JSON.parse(configContent);
        } catch (parseError: any) {
          const pos = parseError.message;
          console.error(`[pulsetel] Error: Invalid JSON in ${this.configPath}: ${pos}`);
          process.exit(1);
        }
      } else {
        // Use 'core' schema to prevent dangerous YAML constructs (e.g. custom types)
        try {
          parsed = yaml.parse(configContent, { schema: 'core' });
        } catch (yamlError: any) {
          console.error(`[pulsetel] Error: Invalid YAML in ${this.configPath}: ${yamlError.message}`);
          process.exit(1);
        }
      }

      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      const config = parsed as PulseliveConfig;

      // Validate GitHub repo format to prevent injection
      if (config.github?.repo && !GITHUB_REPO_PATTERN.test(config.github.repo)) {
        console.warn(`Invalid GitHub repo format: "${config.github.repo}" — expected "owner/repo"`);
        delete config.github.repo;
      }

      return config;
    } catch (error) {
      return {};
    }
  }

  validateConfig(): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const config = this.getConfig();
    
    // Check for unknown top-level keys
    const validTopLevelKeys = ['github', 'health', 'checks', 'webhooks', 'otel', 'sentry'];
    const configKeys = Object.keys(config);
    
    for (const key of configKeys) {
      if (!validTopLevelKeys.includes(key)) {
        warnings.push(`Unknown top-level key: "${key}"`);
      }
    }
    
    // Validate github section
    if (config.github) {
      const githubKeys = Object.keys(config.github);
      const validGithubKeys = ['repo', 'token'];
      for (const key of githubKeys) {
        if (!validGithubKeys.includes(key)) {
          warnings.push(`Unknown github key: "${key}"`);
        }
      }
      
      if (config.github.repo && !GITHUB_REPO_PATTERN.test(config.github.repo)) {
        warnings.push(`Invalid GitHub repo format: "${config.github.repo}" — expected "owner/repo"`);
      }
    }
    
    // Validate health section
    if (config.health) {
      const healthKeys = Object.keys(config.health);
      const validHealthKeys = ['allow_local', 'endpoints'];
      for (const key of healthKeys) {
        if (!validHealthKeys.includes(key)) {
          warnings.push(`Unknown health key: "${key}"`);
        }
      }
      
      if (config.health.endpoints) {
        for (let i = 0; i < config.health.endpoints.length; i++) {
          const endpoint = config.health.endpoints[i];
          const validEndpointKeys = ['name', 'url', 'timeout', 'baseline'];
          const endpointKeys = Object.keys(endpoint);
          
          for (const key of endpointKeys) {
            if (!validEndpointKeys.includes(key)) {
              warnings.push(`Unknown endpoint key in position ${i}: "${key}"`);
            }
          }
          
          if (!endpoint.url) {
            warnings.push(`Endpoint at position ${i} is missing required "url" field`);
          }
        }
      }
    }
    
    // Validate checks section
    if (config.checks) {
      const checksKeys = Object.keys(config.checks);
      const validChecksKeys = ['ci', 'deps', 'git', 'health', 'issues', 'deploy', 'prs', 'coverage', 'sentry'];
      
      for (const key of checksKeys) {
        if (!validChecksKeys.includes(key)) {
          warnings.push(`Unknown checks key: "${key}"`);
        }
      }
      
      // Validate coverage section if it exists
      if (config.checks.coverage && typeof config.checks.coverage === 'object') {
        const coverageKeys = Object.keys(config.checks.coverage);
        const validCoverageKeys = ['enabled', 'threshold', 'remote'];
        
        for (const key of coverageKeys) {
          if (!validCoverageKeys.includes(key)) {
            warnings.push(`Unknown coverage key: "${key}"`);
          }
        }
        
        if (config.checks.coverage.threshold !== undefined && 
            (typeof config.checks.coverage.threshold !== 'number' || 
             config.checks.coverage.threshold < 0 || 
             config.checks.coverage.threshold > 100)) {
          warnings.push(`Coverage threshold should be a number between 0 and 100`);
        }
        
        // Validate remote section
        if (config.checks.coverage.remote) {
          const remoteKeys = Object.keys(config.checks.coverage.remote);
          const validRemoteKeys = ['provider', 'repo', 'token'];
          
          for (const key of remoteKeys) {
            if (!validRemoteKeys.includes(key)) {
              warnings.push(`Unknown remote coverage key: "${key}"`);
            }
          }
          
          if (config.checks.coverage.remote.provider && 
              !['codecov', 'coveralls'].includes(config.checks.coverage.remote.provider)) {
            warnings.push(`Invalid coverage provider: "${config.checks.coverage.remote.provider}" — expected "codecov" or "coveralls"`);
          }
        }
      }
    }
    
    // Validate otel section
    if (config.otel) {
      const otelKeys = Object.keys(config.otel);
      const validOtelKeys = ['enabled', 'endpoint', 'protocol', 'service_name', 'export_dir'];
      
      for (const key of otelKeys) {
        if (!validOtelKeys.includes(key)) {
          warnings.push(`Unknown otel key: "${key}"`);
        }
      }
      
      if (config.otel.protocol && !['http', 'file'].includes(config.otel.protocol)) {
        warnings.push(`Invalid otel protocol: "${config.otel.protocol}" — expected "http" or "file"`);
      }
    }
    
    // Validate sentry section
    if (config.sentry) {
      const sentryKeys = Object.keys(config.sentry);
      const validSentryKeys = ['organization', 'project', 'token'];
      
      for (const key of sentryKeys) {
        if (!validSentryKeys.includes(key)) {
          warnings.push(`Unknown sentry key: "${key}"`);
        }
      }
      
      if (!config.sentry.organization) {
        warnings.push(`Sentry config is missing required "organization" field`);
      }
      
      if (!config.sentry.project) {
        warnings.push(`Sentry config is missing required "project" field`);
      }
    }
    
    // Validate webhooks section
    if (config.webhooks) {
      for (let i = 0; i < config.webhooks.length; i++) {
        const webhook = config.webhooks[i];
        const validWebhookKeys = ['url', 'events', 'secret'];
        const webhookKeys = Object.keys(webhook);
        
        for (const key of webhookKeys) {
          if (!validWebhookKeys.includes(key)) {
            warnings.push(`Unknown webhook key in position ${i}: "${key}"`);
          }
        }
        
        if (!webhook.url) {
          warnings.push(`Webhook at position ${i} is missing required "url" field`);
        }
        
        if (webhook.events && !Array.isArray(webhook.events)) {
          warnings.push(`Webhook at position ${i}: "events" should be an array`);
        }
      }
    }
    
    return {
      valid: warnings.length === 0,
      warnings
    };
  }

  getConfig(): PulseliveConfig {
    return this.config;
  }

  autoDetect(baseDir?: string): PulseliveConfig {
    const detectedConfig: PulseliveConfig = JSON.parse(JSON.stringify(this.config || {}));
    const workingDir = baseDir || process.cwd();

    // Auto-detect GitHub repo from git remote
    if (!detectedConfig.github?.repo) {
      try {
        // Use execFileSync to prevent shell injection via repo URL
        const gitRemote = this.deps.execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: workingDir }).trim();
        
        // Handle both SSH and HTTPS URLs
        const sshMatch = gitRemote.match(/git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        const httpsMatch = gitRemote.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        
        const match = sshMatch || httpsMatch;
        if (match) {
          detectedConfig.github = {
            ...detectedConfig.github,
            repo: `${match[1]}/${match[2]}`
          };
        }
      } catch (error) {
        // Git remote not available
      }
    }

    // Auto-detect language from files
    const packageJsonPath = path.join(workingDir, 'package.json');
    const requirementsPath = path.join(workingDir, 'requirements.txt');
    const goModPath = path.join(workingDir, 'go.mod');
    if (!detectedConfig.checks) {
      detectedConfig.checks = {};
    }

    // Enable deps check if package manager file exists (only if not explicitly set)
    if (detectedConfig.checks.deps === undefined) {
      if (this.deps.existsSync(packageJsonPath) || this.deps.existsSync(requirementsPath) || this.deps.existsSync(goModPath)) {
        detectedConfig.checks.deps = true;
      }
    }

    // Enable git check if .git directory exists (only if not explicitly set)
    if (detectedConfig.checks.git === undefined) {
      if (this.deps.existsSync(path.join(workingDir, '.git'))) {
        detectedConfig.checks.git = true;
      }
    }

    // Fall back to GITHUB_TOKEN / GH_TOKEN env var if not set in config
    if (!detectedConfig.github?.token) {
      const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (envToken) {
        detectedConfig.github = {
          ...detectedConfig.github,
          token: envToken
        };
      }
    }

    return detectedConfig;
  }
}