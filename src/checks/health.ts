import { PulseliveConfig } from '../config';
import { CheckResult } from '../scanner';
import fetch from 'node-fetch';

export class HealthCheck {
  private config: PulseliveConfig;

  constructor(config: PulseliveConfig) {
    this.config = config;
  }

  async run(): Promise<CheckResult> {
    try {
      const endpoints = this.config.health?.endpoints || [];

      if (endpoints.length === 0) {
        return {
          type: 'health',
          status: 'warning',
          message: 'No health endpoints configured'
        };
      }

      const results: Array<{ name: string; status: number; responseTime: number }> = [];

      for (const endpoint of endpoints) {
        const startTime = Date.now();
        const response = await fetch(endpoint.url, {
          method: 'GET'
          // Note: timeout is not directly supported by fetch API
        });
        const responseTime = Date.now() - startTime;

        results.push({
          name: endpoint.name,
          status: response.status,
          responseTime
        });
      }

      const allSuccess = results.every(r => r.status >= 200 && r.status < 300);
      const hasErrors = results.some(r => r.status >= 500);

      if (allSuccess) {
        return {
          type: 'health',
          status: 'success',
          message: `All endpoints healthy (${results.length} checked)`,
          details: results
        };
      } else if (hasErrors) {
        return {
          type: 'health',
          status: 'error',
          message: `${results.filter(r => r.status >= 500).length} endpoints failed`,
          details: results
        };
      } else {
        return {
          type: 'health',
          status: 'warning',
          message: `Some endpoints have issues (${results.filter(r => r.status >= 400).length} warnings)`,
          details: results
        };
      }
    } catch (error) {
      return {
        type: 'health',
        status: 'error',
        message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}