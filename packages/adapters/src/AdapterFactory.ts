import { InferenceAdapter, InferenceConfig, LLMProviderType } from '@agent-office/core';
import { OllamaAdapter } from './OllamaAdapter';
import { OpenAICompatibleAdapter } from './OpenAICompatibleAdapter';

export interface ProviderCredentials {
    geminiApiKey?: string;
    openaiApiKey?: string;
    openrouterApiKey?: string;
    ollamaUrl?: string;
    defaultProvider?: LLMProviderType;
    defaultModel?: string;
}

export const DEFAULT_MODELS: Record<string, string> = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    openrouter: 'google/gemini-2.5-flash',
    ollama: 'llama3.2:latest'
};

export class AdapterFactory {
    private static runtimeCredentials: ProviderCredentials = {};

    static setRuntimeCredentials(creds: Partial<ProviderCredentials>) {
        this.runtimeCredentials = { ...this.runtimeCredentials, ...creds };
    }

    static getRuntimeCredentials(): ProviderCredentials {
        return {
            geminiApiKey: this.runtimeCredentials.geminiApiKey || process.env.GEMINI_API_KEY || '',
            openaiApiKey: this.runtimeCredentials.openaiApiKey || process.env.OPENAI_API_KEY || '',
            openrouterApiKey: this.runtimeCredentials.openrouterApiKey || process.env.OPENROUTER_API_KEY || '',
            ollamaUrl: this.runtimeCredentials.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434',
            defaultProvider: (this.runtimeCredentials.defaultProvider || process.env.DEFAULT_LLM_PROVIDER || 'gemini') as LLMProviderType,
            defaultModel: this.runtimeCredentials.defaultModel || process.env.DEFAULT_LLM_MODEL || ''
        };
    }

    static createForAgent(inference: InferenceConfig): InferenceAdapter {
        const creds = this.getRuntimeCredentials();
        const provider = inference.provider || creds.defaultProvider || 'gemini';

        if (provider === 'gemini') {
            const apiKey = inference.apiKey || creds.geminiApiKey || '';
            const baseUrl = inference.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai';
            return new OpenAICompatibleAdapter(baseUrl, apiKey, 'gemini');
        }

        if (provider === 'openai') {
            const apiKey = inference.apiKey || creds.openaiApiKey || '';
            const baseUrl = inference.baseUrl || 'https://api.openai.com/v1';
            return new OpenAICompatibleAdapter(baseUrl, apiKey, 'openai');
        }

        if (provider === 'openrouter') {
            const apiKey = inference.apiKey || creds.openrouterApiKey || '';
            const baseUrl = inference.baseUrl || 'https://openrouter.ai/api/v1';
            return new OpenAICompatibleAdapter(baseUrl, apiKey, 'openrouter');
        }

        if (provider === 'custom' && inference.baseUrl) {
            return new OpenAICompatibleAdapter(inference.baseUrl, inference.apiKey || '', 'custom');
        }

        return new OllamaAdapter(inference.baseUrl || creds.ollamaUrl || 'http://localhost:11434');
    }
}
