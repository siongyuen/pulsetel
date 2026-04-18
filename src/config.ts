import { readFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import yaml from 'yaml';
import path from 'path';

const MAX_CONFIG_SIZE = 64 * 1024; // 64KB max config file size
const GITHUB_REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

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
    coverage?: {
      enabled?: boolean;
      threshold?: number;
      remote?: {
        provider?: 'codecov' | 'coveralls';
        repo?: string;
        token?: string;
      };
    };
  };
  webhooks?: WebhookConfig[];
}

export class ConfigLoader {
  private configPath: string;
  private config: PulseliveConfig;

  constructor(configPath: string = '.pulselive.yml') {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  private loadConfig(): PulseliveConfig {
    try {
      // Enforce file size limit to prevent DoS via large YAML
      const stats = statSync(this.configPath);
      if (stats.size > MAX_CONFIG_SIZE) {
        console.warn(`Config file exceeds ${MAX_CONFIG_SIZE / 1024}KB limit — ignoring`);
        return {};
      }

      const configContent = readFileSync(this.configPath, 'utf8');
      // Use 'core' schema to prevent dangerous YAML constructs (e.g. custom types)
      const parsed = yaml.parse(configContent, { schema: 'core' });

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

  getConfig(): PulseliveConfig {
    return this.config;
  }

  autoDetect(): PulseliveConfig {
    const detectedConfig: PulseliveConfig = JSON.parse(JSON.stringify(this.config || {}));

    // Auto-detect GitHub repo from git remote
    if (!detectedConfig.github?.repo) {
      try {
        // Use execFileSync to prevent shell injection via repo URL
        const gitRemote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const match = gitRemote.match(/github\.com[:\/]([^\/]+)\/([^\/]+?)(\.git)?$/);
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
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const requirementsPath = path.join(process.cwd(), 'requirements.txt');
    const goModPath = path.join(process.cwd(), 'go.mod');
    if (!detectedConfig.checks) {
      detectedConfig.checks = {};
    }

    // Enable deps check if package manager file exists (only if not explicitly set)
    const fs = require('fs');
    if (detectedConfig.checks.deps === undefined) {
      if (fs.existsSync(packageJsonPath) || fs.existsSync(requirementsPath) || fs.existsSync(goModPath)) {
        detectedConfig.checks.deps = true;
      }
    }

    // Enable git check if .git directory exists (only if not explicitly set)
    if (detectedConfig.checks.git === undefined) {
      if (fs.existsSync(path.join(process.cwd(), '.git'))) {
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