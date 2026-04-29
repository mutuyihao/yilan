import type { ComposedDiagnostics } from './diagnostics';
import type { EndpointMode, ProviderId, SummaryMode } from './settings';

export interface SourceStrategy {
  id?: string;
  label?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface ArticleChunk {
  index: number;
  text: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ArticleSnapshot {
  articleId?: string;
  sourceUrl: string;
  normalizedUrl?: string;
  canonicalUrl?: string;
  sourceHost?: string;
  siteName?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  rawText?: string;
  cleanText?: string;
  content?: string;
  contentHash?: string;
  contentLength?: number;
  extractor?: string;
  isTruncated?: boolean;
  sourceType?: string;
  sourceStrategyId?: string;
  sourceStrategy?: SourceStrategy;
  preferredSummaryMode?: SummaryMode;
  chunkingStrategy?: string;
  chunkCount?: number;
  chunks?: ArticleChunk[];
  warnings?: string[];
  qualityScore?: number;
  allowHistory?: boolean;
  allowShare?: boolean;
  retentionHint?: 'persistent' | 'session_only' | 'none' | string;
  diagnostics?: unknown;
}

export interface SummaryRecord {
  recordId: string;
  articleId: string;
  parentRecordId: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string;
  normalizedUrl: string;
  sourceHost: string;
  titleSnapshot: string;
  languageSnapshot: string;
  contentHash: string;
  articleSnapshotRef: string;
  articleSnapshot: ArticleSnapshot | null;
  summaryMode: SummaryMode;
  targetLanguage: string;
  promptProfile: string;
  customPromptUsed: boolean;
  promptVersion: string;
  adapterId: string;
  provider: ProviderId;
  model: string;
  endpointMode: EndpointMode;
  requestOptionsSnapshot: unknown;
  privacyMode: boolean;
  allowHistory: boolean;
  allowShare: boolean;
  retentionHint: string;
  status: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  retryCount: number;
  errorCode: string;
  errorMessage: string;
  finishReason: string;
  summaryMarkdown: string;
  summaryPlainText: string;
  summaryTitle: string;
  bullets: string[];
  usage: unknown;
  shareCardTitle: string;
  shareCardSubtitle: string;
  shareSourceUrl: string;
  exportVariants: string[];
  pinned: boolean;
  favorite: boolean;
  tags: string[];
  notes: string;
  lastViewedAt: string;
  diagnostics: ComposedDiagnostics | null;
  originSummaryHash: string;
  dedupeKey: string;
}

export interface ReaderSessionSnapshot {
  sessionId?: string;
  recordId?: string;
  sourceUrl?: string;
  normalizedUrl?: string;
  sourceHost?: string;
  title?: string;
  summaryMarkdown?: string;
  provider?: ProviderId;
  providerLabel?: string;
  allowHistory?: boolean;
  allowShare?: boolean;
  createdAt?: string;
  expiresAt?: string;
  diagnostics?: ComposedDiagnostics | null;
}
