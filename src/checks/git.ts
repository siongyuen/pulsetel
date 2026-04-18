import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { execFileSync } from 'child_process';

/**
 * Safely execute a git command using execFileSync to prevent shell injection.
 * execFileSync does not spawn a shell — arguments are passed directly to the binary.
 */
function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export class GitCheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      // Get current branch
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

      // Get recent commits
      const recentCommits = git(['log', '--oneline', '-5']);

      // Get uncommitted changes count
      const uncommitted = git(['status', '--porcelain']);
      const uncommittedCount = uncommitted.split('\n').filter(line => line.trim() !== '').length;

      // Get divergence from default branch (main, master, or trunk)
      let divergence = 'unknown';
      try {
        // Resolve the default branch: prefer remote HEAD, fall back to local branches
        let defaultBranch: string | undefined;
        try {
          const remoteHead = git(['rev-parse', '--abbrev-ref', 'HEAD@{upstream}']);
          // e.g. 'origin/main' → extract 'main'
          defaultBranch = remoteHead.split('/').slice(1).join('/');
        } catch {
          // No upstream — try common defaults in order
          for (const candidate of ['main', 'master', 'trunk', 'develop']) {
            try {
              git(['rev-parse', '--verify', candidate]);
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
              const upstream = git(['rev-parse', '--abbrev-ref', 'HEAD@{upstream}']);
              compareRef = upstream; // e.g. 'origin/main'
            } catch {
              // No upstream set — already on default branch with no remote, can't determine divergence
              divergence = 'up to date';
              throw new Error('no upstream'); // skip to outer catch
            }
          } else {
            compareRef = defaultBranch;
          }

          const compareCommit = git(['rev-parse', compareRef]);
          const currentCommit = git(['rev-parse', 'HEAD']);
          const diff = git(['rev-list', '--left-right', '--count', `${compareCommit}...${currentCommit}`]);
          const [behind, ahead] = diff.split('\t').map(Number);
          divergence = ahead > 0 ? `ahead by ${ahead}` : behind > 0 ? `behind by ${behind}` : 'up to date';
        }
      } catch (error) {
        // Couldn't determine divergence — already handled above
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
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      // Distinguish between "not a git repo" and actual failures
      if (errMsg.includes('not a git repository')) {
        return {
          type: 'git',
          status: 'warning',
          message: '⚠ Not a git repository — git-dependent checks (CI, PRs, issues) skipped'
        };
      }
      if (errMsg.includes('ambiguous argument') && errMsg.includes('HEAD')) {
        return {
          type: 'git',
          status: 'warning',
          message: 'Git repository has no commits yet'
        };
      }
      return {
        type: 'git',
        status: 'error',
        message: 'Git check failed'
      };
    }
  }
}