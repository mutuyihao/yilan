import type { ComposedDiagnostics, RunDiagnostics, TransportErrorDiagnostic } from './diagnostics';
import type { ArticleSnapshot, ReaderSessionSnapshot } from './history';
import type { UserSettings } from './settings';

export interface TestConnectionMessage {
  action: 'testConnection';
  settings: UserSettings;
}

export interface RunPromptMessage {
  action: 'runPrompt';
  runId?: string;
  article?: ArticleSnapshot;
  prompt?: string;
  settings?: UserSettings;
  meta?: Record<string, unknown>;
}

export interface CancelRunMessage {
  action: 'cancelRun';
  runId: string;
}

export interface TriggerHistoryMessage {
  action: 'triggerHistory';
}

export interface GetEntrypointStatusMessage {
  action: 'getEntrypointStatus';
}

export interface OpenShortcutSettingsMessage {
  action: 'openShortcutSettings';
}

export interface OpenReaderTabMessage {
  action: 'openReaderTab';
  snapshot: ReaderSessionSnapshot;
}

export type RuntimeMessage =
  | TestConnectionMessage
  | RunPromptMessage
  | CancelRunMessage
  | TriggerHistoryMessage
  | GetEntrypointStatusMessage
  | OpenShortcutSettingsMessage
  | OpenReaderTabMessage;

export interface StartStreamPortMessage {
  action: 'startStream';
  runId: string;
  article?: ArticleSnapshot;
  prompt?: string;
  settings?: UserSettings;
  meta?: Record<string, unknown>;
}

export type StreamPortMessage = StartStreamPortMessage | CancelRunMessage;

export type StreamPortResponse =
  | { type: 'started'; runId: string; diagnostics?: Partial<RunDiagnostics> }
  | { type: 'token'; runId: string; token: string }
  | { type: 'retry'; runId: string; retry: unknown }
  | { type: 'done'; runId: string; text: string; usage?: unknown; diagnostics?: ComposedDiagnostics | RunDiagnostics | null }
  | { type: 'error' | 'cancelled'; runId: string; error?: TransportErrorDiagnostic | null; diagnostics?: ComposedDiagnostics | RunDiagnostics | null }
  | { type: 'cancelAck'; runId: string; success: boolean };

export type SidebarFrameMessage =
  | { type: 'articleData'; article: ArticleSnapshot; source?: 'navigation' | string }
  | { type: 'historyData' }
  | { type: 'closeSidebar' };
