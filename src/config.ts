import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import yaml from 'yaml';
import path from 'path';

export interface PulseliveConfig {
  github?: {
    repo?: string;
    token?: string;
  };
  health?: {
    endpoints?: Array<{
      name: string;
      url: string;
      timeout?: number;
    }>;
  };
  checks?: {
    ci?: boolean;
    deps?: boolean;
    git?: boolean;
    health?: boolean;
    issues?: boolean;
    deploy?: boolean;
  };
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
      const configContent = readFileSync(this.configPath, 'utf8');
      return yaml.parse(configContent) as PulseliveConfig;
    } catch (error) {
      return {};
    }
  }

  getConfig(): PulseliveConfig {
    return this.config;
  }

  autoDetect(): PulseliveConfig {
    const detectedConfig: PulseliveConfig = { ...this.config };

    // Auto-detect GitHub repo from git remote
    if (!detectedConfig.github?.repo) {
      try {
        const gitRemote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
        const match = gitRemote.match(/github\.com[:\/]([^\/.]+)\/([^\/.]+)(\.git)?$/);
        if (match) {
          detectedConfig.github = {
            repo: `${match[1]}/${match[2]}`,
            ...detectedConfig.github
          };
        }
      } catch (error) {
        // Git remote not available
      }
    }

    // Auto-detect language from files
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!detectedConfig.checks) {
      detectedConfig.checks = {};
    }

    // Enable deps check if package.json exists
    if (require('fs').existsSync(packageJsonPath)) {
      detectedConfig.checks.deps = true;
    }

    // Enable git check if .git directory exists
    if (require('fs').existsSync(path.join(process.cwd(), '.git'))) {
      detectedConfig.checks.git = true;
    }

    return detectedConfig;
  }
}