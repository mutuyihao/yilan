declare const chrome: any;
declare const importScripts: (...urls: string[]) => void;
declare const require: any;
declare const module: any;
declare const process: any;
declare const __dirname: string;
declare const Buffer: any;
declare const Readability: any;
declare const DOMPurify: any;
declare const marked: any;
declare const hljs: any;
declare const html2canvas: any;

interface Window {
  __aiSummaryInjected?: boolean;
  chrome: any;
  AISummaryArticle: any;
  AISummaryTrust: any;
  AISummaryAbortUtils: any;
  AISummaryDiagnosticsView: any;
  AISummaryDomain: any;
  AISummaryErrors: any;
  AISummaryHistoryView: any;
  AISummaryPageStrategy: any;
  AISummaryProviderPresets: any;
  AISummaryReaderView: any;
  AISummaryRunUtils: any;
  AISummarySidebarHistory: any;
  AISummarySidebarMetaView: any;
  AISummaryStrings: any;
  AISummarySummaryText: any;
  AISummaryTheme: any;
  AISummaryTransportUtils: any;
  AISummaryTrustPolicy: any;
  AISummaryUiFormat: any;
  AISummaryUiLabels: any;
  AISummaryOpenAIAdapter: any;
  AISummaryAnthropicAdapter: any;
  AISummaryAdapterRegistry: any;
  YilanEntrypoints: any;
  YilanRunState: any;
  YilanReaderSessions: any;
  YilanSidebarHistory: any;
  YilanSidebar: any;
  db: any;
  marked: any;
  DOMPurify: any;
  hljs: any;
  html2canvas: any;
}

interface History {
  __aiSummaryNavigationBound?: boolean;
}

interface Error {
  reason?: unknown;
}

interface Element {
  checked: boolean;
  dataset: DOMStringMap;
  disabled: boolean;
  focus: () => void;
  hidden: boolean;
  tabIndex: number;
  value: string;
}

interface HTMLElement {
  checked: boolean;
  contentWindow: Window | null;
  disabled: boolean;
  download: string;
  href: string;
  open: boolean;
  options: any;
  placeholder: string;
  selectedIndex: number;
  src: string;
  value: string;
}

interface EventTarget {
  checked: boolean;
  closest: (selector: string) => Element | null;
  dataset: DOMStringMap;
  disabled: boolean;
  result: any;
  transaction: any;
  value: string;
}

interface Node {
  contains(other: Node | EventTarget): boolean;
}

declare namespace NodeJS {
  interface Global {
    window: any;
  }
}
