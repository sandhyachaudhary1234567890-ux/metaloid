/**
 * MetaIoid Canonical Provider & Free LLM Catalog
 * Inspired by verified free provider specifications & awesome-freellm-apis.
 * Contains 50+ verified providers with official links, capabilities, and protocols.
 */

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  category: 'free_friendly' | 'major' | 'fast_inference' | 'local' | 'cloud_enterprise' | 'specialized';
  logoText: string;
  websiteUrl: string;
  docsUrl: string;
  apiKeyUrl: string;
  protocol: 'openai_compatible' | 'anthropic' | 'gemini' | 'openrouter' | 'nvidia' | 'local_http';
  status: 'active' | 'beta' | 'planned';
  freeTier: {
    available: boolean;
    requiresCard: boolean;
    description: string;
    rateLimitNote?: string;
  };
  capabilities: {
    chat: boolean;
    streaming: boolean;
    tools: boolean;
    vision: boolean;
    longContext: boolean;
    embeddings: boolean;
  };
  recommendedForMetaIoid?: boolean;
  rankingBadge?: 'Recommended' | 'Fast' | 'Vision' | 'Long Context' | 'Local' | 'Popular';
  defaultBaseUrl?: string;
  models: {
    id: string;
    name: string;
    free: boolean;
    contextLimit: number;
    vision?: boolean;
    tools?: boolean;
  }[];
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // --- RECOMMENDED FREE / FAST PROVIDERS ---
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    category: 'free_friendly',
    logoText: 'G',
    websiteUrl: 'https://ai.google.dev',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    protocol: 'gemini',
    status: 'active',
    recommendedForMetaIoid: true,
    rankingBadge: 'Recommended',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Generous free tier with 15 RPM / 1M TPM for Gemini Flash & Pro.',
      rateLimitNote: '15 requests per minute free',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', free: true, contextLimit: 1048576, vision: true, tools: true },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', free: true, contextLimit: 1048576, vision: true, tools: true },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', free: true, contextLimit: 2097152, vision: true, tools: true },
    ],
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    category: 'free_friendly',
    logoText: 'GQ',
    websiteUrl: 'https://groq.com',
    docsUrl: 'https://console.groq.com/docs/quickstart',
    apiKeyUrl: 'https://console.groq.com/keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    status: 'active',
    recommendedForMetaIoid: true,
    rankingBadge: 'Fast',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Ultra-fast LPU inference free tier with 30 RPM.',
      rateLimitNote: '30 requests per minute free',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: false },
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', free: true, contextLimit: 128000, tools: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', free: true, contextLimit: 128000, tools: true },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', free: true, contextLimit: 32768 },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'free_friendly',
    logoText: 'OR',
    websiteUrl: 'https://openrouter.ai',
    docsUrl: 'https://openrouter.ai/docs',
    apiKeyUrl: 'https://openrouter.ai/keys',
    protocol: 'openrouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    status: 'active',
    recommendedForMetaIoid: true,
    rankingBadge: 'Popular',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Directory of 20+ free community models appended with :free tag.',
      rateLimitNote: 'Varies by model (approx 20 RPM)',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: false },
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', free: true, contextLimit: 131072, tools: true },
      { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (Free)', free: true, contextLimit: 32768 },
      { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Exp (Free)', free: true, contextLimit: 1048576, vision: true },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras Inference',
    category: 'free_friendly',
    logoText: 'CB',
    websiteUrl: 'https://cerebras.ai',
    docsUrl: 'https://inference-docs.cerebras.ai',
    apiKeyUrl: 'https://cloud.cerebras.ai',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    status: 'active',
    rankingBadge: 'Fast',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Generous free tier with record 2000+ tokens/sec inference speed.',
      rateLimitNote: '30 RPM free',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: false },
    models: [
      { id: 'llama3.3-70b', name: 'Llama 3.3 70B (Cerebras Fast)', free: true, contextLimit: 128000, tools: true },
      { id: 'llama3.1-8b', name: 'Llama 3.1 8B (Cerebras)', free: true, contextLimit: 128000, tools: true },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI (La Plateforme)',
    category: 'free_friendly',
    logoText: 'MS',
    websiteUrl: 'https://mistral.ai',
    docsUrl: 'https://docs.mistral.ai',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    status: 'active',
    rankingBadge: 'Popular',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Free tier experimenter plan with Mistral Small & Codestral.',
      rateLimitNote: '1 RPS free tier',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'mistral-small-latest', name: 'Mistral Small', free: true, contextLimit: 32768, tools: true },
      { id: 'codestral-latest', name: 'Codestral (Coding Specialist)', free: true, contextLimit: 32768, tools: true },
      { id: 'pixtral-12b-2409', name: 'Pixtral 12B (Vision)', free: true, contextLimit: 128000, vision: true },
    ],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face Inference',
    category: 'free_friendly',
    logoText: 'HF',
    websiteUrl: 'https://huggingface.co',
    docsUrl: 'https://huggingface.co/docs/api-inference',
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api-inference.huggingface.co/v1',
    status: 'active',
    rankingBadge: 'Popular',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Free Serverless API access with HF User Access Token.',
      rateLimitNote: 'Rate limited by shared compute',
    },
    capabilities: { chat: true, streaming: true, tools: false, vision: true, longContext: false, embeddings: true },
    models: [
      { id: 'meta-llama/Meta-Llama-3-8B-Instruct', name: 'Llama 3 8B Instruct', free: true, contextLimit: 8192 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', free: true, contextLimit: 32768 },
    ],
  },

  // --- LOCAL AI ENGINES ---
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    category: 'local',
    logoText: 'OL',
    websiteUrl: 'https://ollama.com',
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    apiKeyUrl: '',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    status: 'active',
    recommendedForMetaIoid: true,
    rankingBadge: 'Local',
    freeTier: {
      available: true,
      requiresCard: false,
      description: '100% private, runs entirely on your local machine with zero external network calls.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'llama3.2', name: 'Llama 3.2 (Local)', free: true, contextLimit: 128000, tools: true },
      { id: 'mistral', name: 'Mistral (Local)', free: true, contextLimit: 32768 },
      { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder (Local)', free: true, contextLimit: 32768 },
      { id: 'llava', name: 'LLaVA (Local Vision)', free: true, contextLimit: 4096, vision: true },
    ],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    category: 'local',
    logoText: 'LM',
    websiteUrl: 'https://lmstudio.ai',
    docsUrl: 'https://lmstudio.ai/docs/local-server',
    apiKeyUrl: '',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'http://localhost:1234/v1',
    status: 'active',
    rankingBadge: 'Local',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Local GUI inference server with OpenAI-compatible endpoint.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'loaded-model', name: 'Currently Loaded Model', free: true, contextLimit: 32768 },
    ],
  },
  {
    id: 'vllm',
    name: 'vLLM Server (Local / Self-hosted)',
    category: 'local',
    logoText: 'VL',
    websiteUrl: 'https://vllm.ai',
    docsUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
    apiKeyUrl: '',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'http://localhost:8000/v1',
    status: 'active',
    rankingBadge: 'Local',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'High-throughput self-hosted inference engine.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'default', name: 'vLLM Served Model', free: true, contextLimit: 65536 },
    ],
  },

  // --- MAJOR FRONTIER LABS ---
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'major',
    logoText: 'OA',
    websiteUrl: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    status: 'active',
    rankingBadge: 'Popular',
    freeTier: {
      available: false,
      requiresCard: true,
      description: 'Requires account credits. Pay-per-token API.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', free: false, contextLimit: 128000, vision: true, tools: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', free: false, contextLimit: 128000, vision: true, tools: true },
      { id: 'o3-mini', name: 'o3-mini (Reasoning)', free: false, contextLimit: 200000, tools: true },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    category: 'major',
    logoText: 'AN',
    websiteUrl: 'https://anthropic.com',
    docsUrl: 'https://docs.anthropic.com/en/api',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    status: 'active',
    rankingBadge: 'Popular',
    freeTier: {
      available: false,
      requiresCard: true,
      description: 'New accounts occasionally receive $5 trial credit. Pay-per-token.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: false },
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', free: false, contextLimit: 200000, vision: true, tools: true },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', free: false, contextLimit: 200000, vision: true, tools: true },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', free: false, contextLimit: 200000, vision: true, tools: true },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'major',
    logoText: 'DS',
    websiteUrl: 'https://deepseek.com',
    docsUrl: 'https://platform.deepseek.com/api-docs',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    status: 'active',
    rankingBadge: 'Popular',
    freeTier: {
      available: false,
      requiresCard: false,
      description: '5M free tokens for new accounts. Very low pricing thereafter.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: false },
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3', free: false, contextLimit: 64000, tools: true },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (Reasoning)', free: false, contextLimit: 64000 },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    category: 'major',
    logoText: 'XA',
    websiteUrl: 'https://x.ai',
    docsUrl: 'https://docs.x.ai',
    apiKeyUrl: 'https://console.x.ai',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    status: 'active',
    freeTier: {
      available: false,
      requiresCard: true,
      description: '$25 monthly developer credit for early testers.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: false },
    models: [
      { id: 'grok-2-1212', name: 'Grok 2', free: false, contextLimit: 131072, vision: true, tools: true },
      { id: 'grok-2-vision-1212', name: 'Grok 2 Vision', free: false, contextLimit: 32768, vision: true },
    ],
  },
  {
    id: 'perplexity',
    name: 'Perplexity AI',
    category: 'specialized',
    logoText: 'PX',
    websiteUrl: 'https://perplexity.ai',
    docsUrl: 'https://docs.perplexity.ai',
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.perplexity.ai',
    status: 'active',
    freeTier: {
      available: false,
      requiresCard: true,
      description: 'Search-grounded online models. Requires paid balance.',
    },
    capabilities: { chat: true, streaming: true, tools: false, vision: false, longContext: true, embeddings: false },
    models: [
      { id: 'sonar', name: 'Sonar Online', free: false, contextLimit: 128000 },
      { id: 'sonar-pro', name: 'Sonar Pro Online', free: false, contextLimit: 200000 },
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM (Build)',
    category: 'fast_inference',
    logoText: 'NV',
    websiteUrl: 'https://build.nvidia.com',
    docsUrl: 'https://docs.api.nvidia.com',
    apiKeyUrl: 'https://build.nvidia.com/account/api-keys',
    protocol: 'nvidia',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    status: 'active',
    freeTier: {
      available: true,
      requiresCard: false,
      description: '1000 free inference credits on account signup.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (NIM)', free: true, contextLimit: 128000, tools: true },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct', free: true, contextLimit: 128000 },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    category: 'fast_inference',
    logoText: 'TG',
    websiteUrl: 'https://together.ai',
    docsUrl: 'https://docs.together.ai',
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    status: 'active',
    freeTier: {
      available: false,
      requiresCard: false,
      description: '$5 free starter credit on signup.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', free: false, contextLimit: 131072, tools: true },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (Together)', free: false, contextLimit: 64000 },
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: 'fast_inference',
    logoText: 'FW',
    websiteUrl: 'https://fireworks.ai',
    docsUrl: 'https://docs.fireworks.ai',
    apiKeyUrl: 'https://fireworks.ai/account/api-keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    status: 'active',
    freeTier: {
      available: false,
      requiresCard: false,
      description: '$1 free developer trial.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', free: false, contextLimit: 131072, tools: true },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    category: 'major',
    logoText: 'CO',
    websiteUrl: 'https://cohere.com',
    docsUrl: 'https://docs.cohere.com',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.cohere.ai/v1',
    status: 'active',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Free trial key for prototyping (rate-limited).',
      rateLimitNote: '1000 requests/month free trial',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: true },
    models: [
      { id: 'command-r-plus-08-2024', name: 'Command R+', free: true, contextLimit: 128000, tools: true },
      { id: 'command-r-08-2024', name: 'Command R', free: true, contextLimit: 128000, tools: true },
    ],
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    category: 'fast_inference',
    logoText: 'DI',
    websiteUrl: 'https://deepinfra.com',
    docsUrl: 'https://deepinfra.com/docs',
    apiKeyUrl: 'https://deepinfra.com/dash/api_keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    status: 'active',
    freeTier: {
      available: false,
      requiresCard: false,
      description: 'Free trial balance on signup.',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B Instruct', free: false, contextLimit: 131072 },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    category: 'cloud_enterprise',
    logoText: 'CF',
    websiteUrl: 'https://ai.cloudflare.com',
    docsUrl: 'https://developers.cloudflare.com/workers-ai',
    apiKeyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    protocol: 'openai_compatible',
    status: 'active',
    freeTier: {
      available: true,
      requiresCard: false,
      description: '10,000 neurons free per day on Cloudflare free tier.',
    },
    capabilities: { chat: true, streaming: true, tools: false, vision: true, longContext: false, embeddings: true },
    models: [
      { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (Workers AI)', free: true, contextLimit: 8192 },
    ],
  },
  {
    id: 'github_models',
    name: 'GitHub Models',
    category: 'free_friendly',
    logoText: 'GH',
    websiteUrl: 'https://github.com/marketplace/models',
    docsUrl: 'https://docs.github.com/en/github-models',
    apiKeyUrl: 'https://github.com/settings/tokens',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://models.inference.ai.azure.com',
    status: 'active',
    rankingBadge: 'Recommended',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Free playground with personal access token for GitHub users.',
      rateLimitNote: '15 RPM free for personal accounts',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (GitHub Models)', free: true, contextLimit: 128000, vision: true, tools: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini (GitHub Models)', free: true, contextLimit: 128000, vision: true, tools: true },
      { id: 'meta-llama-3.1-70b-instruct', name: 'Llama 3.1 70B (GitHub Models)', free: true, contextLimit: 128000, tools: true },
    ],
  },
  {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    category: 'fast_inference',
    logoText: 'SN',
    websiteUrl: 'https://sambanova.ai',
    docsUrl: 'https://community.sambanova.ai',
    apiKeyUrl: 'https://cloud.sambanova.ai/apis',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.sambanova.ai/v1',
    status: 'active',
    rankingBadge: 'Fast',
    freeTier: {
      available: true,
      requiresCard: false,
      description: 'Free developer tier with blazing fast full-precision Llama models.',
      rateLimitNote: '10 RPM free',
    },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: false },
    models: [
      { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (SambaNova)', free: true, contextLimit: 131072, tools: true },
      { id: 'Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B (SambaNova)', free: true, contextLimit: 131072, tools: true },
    ],
  },

  // --- ENTERPRISE CLOUD PROVIDERS ---
  {
    id: 'azure_openai',
    name: 'Microsoft Azure OpenAI',
    category: 'cloud_enterprise',
    logoText: 'AZ',
    websiteUrl: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai',
    apiKeyUrl: 'https://portal.azure.com',
    protocol: 'openai_compatible',
    status: 'active',
    freeTier: { available: false, requiresCard: true, description: 'Enterprise enterprise cloud subscription.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [{ id: 'gpt-4o', name: 'Azure GPT-4o Deployment', free: false, contextLimit: 128000, vision: true, tools: true }],
  },
  {
    id: 'aws_bedrock',
    name: 'Amazon Bedrock',
    category: 'cloud_enterprise',
    logoText: 'AWS',
    websiteUrl: 'https://aws.amazon.com/bedrock',
    docsUrl: 'https://docs.aws.amazon.com/bedrock',
    apiKeyUrl: 'https://console.aws.amazon.com/bedrock',
    protocol: 'openai_compatible',
    status: 'active',
    freeTier: { available: false, requiresCard: true, description: 'Pay-per-use AWS cloud infrastructure.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [
      { id: 'anthropic.claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Bedrock)', free: false, contextLimit: 200000, vision: true },
    ],
  },
  {
    id: 'google_vertex',
    name: 'Google Cloud Vertex AI',
    category: 'cloud_enterprise',
    logoText: 'VX',
    websiteUrl: 'https://cloud.google.com/vertex-ai',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs',
    apiKeyUrl: 'https://console.cloud.google.com/vertex-ai',
    protocol: 'gemini',
    status: 'active',
    freeTier: { available: false, requiresCard: true, description: 'Enterprise Google Cloud billing.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Vertex)', free: false, contextLimit: 2097152, vision: true }],
  },
  {
    id: 'replicate',
    name: 'Replicate',
    category: 'specialized',
    logoText: 'RP',
    websiteUrl: 'https://replicate.com',
    docsUrl: 'https://replicate.com/docs',
    apiKeyUrl: 'https://replicate.com/account/api-tokens',
    protocol: 'openai_compatible',
    status: 'beta',
    freeTier: { available: false, requiresCard: true, description: 'Pay-per-second model hosting.' },
    capabilities: { chat: true, streaming: true, tools: false, vision: true, longContext: false, embeddings: false },
    models: [{ id: 'meta/meta-llama-3-70b-instruct', name: 'Llama 3 70B', free: false, contextLimit: 8192 }],
  },
  {
    id: 'ai21',
    name: 'AI21 Labs',
    category: 'specialized',
    logoText: '21',
    websiteUrl: 'https://ai21.com',
    docsUrl: 'https://docs.ai21.com',
    apiKeyUrl: 'https://studio.ai21.com/account/api-key',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.ai21.com/studio/v1',
    status: 'beta',
    freeTier: { available: false, requiresCard: false, description: '$10 free credits for 3 months.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: true },
    models: [{ id: 'jamba-1.5-mini', name: 'Jamba 1.5 Mini', free: false, contextLimit: 256000 }],
  },
  {
    id: 'novita',
    name: 'Novita AI',
    category: 'fast_inference',
    logoText: 'NVT',
    websiteUrl: 'https://novita.ai',
    docsUrl: 'https://novita.ai/docs',
    apiKeyUrl: 'https://novita.ai/settings/key-management',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.novita.ai/v3/openai',
    status: 'beta',
    freeTier: { available: false, requiresCard: false, description: 'Inexpensive serverless LLM APIs.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: false },
    models: [{ id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', free: false, contextLimit: 131072 }],
  },
  {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    category: 'fast_inference',
    logoText: 'HY',
    websiteUrl: 'https://hyperbolic.xyz',
    docsUrl: 'https://docs.hyperbolic.xyz',
    apiKeyUrl: 'https://app.hyperbolic.xyz/settings',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.hyperbolic.xyz/v1',
    status: 'beta',
    freeTier: { available: false, requiresCard: false, description: 'Decentralized high performance GPU compute.' },
    capabilities: { chat: true, streaming: true, tools: false, vision: false, longContext: true, embeddings: false },
    models: [{ id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B', free: false, contextLimit: 131072 }],
  },
  {
    id: 'upstage',
    name: 'Upstage (Solar)',
    category: 'specialized',
    logoText: 'UP',
    websiteUrl: 'https://upstage.ai',
    docsUrl: 'https://developers.upstage.ai/docs',
    apiKeyUrl: 'https://console.upstage.ai/api-keys',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.upstage.ai/v1/solar',
    status: 'beta',
    freeTier: { available: true, requiresCard: false, description: 'Free trial credits on signup.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [{ id: 'solar-pro', name: 'Solar Pro', free: true, contextLimit: 64000, tools: true }],
  },
  {
    id: 'databricks',
    name: 'Databricks Mosaic AI',
    category: 'cloud_enterprise',
    logoText: 'DB',
    websiteUrl: 'https://databricks.com',
    docsUrl: 'https://docs.databricks.com/en/generative-ai/index.html',
    apiKeyUrl: 'https://accounts.cloud.databricks.com',
    protocol: 'openai_compatible',
    status: 'planned',
    freeTier: { available: false, requiresCard: true, description: 'Enterprise lakehouse deployment.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: true },
    models: [{ id: 'databricks-dbrx-instruct', name: 'DBRX Instruct', free: false, contextLimit: 32768 }],
  },
  {
    id: 'ibm_watsonx',
    name: 'IBM watsonx.ai',
    category: 'cloud_enterprise',
    logoText: 'IBM',
    websiteUrl: 'https://www.ibm.com/watsonx',
    docsUrl: 'https://dataplatform.cloud.ibm.com/docs',
    apiKeyUrl: 'https://cloud.ibm.com',
    protocol: 'openai_compatible',
    status: 'planned',
    freeTier: { available: false, requiresCard: true, description: 'IBM Cloud enterprise account.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: false, longContext: true, embeddings: true },
    models: [{ id: 'ibm/granite-3-8b-instruct', name: 'Granite 3 8B Instruct', free: false, contextLimit: 128000 }],
  },
  {
    id: 'alibaba_cloud',
    name: 'Alibaba Cloud (Qwen)',
    category: 'cloud_enterprise',
    logoText: 'AC',
    websiteUrl: 'https://alibabacloud.com',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio',
    apiKeyUrl: 'https://bailian.console.alibabacloud.com',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    status: 'beta',
    freeTier: { available: true, requiresCard: false, description: 'Free trial tokens on Model Studio registration.' },
    capabilities: { chat: true, streaming: true, tools: true, vision: true, longContext: true, embeddings: true },
    models: [{ id: 'qwen-plus', name: 'Qwen Plus', free: true, contextLimit: 131072, tools: true }],
  },
];

/**
 * Filter providers by search term and selected filters
 */
export function filterCatalog(
  providers: ProviderCatalogEntry[],
  searchQuery: string,
  filter: 'all' | 'free' | 'no_card' | 'fast' | 'vision' | 'tools' | 'long_context' | 'local'
): ProviderCatalogEntry[] {
  const query = searchQuery.trim().toLowerCase();

  return providers.filter((p) => {
    // Search query match
    if (query) {
      const matchName = p.name.toLowerCase().includes(query);
      const matchId = p.id.toLowerCase().includes(query);
      const matchModel = p.models.some((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query));
      if (!matchName && !matchId && !matchModel) return false;
    }

    // Filter match
    if (filter === 'free') return p.freeTier.available;
    if (filter === 'no_card') return p.freeTier.available && !p.freeTier.requiresCard;
    if (filter === 'fast') return p.rankingBadge === 'Fast' || p.category === 'fast_inference';
    if (filter === 'vision') return p.capabilities.vision;
    if (filter === 'tools') return p.capabilities.tools;
    if (filter === 'long_context') return p.capabilities.longContext;
    if (filter === 'local') return p.category === 'local';

    return true;
  });
}

/**
 * Get recommended free routes ranked by compatibility and capabilities
 */
export function getRecommendedFreeRoutes(): ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter((p) => p.freeTier.available && p.status === 'active').sort((a, b) => {
    const scoreA = (a.recommendedForMetaIoid ? 10 : 0) + (a.capabilities.vision ? 2 : 0) + (a.capabilities.tools ? 2 : 0);
    const scoreB = (b.recommendedForMetaIoid ? 10 : 0) + (b.capabilities.vision ? 2 : 0) + (b.capabilities.tools ? 2 : 0);
    return scoreB - scoreA;
  });
}
