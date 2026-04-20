import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { execFileSync } from 'child_process';

/**
 * Dependency injection interface for GitCheck.
 * Allows injecting the execFile function for testability
 * without relying on module-level vi.mock.
 */
export interface GitDeps {
  execFile: (command: string, args: string[], options: { encoding: string; stdio: string[]; cwd: string }) => string;
}

/**
 * Default implementation that uses real child_process.execFileSync.
 */
export const defaultGitDeps: GitDeps = {
  execFile: (command, args, options) => {
    return execFileSync(command, args, options as any).toString();
  },
};

export class GitCheck {
  private config: PulseliveConfig;
  private workingDir: string;
  private deps: GitDeps;

  constructor(config: PulseliveConfig, workingDir: string = process.cwd(), deps: GitDeps = defaultGitDeps) {
    this.config = config;
    this.workingDir = workingDir;
    this.deps = deps;
  }

  /**
   * Safely execute a git command using execFile to prevent shell injection.
   * Arguments are passed directly to the binary — no shell spawning.
   */
  private git(args: string[]): string {
    return this.deps.execFile('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.workingDir,
    }).trim();
  }

  async run(): Promise<CheckResult> {
    try {
      // Get current branch
      const branch = this.git(['rev-parse', '--abbrev-ref', 'HEAD']);

      // Get recent commits
      const recentCommits = this.git(['log', '--oneline', '-5']);

      // Get uncommitted changes count
      const uncommitted = this.git(['status', '--porcelain']);
      const uncommittedCount = uncommitted.split('\n').filter(line => line.trim() !== '').length;

      // Get divergence from default branch (main, master, or trunk)
      let divergence = 'unknown';
      try {
        // Resolve the default branch: prefer remote HEAD, fall back to local branches
        let defaultBranch: string | undefined;
        try {
          const remoteHead = this.git(['rev-parse', '--abbrev-ref', 'HEAD@{upstream}']);
          // e.g. 'origin/main' → extract 'main'
          defaultBranch = remoteHead.split('/').slice(1).join('/');
        } catch {
          // No upstream — try common defaults in order
          for (const candidate of ['main', 'master', 'trunk', 'develop']) {
            try {
              this.git(['rev-parse', '--verify', candidate]);
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
              const upstream = this.git(['rev-parse', '--abbrev-ref', 'HEAD@{upstream}']);
              compareRef = upstream; // e.g. 'origin/main'
            } catch {
              // No upstream set — already on default branch with no remote, can't determine divergence
              divergence = 'up to date';
              throw new Error('no upstream'); // skip to outer catch
            }
          } else {
            compareRef = defaultBranch;
          }

          const compareCommit = this.git(['rev-parse', compareRef]);
          const currentCommit = this.git(['rev-parse', 'HEAD']);
          const diff = this.git(['rev-list', '--left-right', '--count', `${compareCommit}...${currentCommit}`]);
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
        message: `Git check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}