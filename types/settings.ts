export type ProviderId = 'openai' | 'anthropic' | 'legacy' | string;

export type EndpointMode =
  | 'responses'
  | 'chat_completions'
  | 'legacy_completions'
  | 'messages'
  | 'auto'
  | string;

export type ThemePreference = 'system' | 'light' | 'dark' | string;
export type ThemePalette = 'jade' | 'slate' | 'copper' | 'plum' | string;

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
  themePalette?: ThemePalette;
  sidebarCompactMode?: boolean;
  privacyMode?: boolean;
  defaultAllowHistory?: boolean;
  defaultAllowShare?: boolean;
  autoGenerateOnEntrypoint?: boolean;
  entrypointSummaryMode?: SummaryMode;
  preferHistoryOnEntrypoint?: boolean;
}

export interface ProviderProfile {
  routeId?: string;
  label?: string;
  endpointModes?: EndpointMode[];
  baseUrl?: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
  keyHint?: string;
  keyRule?: {
    prefix?: string;
    message?: string;
  } | null;
  requiresApiKey?: boolean;
  supportsStreaming?: boolean;
}

export interface ProviderRoute {
  routeId: string;
  label: string;
  aiProvider: ProviderId;
  baseUrl: string;
  endpointModes: EndpointMode[];
  defaultEndpointMode: EndpointMode;
  defaultModel: string;
  keyHint?: string;
  keyRule?: {
    prefix?: string;
    message?: string;
  };
  isDefault?: boolean;
}

export interface ProviderPreset {
  id: string;
  label: string;
  hint?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  defaultProvider?: ProviderId;
  defaultRouteId?: string;
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
