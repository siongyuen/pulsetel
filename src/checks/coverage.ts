import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import fetch from 'node-fetch';

interface CoverageSummary {
  total: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
}

interface LcovData {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
  branchesFound: number;
  branchesHit: number;
}

export class CoverageCheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      // Get threshold from config, default to 80
      const threshold = this.config.checks?.coverage?.threshold ?? 80;
      
      // Try remote coverage first (Codecov/Coveralls), then fall back to local
      const coverageData = await this.detectCoverage();
      
      if (!coverageData) {
        return {
          type: 'coverage',
          status: 'warning',
          message: 'No coverage reports found (local or remote)'
        };
      }

      // Calculate overall coverage percentage
      const coveragePercentage = this.calculateOverallCoverage(coverageData);
      
      // Determine status based on threshold
      let status: 'success' | 'warning' | 'error' = 'success';
      if (coveragePercentage < 60) {
        status = 'error';
      } else if (coveragePercentage < threshold) {
        status = 'warning';
      }

      const source = coverageData.source || 'local';
      return {
        type: 'coverage',
        status: status,
        message: `Coverage: ${coveragePercentage.toFixed(1)}% (threshold: ${threshold}%) [${source}]`,
        details: {
          percentage: coveragePercentage,
          threshold: threshold,
          source: source,
          ...coverageData
        }
      };
      
    } catch (error) {
      return {
        type: 'coverage',
        status: 'error',
        message: 'Coverage check failed'
      };
    }
  }

  private async detectCoverage(): Promise<{
    lines?: number;
    statements?: number;
    functions?: number;
    branches?: number;
    source?: string;
  } | null> {
    // Try remote coverage providers first (CodeCov, Coveralls)
    const remoteCoverage = await this.fetchRemoteCoverage();
    if (remoteCoverage) return remoteCoverage;

    // Fall back to local coverage files
    // Try Istanbul/nyc coverage-summary.json first
    const istanbulPath = path.join('coverage', 'coverage-summary.json');
    if (existsSync(istanbulPath)) {
      try {
        const summary = this.parseIstanbulCoverage(istanbulPath);
        if (summary) return { ...summary, source: 'istanbul' };
      } catch (error) {
        // Parse failure
      }
    }

    // Try lcov.info
    const lcovPath = path.join('coverage', 'lcov.info');
    if (existsSync(lcovPath)) {
      try {
        const lcovData = this.parseLcovCoverage(lcovPath);
        if (lcovData) return { ...lcovData, source: 'lcov' };
      } catch (error) {
        // Parse failure
      }
    }

    // Try Clover XML
    const cloverPath = path.join('coverage', 'clover.xml');
    if (existsSync(cloverPath)) {
      try {
        const cloverData = this.parseCloverCoverage(cloverPath);
        if (cloverData) return { ...cloverData, source: 'clover' };
      } catch (error) {
        // Parse failure
      }
    }

    return null;
  }

  /**
   * Fetch coverage from remote providers: Codecov and Coveralls.
   * These are public APIs that don't require tokens for public repos,
   * but tokens are supported for private repos.
   */
  private async fetchRemoteCoverage(): Promise<{
    lines?: number;
    statements?: number;
    functions?: number;
    branches?: number;
    source?: string;
  } | null> {
    const remote = this.config.checks?.coverage?.remote;
    const repo = this.config.github?.repo;
    const token = this.config.github?.token;

    if (!repo) return null;

    // Try Codecov
    const provider = remote?.provider || 'codecov';
    const remoteRepo = remote?.repo || repo;
    const remoteToken = remote?.token || '';

    if (provider === 'codecov') {
      try {
        const coverage = await this.fetchCodecov(remoteRepo, remoteToken);
        if (coverage !== null) return { lines: coverage, source: 'codecov' };
      } catch {
        // Codecov fetch failed
      }
    }

    if (provider === 'coveralls') {
      try {
        const coverage = await this.fetchCoveralls(remoteRepo, remoteToken);
        if (coverage !== null) return { lines: coverage, source: 'coveralls' };
      } catch {
        // Coveralls fetch failed
      }
    }

    // If no explicit provider, try both
    if (!remote?.provider) {
      try {
        const coverage = await this.fetchCodecov(remoteRepo, remoteToken);
        if (coverage !== null) return { lines: coverage, source: 'codecov' };
      } catch {
        // Codecov failed
      }

      try {
        const coverage = await this.fetchCoveralls(remoteRepo, remoteToken);
        if (coverage !== null) return { lines: coverage, source: 'coveralls' };
      } catch {
        // Coveralls failed
      }
    }

    return null;
  }

  /**
   * Fetch coverage from Codecov API.
   * Tries the v5 commits endpoint which includes totals.coverage,
   * then falls back to v2 repo-level coverage.
   */
  private async fetchCodecov(repo: string, token?: string): Promise<number | null> {
    const [owner, name] = repo.split('/');
    
    const headers: any = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `token ${token}`;

    // Try v5 commits endpoint (includes coverage totals)
    try {
      const commitsUrl = `https://api.codecov.io/api/v5/github/${owner}/repos/${name}/commits?limit=1`;
      const response = await fetch(commitsUrl, { headers, signal: AbortSignal.timeout(5000) as any });
      if (response.ok) {
        const data: any = await response.json();
        const latestCommit = data?.results?.[0];
        const coverage = latestCommit?.totals?.coverage;
        if (coverage != null) {
          return typeof coverage === 'string' ? parseFloat(coverage) : coverage;
        }
      }
    } catch {
      // v5 failed
    }

    // Fallback: try v2 repo endpoint
    try {
      const repoUrl = `https://api.codecov.io/api/v2/github/${owner}/repos/${name}`;
      const response = await fetch(repoUrl, { headers, signal: AbortSignal.timeout(5000) as any });
      if (response.ok) {
        const data: any = await response.json();
        const coverage = data?.latest_commit?.totals?.coverage;
        if (coverage != null) {
          return typeof coverage === 'string' ? parseFloat(coverage) : coverage;
        }
      }
    } catch {
      // v2 failed
    }

    return null;
  }

  /**
   * Fetch coverage from Coveralls API.
   * Public repos: https://coveralls.io/github/{owner}/{repo}.json
   */
  private async fetchCoveralls(repo: string, _token?: string): Promise<number | null> {
    const [owner, name] = repo.split('/');
    const url = `https://coveralls.io/github/${owner}/${name}.json`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000) as any
    });

    if (!response.ok) return null;

    const data: any = await response.json();
    if (data?.covered_percent != null) {
      return data.covered_percent;
    }

    return null;
  }

  private parseIstanbulCoverage(filePath: string): {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  } | null {
    try {
      const content = readFileSync(filePath, 'utf8');
      const summary = JSON.parse(content) as CoverageSummary;
      
      return {
        lines: summary.total.lines,
        statements: summary.total.statements,
        functions: summary.total.functions,
        branches: summary.total.branches
      };
    } catch (error) {
      return null;
    }
  }

  private parseLcovCoverage(filePath: string): {
    lines: number;
    functions: number;
    branches: number;
  } | null {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      let lcovData: LcovData = {
        linesFound: 0,
        linesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
        branchesFound: 0,
        branchesHit: 0
      };

      for (const line of lines) {
        if (line.startsWith('LF:')) {
          lcovData.linesFound = parseInt(line.substring(3).trim());
        } else if (line.startsWith('LH:')) {
          lcovData.linesHit = parseInt(line.substring(3).trim());
        } else if (line.startsWith('FN:')) {
          lcovData.functionsFound = parseInt(line.substring(3).trim());
        } else if (line.startsWith('FH:')) {
          lcovData.functionsHit = parseInt(line.substring(3).trim());
        } else if (line.startsWith('BRF:')) {
          lcovData.branchesFound = parseInt(line.substring(4).trim());
        } else if (line.startsWith('BRH:')) {
          lcovData.branchesHit = parseInt(line.substring(4).trim());
        }
      }

      return {
        lines: this.calculatePercentage(lcovData.linesHit, lcovData.linesFound),
        functions: this.calculatePercentage(lcovData.functionsHit, lcovData.functionsFound),
        branches: this.calculatePercentage(lcovData.branchesHit, lcovData.branchesFound)
      };
    } catch (error) {
      return null;
    }
  }

  private parseCloverCoverage(filePath: string): {
    statements: number;
    conditionals: number;
    methods: number;
  } | null {
    try {
      const content = readFileSync(filePath, 'utf8');
      const metricsMatch = content.match(/<metrics[^>]*statements="(\d+)"[^>]*coveredstatements="(\d+)"[^>]*conditionals="(\d+)"[^>]*coveredconditionals="(\d+)"[^>]*methods="(\d+)"[^>]*coveredmethods="(\d+)"/);
      
      if (metricsMatch) {
        const statements = parseInt(metricsMatch[1]);
        const coveredStatements = parseInt(metricsMatch[2]);
        const conditionals = parseInt(metricsMatch[3]);
        const coveredConditionals = parseInt(metricsMatch[4]);
        const methods = parseInt(metricsMatch[5]);
        const coveredMethods = parseInt(metricsMatch[6]);

        return {
          statements: this.calculatePercentage(coveredStatements, statements),
          conditionals: this.calculatePercentage(coveredConditionals, conditionals),
          methods: this.calculatePercentage(coveredMethods, methods)
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  private calculatePercentage(hit: number, total: number): number {
    if (total === 0) return 100; // Avoid division by zero
    return (hit / total) * 100;
  }

  private calculateOverallCoverage(coverageData: {
    lines?: number;
    statements?: number;
    functions?: number;
    branches?: number;
  }): number {
    const values = Object.values(coverageData).filter(v => typeof v === 'number' && !isNaN(v)) as number[];
    
    if (values.length === 0) return 0;
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }
}