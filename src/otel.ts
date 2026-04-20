import { PulseliveConfig } from './config';
import { CheckResult } from './scanner';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import path from 'path';

// Optional OpenTelemetry dependencies - will be loaded dynamically
let otelApi: any = null;
let otelSdk: any = null;
let otelTrace: any = null;
let otelMetrics: any = null;
let otelResources: any = null;
let otelSemanticConventions: any = null;

// Module-level flag to track whether OTel deps are available
let otelDepsAvailable: boolean | null = null;

interface OtelConfig {
  enabled?: boolean;
  endpoint?: string;
  protocol?: 'http' | 'file';
  service_name?: string;
  export_dir?: string;
}

interface OtelState {
  tracerProvider: any;
  meterProvider: any;
  meter: any;
  loggerProvider: any;
  tracesExporter: any;
  metricsExporter: any;
  logsExporter: any;
  isInitialized: boolean;
  _config?: PulseliveConfig;
}

const state: OtelState = {
  tracerProvider: null,
  meterProvider: null,
  meter: null,
  loggerProvider: null,
  tracesExporter: null,
  metricsExporter: null,
  logsExporter: null,
  isInitialized: false
};

/**
 * Try to load OpenTelemetry dependencies dynamically
 * Returns true if all dependencies are available
 */
function tryLoadOtelDependencies(): boolean {
  if (otelDepsAvailable !== null) {
    return otelDepsAvailable;
  }
  try {
    otelApi = require('@opentelemetry/api');
    otelSdk = require('@opentelemetry/sdk-node');
    otelTrace = require('@opentelemetry/sdk-trace-node');
    otelMetrics = require('@opentelemetry/sdk-metrics');
    otelResources = require('@opentelemetry/resources');
    otelSemanticConventions = require('@opentelemetry/semantic-conventions');
    otelDepsAvailable = true;
    return true;
  } catch (error) {
    // Dependencies not available - OTel features will be silently disabled
    otelDepsAvailable = false;
    return false;
  }
}

/**
 * Force OTel dependency check to be re-evaluated on next call.
 * Used for testing to reset cached state.
 */
export function _resetOtelDepsCache(): void {
  otelDepsAvailable = null;
}

/**
 * Initialize OpenTelemetry SDK
 */
export function initOtel(config: PulseliveConfig): boolean {
  // Check if OTel is enabled in config
  const otelConfig = config.otel || {};
  if (otelConfig.enabled !== true) {
    return false;
  }

  // Try to load dependencies
  if (!tryLoadOtelDependencies()) {
    console.warn('[pulsetel-otel] OpenTelemetry dependencies not installed. Install @opentelemetry packages to enable OTel export.');
    return false;
  }

  // If already initialized, return true
  if (state.isInitialized) {
    return true;
  }

  try {
    // Create resource with service name
    const serviceName = otelConfig.service_name || 'pulsetel';
    const resource = new otelResources.Resource({
      [otelSemanticConventions.SemanticResourceAttributes.SERVICE_NAME]: serviceName
    });

    // Configure exporters based on protocol
    const protocol = otelConfig.protocol || 'http';
    const endpoint = otelConfig.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

    let traceExporter, metricExporter, logExporter;

    if (protocol === 'http') {
      // OTLP HTTP exporter
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
      const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
      
      traceExporter = new OTLPTraceExporter({
        url: endpoint + '/v1/traces',
      });
      
      metricExporter = new OTLPMetricExporter({
        url: endpoint + '/v1/metrics',
      });
      
      // For logs, we'll use the same endpoint but different path
      logExporter = new OTLPMetricExporter({
        url: endpoint + '/v1/logs',
      });
    } else {
      // File exporter
      const exportDir = otelConfig.export_dir || path.join(process.cwd(), '.pulsetel', 'otel');
      
      // Create directory if it doesn't exist
      if (!existsSync(exportDir)) {
        mkdirSync(exportDir, { recursive: true });
      }
      
      // Simple file-based exporter for traces, metrics, and logs
      traceExporter = {
        export: (spans: any[], resultCallback: any) => {
          const filePath = path.join(exportDir, 'traces.jsonl');
          spans.forEach(span => {
            appendFileSync(filePath, JSON.stringify(span) + '\n');
          });
          resultCallback({ code: otelApi.SpanStatusCode.OK });
        },
        shutdown: () => Promise.resolve()
      };
      
      metricExporter = {
        export: (metrics: any[], resultCallback: any) => {
          const filePath = path.join(exportDir, 'metrics.jsonl');
          metrics.forEach(metric => {
            appendFileSync(filePath, JSON.stringify(metric) + '\n');
          });
          resultCallback({ code: otelApi.SpanStatusCode.OK });
        },
        shutdown: () => Promise.resolve(),
        forceFlush: () => Promise.resolve()
      };
      
      logExporter = {
        export: (logs: any[], resultCallback: any) => {
          const filePath = path.join(exportDir, 'logs.jsonl');
          logs.forEach(log => {
            appendFileSync(filePath, JSON.stringify(log) + '\n');
          });
          resultCallback({ code: otelApi.SpanStatusCode.OK });
        },
        shutdown: () => Promise.resolve()
      };
    }

    // Create trace provider
    const traceProvider = new otelTrace.NodeTracerProvider({
      resource: resource
    });
    
    // Create metric reader for file export
    let metricReader;
    if (protocol === 'file' && metricExporter) {
      // Use a periodic exporting metric reader for file protocol
      // Export every 5 seconds or on demand
      const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
      metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000,
        exportTimeoutMillis: 5000
      });
    }
    
    // Create metric provider
    const meterProvider = new otelMetrics.MeterProvider({
      resource: resource,
      readers: metricReader ? [metricReader] : []
    });
    
    // Store metric reader for force flush
    (meterProvider as any)._metricReader = metricReader;
    
    // Create meter
    const meter = meterProvider.getMeter('pulsetel');

    // Store config for use by exportResults
    state._config = config;

    // Store state
    state.tracerProvider = traceProvider;
    state.meterProvider = meterProvider;
    state.meter = meter;
    state.tracesExporter = traceExporter;
    state.metricsExporter = metricExporter;
    state.logsExporter = logExporter;
    state.isInitialized = true;

    // Register global tracer provider
    otelApi.trace.setGlobalTracerProvider(traceProvider);
    otelApi.metrics.setGlobalMeterProvider(meterProvider);

    return true;
  } catch (error) {
    console.error('[pulsetel-otel] Failed to initialize OpenTelemetry:', error);
    return false;
  }
}

/**
 * Wrap a check function in an OpenTelemetry span
 */
export async function withOtelSpan(checkType: string, fn: () => Promise<any>): Promise<any> {
  if (!state.isInitialized || !otelApi) {
    return fn(); // OTel not initialized, run normally
  }

  const tracer = otelApi.trace.getTracer('pulsetel');
  const startTime = Date.now();

  try {
    return await tracer.startActiveSpan(`pulsetel.check.${checkType}`, async (span: any) => {
      try {
        const result = await fn();
        
        // Set span attributes
        if (result) {
          span.setAttribute('pulsetel.check_type', checkType);
          span.setAttribute('pulsetel.status', result.status || 'unknown');
          span.setAttribute('pulsetel.severity', result.severity || 'unknown');
          span.setAttribute('pulsetel.confidence', result.confidence || 'unknown');
          span.setAttribute('pulsetel.actionable', result.actionable || 'false');
          span.setAttribute('pulsetel.duration_ms', Date.now() - startTime);
          
          // Set span status
          if (result.status === 'error') {
            span.setStatus({ code: otelApi.SpanStatusCode.ERROR });
          } else {
            span.setStatus({ code: otelApi.SpanStatusCode.OK });
          }
        }
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: otelApi.SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  } catch (error) {
    // If span creation fails, just run the function normally
    return fn();
  }
}

/**
 * Export results as OpenTelemetry metrics and logs
 */
export function exportResults(results: CheckResult[]): void {
  if (!state.isInitialized || !state.meter || !otelApi) {
    return; // OTel not initialized
  }

  try {
    const otelConfig = (state as any)._config?.otel || {};
    const protocol = otelConfig.protocol || 'http';
    const exportDir = otelConfig.export_dir || path.join(process.cwd(), '.pulsetel', 'otel');

    // For file protocol, write directly to JSONL files for deterministic output
    if (protocol === 'file') {
      if (!existsSync(exportDir)) {
        mkdirSync(exportDir, { recursive: true });
      }

      const metrics: any[] = [];

      results.forEach(result => {
        // Calculate health score
        let healthScore = 0;
        if (result.status === 'success') {
          healthScore = 100;
        } else if (result.status === 'warning') {
          healthScore = 50;
        } else if (result.status === 'error') {
          healthScore = 0;
        }

        metrics.push({
          name: 'pulsetel.health.score',
          value: healthScore,
          attributes: { check_type: result.type },
          timestamp: new Date().toISOString()
        });

        // Add specific metrics based on check type
        if (result.type === 'deps' && result.details) {
          metrics.push({
            name: 'pulsetel.deps.vulnerable',
            value: result.details.vulnerable || 0,
            timestamp: new Date().toISOString()
          });
          metrics.push({
            name: 'pulsetel.deps.outdated',
            value: result.details.outdated || 0,
            timestamp: new Date().toISOString()
          });
        } else if (result.type === 'issues' && result.details) {
          metrics.push({
            name: 'pulsetel.issues.open',
            value: result.details.open || 0,
            timestamp: new Date().toISOString()
          });
        } else if (result.type === 'ci' && result.details) {
          metrics.push({
            name: 'pulsetel.ci.flakiness_score',
            value: result.details.flakinessScore || 0,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Count total anomalies
      const criticalResults = results.filter(r => r.status === 'error');
      metrics.push({
        name: 'pulsetel.anomalies.total',
        value: criticalResults.length,
        timestamp: new Date().toISOString()
      });

      // Write metrics to JSONL file
      const metricsPath = path.join(exportDir, 'metrics.jsonl');
      metrics.forEach(m => {
        appendFileSync(metricsPath, JSON.stringify(m) + '\n');
      });

      // Log anomaly events to file
      const anomalies = results.filter(r => r.severity === 'high' || r.severity === 'critical');
      if (anomalies.length > 0) {
        const logsPath = path.join(exportDir, 'logs.jsonl');
        anomalies.forEach(result => {
          const logRecord = {
            body: result.message,
            severityText: result.severity,
            attributes: {
              check_type: result.type,
              severity: result.severity,
              confidence: result.confidence,
              actionable: result.actionable,
              context: result.context
            },
            timestamp: new Date().toISOString()
          };
          appendFileSync(logsPath, JSON.stringify(logRecord) + '\n');
        });
      }

      return; // File export complete, skip SDK meter path
    }

    // HTTP protocol path — use SDK meters
    const healthScoreGauge = state.meter.createCounter('pulsetel.health.score', {
      description: 'Health score per check type (0-100)'
    });
    
    const anomaliesCounter = state.meter.createCounter('pulsetel.anomalies.total', {
      description: 'Total anomalies detected'
    });
    
    const depsVulnerableCounter = state.meter.createCounter('pulsetel.deps.vulnerable', {
      description: 'Number of vulnerable dependencies'
    });
    
    const depsOutdatedCounter = state.meter.createCounter('pulsetel.deps.outdated', {
      description: 'Number of outdated dependencies'
    });
    
    const issuesOpenCounter = state.meter.createCounter('pulsetel.issues.open', {
      description: 'Number of open issues'
    });
    
    const ciFlakinessGauge = state.meter.createCounter('pulsetel.ci.flakiness_score', {
      description: 'CI flakiness score'
    });

    // Process each result
    results.forEach(result => {
      // Calculate health score
      let healthScore = 0;
      if (result.status === 'success') {
        healthScore = 100;
      } else if (result.status === 'warning') {
        healthScore = 50;
      } else if (result.status === 'error') {
        healthScore = 0;
      }

      // Add health score metric
      healthScoreGauge.add(healthScore, { check_type: result.type });

      // Add specific metrics based on check type
      if (result.type === 'deps' && result.details) {
        const details = result.details;
        depsVulnerableCounter.add(details.vulnerable || 0);
        depsOutdatedCounter.add(details.outdated || 0);
      } else if (result.type === 'issues' && result.details) {
        const details = result.details;
        issuesOpenCounter.add(details.open || 0);
      } else if (result.type === 'ci' && result.details) {
        const details = result.details;
        ciFlakinessGauge.add(details.flakinessScore || 0);
      }

      // Log anomaly events
      if (result.severity === 'high' || result.severity === 'critical') {
        const logRecord = {
          body: result.message,
          severityText: result.severity,
          severityNumber: 17, // SEVERE - using numeric value directly
          attributes: {
            check_type: result.type,
            severity: result.severity,
            confidence: result.confidence,
            actionable: result.actionable,
            context: result.context
          },
          timestamp: new Date().getTime()
        };
        
        // For now, we'll log to console since we don't have a full logging pipeline
        console.log('[pulsetel-otel-log]', JSON.stringify(logRecord));
      }
    });

    // Count total anomalies (for now, count critical/warning results)
    const criticalResults = results.filter(r => r.status === 'error');
    anomaliesCounter.add(criticalResults.length);

  } catch (error) {
    console.error('[pulsetel-otel] Failed to export results:', error);
  }
}

/**
 * Force flush metrics to exporters (useful for testing)
 */
export async function forceFlushOtel(): Promise<void> {
  if (!state.isInitialized || !state.meterProvider) {
    return;
  }

  try {
    // Force flush via metric reader if available
    const reader = (state.meterProvider as any)._metricReader;
    if (reader) {
      // Try to manually trigger a collection
      if (typeof reader.collect === 'function') {
        await reader.collect();
      }
      // Also try to force flush the reader
      if (typeof reader.forceFlush === 'function') {
        await reader.forceFlush();
      }
    }
    
    // Also try meter provider forceFlush if supported
    if (typeof state.meterProvider.forceFlush === 'function') {
      await state.meterProvider.forceFlush();
    }
  } catch (error) {
    console.error('[pulsetel-otel] Failed to force flush:', error);
  }
}

/**
 * Shutdown OpenTelemetry and flush all data
 */
export async function shutdownOtel(): Promise<void> {
  if (!state.isInitialized) {
    return;
  }

  try {
    // Flush and shutdown exporters
    if (state.tracesExporter && typeof state.tracesExporter.shutdown === 'function') {
      await state.tracesExporter.shutdown();
    }
    
    if (state.metricsExporter && typeof state.metricsExporter.shutdown === 'function') {
      await state.metricsExporter.shutdown();
    }
    
    if (state.logsExporter && typeof state.logsExporter.shutdown === 'function') {
      await state.logsExporter.shutdown();
    }
    
    // Shutdown providers
    if (state.tracerProvider && typeof state.tracerProvider.shutdown === 'function') {
      await state.tracerProvider.shutdown();
    }
    
    if (state.meterProvider && typeof state.meterProvider.shutdown === 'function') {
      await state.meterProvider.shutdown();
    }

    // Reset state
    state.isInitialized = false;
    otelDepsAvailable = null;
    
  } catch (error) {
    console.error('[pulsetel-otel] Failed to shutdown OpenTelemetry:', error);
  }
}

/**
 * Check if OpenTelemetry is available and enabled
 */
export function isOtelAvailable(): boolean {
  return state.isInitialized;
}