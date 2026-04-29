import type { EndpointMode, ProviderId } from './settings';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;

export interface TransportErrorDiagnostic {
  code?: string;
  message?: string;
  stage?: string;
  provider?: ProviderId;
  endpointMode?: EndpointMode;
  httpStatus?: number | null;
  requestId?: string;
  retryable?: boolean;
  diagnostics?: RunDiagnostics | null;
  [key: string]: unknown;
}

export interface RunDiagnostics {
  runId?: string;
  stage?: string;
  status?: RunStatus;
  provider?: ProviderId;
  adapterId?: string;
  endpointMode?: EndpointMode;
  model?: string;
  transportMode?: 'stream' | 'request' | string;
  attemptCount?: number;
  retryCount?: number;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  httpStatus?: number | null;
  responseContentType?: string;
  requestId?: string;
  preview?: string;
  usage?: unknown;
  lastError?: TransportErrorDiagnostic | null;
}

export interface ComposedDiagnostics {
  runId?: string;
  provider?: ProviderId;
  adapterId?: string;
  endpointMode?: EndpointMode;
  model?: string;
  status?: RunStatus;
  stage?: string;
  chunkRuns?: RunDiagnostics[];
  finalRun?: RunDiagnostics | null;
  error?: TransportErrorDiagnostic | null;
  retryCount?: number;
  durationMs?: number;
  usage?: unknown;
}
