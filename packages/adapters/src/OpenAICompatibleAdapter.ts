import { InferenceAdapter, CompletionRequest, CompletionResponse } from '@agent-office/core';

export class OpenAICompatibleAdapter implements InferenceAdapter {
    public readonly isLocal = false;

    constructor(
        private baseUrl: string,
        private apiKey: string,
        public readonly provider: string = 'openai'
    ) { }

    private resolveEndpoint(): string {
        const clean = this.baseUrl.replace(/\/+$/, '');
        if (clean.endsWith('/chat/completions')) return clean;
        if (clean.endsWith('/v1') || clean.endsWith('/openai')) {
            return `${clean}/chat/completions`;
        }
        return `${clean}/v1/chat/completions`;
    }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const start = Date.now();

        const tools = request.tools && request.tools.length > 0 ? request.tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }
        })) : undefined;

        const endpoint = this.resolveEndpoint();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const bodyPayload: Record<string, any> = {
            model: request.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.7
        };
        if (tools) {
            bodyPayload.tools = tools;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyPayload)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            throw new Error(`${this.provider.toUpperCase()} API Error (${response.status}): ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        const latency = Date.now() - start;
        const message = data.choices?.[0]?.message || {};

        let toolCalls;
        if (message.tool_calls) {
            toolCalls = message.tool_calls.map((tc: any) => {
                let parsedArgs = {};
                try {
                    parsedArgs = typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : (tc.function.arguments || {});
                } catch {
                    parsedArgs = {};
                }
                return {
                    name: tc.function.name,
                    params: parsedArgs
                };
            });
        }

        return {
            content: message.content || '',
            toolCalls,
            usage: {
                prompt: data.usage?.prompt_tokens || 0,
                completion: data.usage?.completion_tokens || 0
            },
            latency
        };
    }
}
