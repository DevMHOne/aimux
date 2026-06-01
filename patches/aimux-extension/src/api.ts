import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
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

export class AimuxApi {
    private baseUrl: string;
    private currentModel: string;
    private auth: AimuxAuth;

    constructor(auth: AimuxAuth) {
        this.auth = auth;
        const config = vscode.workspace.getConfiguration('aimux');
        this.baseUrl = config.get<string>('apiUrl', 'https://aimux.id');
        this.currentModel = config.get<string>('model', '');
    }

    setBaseUrl(url: string): void {
        this.baseUrl = url.replace(/\/+$/, '');
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    setCurrentModel(model: string): void {
        this.currentModel = model;
    }

    getCurrentModel(): string {
        return this.currentModel;
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        const key = this.auth.getApiKey();
        if (key) {
            h['Authorization'] = `Bearer ${key}`;
        }
        return h;
    }

    private request<T>(method: string, path: string, body?: any): Promise<T> {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const options: http.RequestOptions = {
                method,
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                headers: this.headers(),
            };

            const req = transport.request(options, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data) as T);
                        } catch {
                            resolve(data as any);
                        }
                    } else {
                        const msg = data.length > 200 ? data.substring(0, 200) + '...' : data;
                        reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    async fetchModels(): Promise<AimuxModel[]> {
        const resp = await this.request<{ data: AimuxModel[] }>('GET', '/v1/models');
        return resp.data || [];
    }

    async chatCompletions(
        messages: ChatMessage[],
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            stream?: boolean;
            signal?: AbortSignal;
        }
    ): Promise<ChatCompletionResponse> {
        const body: Record<string, any> = {
            model: options?.model || this.currentModel,
            messages,
            temperature: options?.temperature ?? 0.7,
        };

        if (options?.maxTokens) {
            body.max_tokens = options.maxTokens;
        }

        if (options?.stream) {
            body.stream = true;
        }

        if (options?.signal?.aborted) {
            throw new Error('Request aborted');
        }

        return this.request<ChatCompletionResponse>('POST', '/v1/chat/completions', body);
    }

    async completions(
        prompt: string,
        options?: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
            stop?: string[];
        }
    ): Promise<CompletionResponse> {
        const body: Record<string, any> = {
            model: options?.model || this.currentModel,
            prompt,
            temperature: options?.temperature ?? 0.2,
            max_tokens: options?.maxTokens ?? 256,
        };

        if (options?.stop) {
            body.stop = options.stop;
        }

        return this.request<CompletionResponse>('POST', '/v1/completions', body);
    }

    async chatStream(
        messages: ChatMessage[],
        onChunk: (chunk: string) => void,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            signal?: AbortSignal;
        }
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL('/v1/chat/completions', this.baseUrl);
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const body = JSON.stringify({
                model: options?.model || this.currentModel,
                messages,
                temperature: options?.temperature ?? 0.7,
                stream: true,
                ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
            });

            const reqOptions: http.RequestOptions = {
                method: 'POST',
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                headers: {
                    ...this.headers(),
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            let aborted = false;

            if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                    aborted = true;
                    req.destroy();
                    reject(new Error('Request aborted'));
                });
            }

            const req = transport.request(reqOptions, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    let buffer = '';

                    res.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();

                        // Process complete SSE lines
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data: ')) {
                                continue;
                            }

                            const data = trimmed.slice(6);
                            if (data === '[DONE]') {
                                resolve();
                                return;
                            }

                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    onChunk(content);
                                }
                            } catch {
                                // Skip malformed chunks
                            }
                        }
                    });

                    res.on('end', () => {
                        resolve();
                    });
                } else {
                    let data = '';
                    res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                    res.on('end', () => {
                        reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    });
                }
            });

            req.on('error', (err) => {
                if (!aborted) {
                    reject(err);
                }
            });

            req.setTimeout(120000, () => {
                req.destroy();
                if (!aborted) {
                    reject(new Error('Streaming request timed out'));
                }
            });

            req.write(body);
            req.end();
        });
    }
}
