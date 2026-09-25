export interface ToolParameterProperty {
    type: string;
    description: string;
    enum?: string[];
    default?: any;
}

export interface ToolDefinition {
    name: string;
    description: string;
    category?: 'code' | 'web' | 'files' | 'office' | 'custom';
    parameters: {
        type: 'object';
        properties: Record<string, ToolParameterProperty>;
        required?: string[];
    } | any;
    example?: Record<string, any>;
}

export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    instructions: string;
    category?: string;
    recommendedTools?: string[];
    source?: 'file' | 'custom';
}

export type LLMProviderType = 'gemini' | 'openai' | 'openrouter' | 'ollama' | 'gaia' | 'anthropic' | 'custom';

export interface InferenceConfig {
    provider: LLMProviderType;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt: string;
    tools?: ToolDefinition[];
}

export interface PersonalityConfig {
    traits: {
        openness: number;          // 0-1
        conscientiousness: number;
        extraversion: number;
        agreeableness: number;
        neuroticism: number;
    };
    communicationStyle: 'formal' | 'casual' | 'technical' | 'creative';
    workHours: { start: string; end: string };
    breakFrequency: number;      // minutes
}

export interface Capability {
    name: string;
    description: string;
}

export interface MemoryConfig {
    shortTermLimit?: number;
}

export interface AgentConfig {
    id: string;
    name: string;
    role: string;
    avatar: string;              // Sprite sheet reference (e.g., char_0 .. char_5)
    inference: InferenceConfig;
    personality: PersonalityConfig;
    capabilities: Capability[];
    skills?: SkillDefinition[];
    allowedTools?: string[];
    memory: MemoryConfig;
}
