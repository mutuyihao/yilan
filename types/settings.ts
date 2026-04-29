export type ProviderId = 'openai' | 'anthropic' | 'legacy' | string;

export type EndpointMode =
  | 'responses'
  | 'chat_completions'
  | 'legacy_completions'
  | 'messages'
  | 'auto'
  | string;

export type ThemePreference = 'system' | 'light' | 'dark' | string;

export type SummaryMode = 'brief' | 'medium' | 'detailed' | 'action_items' | 'glossary' | 'qa' | string;

export interface UserSettings {
  apiKey?: string;
  providerPreset?: string;
  aiProvider?: ProviderId;
  endpointMode?: EndpointMode;
  baseURL?: string;
  modelName?: string;
  extraSystemPrompt?: string;
  targetLanguage?: string;
  summaryMode?: SummaryMode;
  autoTranslate?: boolean;
  themePreference?: ThemePreference;
  privacyMode?: boolean;
  defaultAllowHistory?: boolean;
  defaultAllowShare?: boolean;
  autoGenerateOnEntrypoint?: boolean;
  entrypointSummaryMode?: SummaryMode;
  preferHistoryOnEntrypoint?: boolean;
}

export interface ProviderProfile {
  endpointModes?: EndpointMode[];
  defaultBaseUrl?: string;
  defaultModel?: string;
  requiresApiKey?: boolean;
  supportsStreaming?: boolean;
}

export interface ProviderPreset {
  id: string;
  label: string;
  providerProfiles: Record<string, ProviderProfile>;
}

export interface RuntimeAdapterSnapshot {
  provider: ProviderId;
  adapterId: string;
  endpointMode: EndpointMode;
  model: string;
  baseUrl: string;
  displayName?: string;
  credentialRef?: string;
  inputFormat?: string;
}
