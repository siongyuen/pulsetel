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

      // Get divergence from default branch (main, master, or trunk)
      let divergence = 'unknown';
      try {
        // Resolve the default branch: prefer remote HEAD, fall back to local branches
        let defaultBranch: string | undefined;
        try {
          const remoteHead = execSync('git rev-parse --abbrev-ref HEAD@{upstream}', { encoding: 'utf8' }).trim();
          // e.g. 'origin/main' → extract 'main'
          defaultBranch = remoteHead.split('/').slice(1).join('/');
        } catch {
          // No upstream — try common defaults in order
          for (const candidate of ['main', 'master', 'trunk', 'develop']) {
            try {
              execSync(`git rev-parse --verify ${candidate}`, { encoding: 'utf8', stdio: 'pipe' });
              defaultBranch = candidate;
              break;
            } catch {
              // branch doesn't exist
            }
          }
        }

        if (defaultBranch) {
          // If on the default branch, compare against upstream tracking ref
          // to detect unpushed commits. Otherwise, compare against the default branch.
          let compareRef: string;
          if (defaultBranch === branch) {
            try {
              // Try to use the upstream tracking branch for comparison
              const upstream = execSync('git rev-parse --abbrev-ref HEAD@{upstream}', { encoding: 'utf8', stdio: 'pipe' }).trim();
              compareRef = upstream; // e.g. 'origin/main'
            } catch {
              // No upstream set — already on default branch with no remote, can't determine divergence
              divergence = 'up to date';
              throw new Error('no upstream'); // skip to outer catch
            }
          } else {
            compareRef = defaultBranch;
          }

          const compareCommit = execSync(`git rev-parse ${compareRef}`, { encoding: 'utf8' }).trim();
          const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
          const diff = execSync(`git rev-list --left-right --count ${compareCommit}...${currentCommit}`, {
            encoding: 'utf8'
          }).trim();
          const [behind, ahead] = diff.split('\t').map(Number);
          divergence = ahead > 0 ? `ahead by ${ahead}` : behind > 0 ? `behind by ${behind}` : 'up to date';
        }
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