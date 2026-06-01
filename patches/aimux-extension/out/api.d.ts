import { AimuxAuth } from './auth';
export interface AimuxModel {
    id: string;
    object: string;
    created?: number;
    owned_by?: string;
}
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ChatCompletionChoice {
    index: number;
    message: {
        role: string;
        content: string;
    };
    finish_reason: string | null;
}
export interface ChatCompletionResponse {
    id: string;
    object: string;
    choices: ChatCompletionChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export interface CompletionChoice {
    text: string;
    index: number;
    finish_reason: string | null;
}
export interface CompletionResponse {
    id: string;
    object: string;
    choices: CompletionChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare class AimuxApi {
    private baseUrl;
    private currentModel;
    private auth;
    constructor(auth: AimuxAuth);
    setBaseUrl(url: string): void;
    getBaseUrl(): string;
    setCurrentModel(model: string): void;
    getCurrentModel(): string;
    private headers;
    private request;
    fetchModels(): Promise<AimuxModel[]>;
    chatCompletions(messages: ChatMessage[], options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
        signal?: AbortSignal;
    }): Promise<ChatCompletionResponse>;
    completions(prompt: string, options?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
        stop?: string[];
    }): Promise<CompletionResponse>;
    chatStream(messages: ChatMessage[], onChunk: (chunk: string) => void, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        signal?: AbortSignal;
    }): Promise<void>;
}
//# sourceMappingURL=api.d.ts.map