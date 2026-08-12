// Declaraciones ambiente MÍNIMAS para la API nativa de resumen del navegador
// (Summarizer API / Gemini Nano on-device, Chrome). Estos globales aún no están
// en las libs de TypeScript, por lo que sin este archivo `tsc` falla con
// "Cannot find name 'Summarizer'". Solo declaramos la superficie que usamos.
//
// Referencia: https://developer.chrome.com/docs/ai/summarizer-api

/** Evento de progreso de descarga del modelo on-device. */
interface SummarizerDownloadProgressEvent extends Event {
  readonly loaded: number; // 0..1
}

/**
 * Monitor de creación: permite suscribirse al progreso de descarga del modelo.
 * Es un EventTarget; solo tipamos el evento 'downloadprogress' que consumimos.
 */
interface SummarizerCreateMonitor extends EventTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: SummarizerDownloadProgressEvent) => void,
  ): void;
}

interface SummarizerCreateOptions {
  type?: 'key-points' | 'tldr' | 'teaser' | 'headline';
  format?: 'markdown' | 'plain-text';
  length?: 'short' | 'medium' | 'long';
  sharedContext?: string;
  expectedInputLanguages?: string[];
  expectedContextLanguages?: string[];
  outputLanguage?: string;
  monitor?: (m: SummarizerCreateMonitor) => void;
}

interface SummarizerSummarizeOptions {
  context?: string;
}

interface SummarizerInstance {
  summarize(input: string, options?: SummarizerSummarizeOptions): Promise<string>;
  destroy(): void;
}

type SummarizerAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

interface SummarizerStatic {
  availability(): Promise<SummarizerAvailability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
}

// El global puede no existir en tiempo de ejecución (navegadores sin la API).
// Se declara para que compile; en runtime SIEMPRE se verifica con
// `typeof Summarizer === 'undefined'` antes de usarlo (typeof no lanza aunque
// el identificador no exista).
declare const Summarizer: SummarizerStatic | undefined;

// ---------------------------------------------------------------------------
// Prompt API (LanguageModel) — mismo modelo Gemini Nano on-device, pero acepta
// un prompt con tono (resumen más humano). También ausente en las libs de TS.
// Referencia: https://developer.chrome.com/docs/ai/prompt-api
// ---------------------------------------------------------------------------

/** Mensaje inicial del contexto de la sesión (system / user / assistant). */
interface LanguageModelInitialPrompt {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Expectativa de idiomas por tipo de entrada/salida. */
interface LanguageModelExpected {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelInitialPrompt[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  temperature?: number;
  topK?: number;
  monitor?: (m: SummarizerCreateMonitor) => void;
  signal?: AbortSignal;
}

/** Opciones de prompt (streaming / salida estructurada). */
interface LanguageModelPromptOptions {
  responseConstraint?: Record<string, unknown>;
  omitResponseConstraintInput?: boolean;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(
    input: string | LanguageModelInitialPrompt[],
    options?: LanguageModelPromptOptions,
  ): Promise<string>;
  /** Streaming: ReadableStream o AsyncIterable según versión de Chrome. */
  promptStreaming?(
    input: string | LanguageModelInitialPrompt[],
    options?: LanguageModelPromptOptions,
  ): ReadableStream<string> | AsyncIterable<string>;
  destroy(): void;
  readonly contextUsage?: number;
  readonly contextWindow?: number;
}

interface LanguageModelStatic {
  availability(options?: {
    expectedInputs?: LanguageModelExpected[];
    expectedOutputs?: LanguageModelExpected[];
  }): Promise<SummarizerAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

// Igual que Summarizer: puede no existir en runtime; verificar SIEMPRE con
// `typeof LanguageModel === 'undefined'` antes de usarlo.
declare const LanguageModel: LanguageModelStatic | undefined;
