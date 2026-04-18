import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { execSync } from 'child_process';

export class GitCheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      // Get current branch
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

      // Get recent commits
      const recentCommits = execSync('git log --oneline -5', { encoding: 'utf8' }).trim();

      // Get uncommitted changes count
      const uncommitted = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
      const uncommittedCount = uncommitted.split('\n').filter(line => line.trim() !== '').length;

      // Get divergence from main
      let divergence = 'unknown';
      try {
        const mainCommit = execSync('git rev-parse main', { encoding: 'utf8' }).trim();
        const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        const diff = execSync(`git rev-list --left-right --count ${mainCommit}...${currentCommit}`, {
          encoding: 'utf8'
        }).trim();
        const [behind, ahead] = diff.split('\t').map(Number);
        divergence = ahead > 0 ? `ahead by ${ahead}` : behind > 0 ? `behind by ${behind}` : 'up to date';
      } catch (error) {
        // Couldn't determine divergence
      }

      return {
        type: 'git',
        status: 'success',
        message: `Git status: ${branch} branch`,
        details: {
          branch,
          uncommitted: uncommittedCount,
          recentCommits: recentCommits.split('\n'),
          divergence
        }
      };
    } catch (error) {
      return {
        type: 'git',
        status: 'error',
        message: `Git check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}