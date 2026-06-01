"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AimuxApi = void 0;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
class AimuxApi {
    baseUrl;
    currentModel;
    auth;
    constructor(auth) {
        this.auth = auth;
        const config = vscode.workspace.getConfiguration('aimux');
        this.baseUrl = config.get('apiUrl', 'https://aimux.id');
        this.currentModel = config.get('model', '');
    }
    setBaseUrl(url) {
        this.baseUrl = url.replace(/\/+$/, '');
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    setCurrentModel(model) {
        this.currentModel = model;
    }
    getCurrentModel() {
        return this.currentModel;
    }
    headers() {
        const h = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        const key = this.auth.getApiKey();
        if (key) {
            h['Authorization'] = `Bearer ${key}`;
        }
        return h;
    }
    request(method, path, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;
            const options = {
                method,
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                headers: this.headers(),
            };
            const req = transport.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(data);
                        }
                    }
                    else {
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
    async fetchModels() {
        const resp = await this.request('GET', '/v1/models');
        return resp.data || [];
    }
    async chatCompletions(messages, options) {
        const body = {
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
        return this.request('POST', '/v1/chat/completions', body);
    }
    async completions(prompt, options) {
        const body = {
            model: options?.model || this.currentModel,
            prompt,
            temperature: options?.temperature ?? 0.2,
            max_tokens: options?.maxTokens ?? 256,
        };
        if (options?.stop) {
            body.stop = options.stop;
        }
        return this.request('POST', '/v1/completions', body);
    }
    async chatStream(messages, onChunk, options) {
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
            const reqOptions = {
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
                    res.on('data', (chunk) => {
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
                            }
                            catch {
                                // Skip malformed chunks
                            }
                        }
                    });
                    res.on('end', () => {
                        resolve();
                    });
                }
                else {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk.toString(); });
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
exports.AimuxApi = AimuxApi;
//# sourceMappingURL=api.js.map