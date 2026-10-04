// Provider Registry - Canonical registry of provider manifests and capabilities
// PROVIDER PLATFORM #4: Central repository for provider definitions
// CATEGORIES: LLM, REASONING, VISION, IMAGE, VIDEO, STT, TTS, SEARCH, RESEARCH, EMBEDDING, OCR, CODE, DOCUMENT_AI

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const PROVIDERS_FILE = path.join(DIR, 'providers.json');

let providers = {};

// Load persisted provider registry
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(PROVIDERS_FILE)) {
    providers = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
  }
} catch { /* start empty */ }

function persistProviders() {
  try {
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(providers, null, 2).slice(0, 5_000_000));
  } catch { /* disk full — state stays in RAM */ }
}

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

/**
 * Provider Categories
 */
export const ProviderCategories = {
  LLM: 'LLM',
  REASONING: 'REASONING',
  VISION: 'VISION',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  STT: 'STT',
  TTS: 'TTS',
  SEARCH: 'SEARCH',
  RESEARCH: 'RESEARCH',
  EMBEDDING: 'EMBEDDING',
  OCR: 'OCR',
  CODE: 'CODE',
  DOCUMENT_AI: 'DOCUMENT_AI'
};

/**
 * Auth Schema Types
 */
export const AuthSchemaTypes = {
  BEARER_TOKEN: 'bearer_token',
  API_KEY: 'api_key',
  OAUTH2: 'oauth2',
  CUSTOM: 'custom'
};

/**
 * Register a provider
 */
export function registerProvider(manifest) {
  const { providerId, name, category, authSchema, capabilities, models, healthCheck, adapterVersion, documentationUrl } = manifest;
  
  // Validate required fields
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('providerId required');
  }
  if (!name || typeof name !== 'string') {
    throw new Error('name required');
  }
  if (!category || !Object.values(ProviderCategories).includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }
  if (!authSchema || !authSchema.type || !Object.values(AuthSchemaTypes).includes(authSchema.type)) {
    throw new Error('Invalid authSchema');
  }
  
  // Build provider record
  const provider = {
    providerId,
    name,
    category,
    authSchema: {
      type: authSchema.type,
      credentialType: authSchema.credentialType || 'string',
      documentationUrl: authSchema.documentationUrl || ''
    },
    capabilities: {
      streaming: capabilities.streaming || false,
      async: capabilities.async || false,
      webhooks: capabilities.webhooks || false,
      contextLimit: capabilities.contextLimit || null,
      maxOutputTokens: capabilities.maxOutputTokens || null,
      supportedModalities: capabilities.supportedModalities || []
    },
    models: (models || []).map(model => ({
      modelId: model.modelId,
      displayName: model.displayName || model.modelId,
      capabilities: model.capabilities || [],
      contextLimit: model.contextLimit || null,
      streaming: model.streaming !== false,
      async: model.async || false,
      availability: model.availability || 'public',
      free: typeof model.free === 'boolean' ? model.free : null,
      pricing: model.pricing || null,
      unavailable: typeof model.unavailable === 'boolean' ? model.unavailable : null,
    })),
    healthCheck: healthCheck || {
      endpoint: '',
      method: 'GET',
      timeout: 5000,
      healthyStatus: [200]
    },
    adapterVersion: adapterVersion || '1.0.0',
    documentationUrl: documentationUrl || '',
    pricingUrl: manifest.pricingUrl || '',
    rateLimits: manifest.rateLimits || null,
    registeredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  providers[providerId] = provider;
  persistProviders();
  
  emit('provider.registered', { providerId, name, category });
  
  return provider;
}

/**
 * Get provider manifest
 */
export function getProvider(providerId) {
  return providers[providerId] || null;
}

/**
 * List providers by category
 */
export function listProviders(category = null) {
  let result = Object.values(providers);
  
  if (category) {
    result = result.filter(p => p.category === category);
  }
  
  return result.map(p => ({
    providerId: p.providerId,
    name: p.name,
    category: p.category,
    capabilities: p.capabilities,
    modelCount: p.models.length,
    adapterVersion: p.adapterVersion,
    documentationUrl: p.documentationUrl
  }));
}

/**
 * Update provider manifest
 */
export function updateProvider(providerId, updates) {
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  
  // Update allowed fields
  const allowedUpdates = ['name', 'capabilities', 'models', 'healthCheck', 'adapterVersion', 'documentationUrl', 'pricingUrl', 'rateLimits'];
  
  for (const field of allowedUpdates) {
    if (updates[field] !== undefined) {
      provider[field] = updates[field];
    }
  }
  
  provider.updatedAt = new Date().toISOString();
  persistProviders();
  
  emit('provider.updated', { providerId });
  
  return provider;
}

/**
 * Deregister a provider
 */
export function deregisterProvider(providerId) {
  if (!providers[providerId]) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  
  delete providers[providerId];
  persistProviders();
  
  emit('provider.deregistered', { providerId });
  
  return { ok: true };
}

/**
 * Get provider models
 */
export function getProviderModels(providerId) {
  const provider = providers[providerId];
  if (!provider) {
    return [];
  }
  
  return provider.models;
}

/**
 * List all models across all providers
 */
export function listAllModels(category = null) {
  let providersToSearch = Object.values(providers);
  
  if (category) {
    providersToSearch = providersToSearch.filter(p => p.category === category);
  }
  
  const models = [];
  
  for (const provider of providersToSearch) {
    for (const model of provider.models) {
      models.push({
        providerId: provider.providerId,
        providerName: provider.name,
        providerCategory: provider.category,
        ...model
      });
    }
  }
  
  return models;
}

/**
 * Search models by capability
 */
export function searchModelsByCapability(capability) {
  const models = [];
  
  for (const provider of Object.values(providers)) {
    for (const model of provider.models) {
      if (model.capabilities.includes(capability)) {
        models.push({
          providerId: provider.providerId,
          providerName: provider.name,
          ...model
        });
      }
    }
  }
  
  return models;
}

/**
 * Initialize default providers (OpenRouter, NVIDIA, OpenAI, Anthropic, Gemini)
 */
export function initializeDefaultProviders() {
  // OpenRouter
  if (!providers['openrouter']) {
    registerProvider({
      providerId: 'openrouter',
      name: 'OpenRouter',
      category: ProviderCategories.LLM,
      authSchema: {
        type: AuthSchemaTypes.BEARER_TOKEN,
        credentialType: 'string',
        documentationUrl: 'https://openrouter.ai/docs'
      },
      capabilities: {
        streaming: true,
        async: false,
        webhooks: false,
        contextLimit: 128000,
        maxOutputTokens: 4096,
        supportedModalities: ['text', 'vision']
      },
      models: [], // Models are fetched dynamically
      healthCheck: {
        endpoint: 'https://openrouter.ai/api/v1/models',
        method: 'GET',
        timeout: 5000,
        healthyStatus: [200]
      },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://openrouter.ai/docs',
      pricingUrl: 'https://openrouter.ai/pricing'
    });
  }
  
  // NVIDIA
  if (!providers['nvidia']) {
    registerProvider({
      providerId: 'nvidia',
      name: 'NVIDIA NIM',
      category: ProviderCategories.LLM,
      authSchema: {
        type: AuthSchemaTypes.BEARER_TOKEN,
        credentialType: 'string',
        documentationUrl: 'https://build.nvidia.com/'
      },
      capabilities: {
        streaming: true,
        async: false,
        webhooks: false,
        contextLimit: 128000,
        maxOutputTokens: 4096,
        supportedModalities: ['text']
      },
      models: [
        {
          modelId: 'nvidia/llama-3.1-nemotron-70b-instruct',
          displayName: 'Llama 3.1 Nemotron 70B Instruct',
          capabilities: ['text', 'reasoning'],
          contextLimit: 128000,
          streaming: true,
          async: false,
          availability: 'public'
        }
      ],
      healthCheck: {
        endpoint: 'https://integrate.api.nvidia.com/v1/models',
        method: 'GET',
        timeout: 5000,
        healthyStatus: [200]
      },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://build.nvidia.com/',
      pricingUrl: 'https://build.nvidia.com/pricing'
    });
  }

  // OpenAI
  if (!providers['openai']) {
    registerProvider({
      providerId: 'openai',
      name: 'OpenAI',
      category: ProviderCategories.LLM,
      authSchema: {
        type: AuthSchemaTypes.API_KEY,
        credentialType: 'string',
        documentationUrl: 'https://platform.openai.com/docs/api-reference'
      },
      capabilities: {
        streaming: true,
        async: false,
        webhooks: false,
        contextLimit: 128000,
        maxOutputTokens: 16384,
        supportedModalities: ['text', 'vision']
      },
      models: [
        { modelId: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['text', 'vision', 'tool-use', 'structured-output', 'streaming'], contextLimit: 128000 },
        { modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', capabilities: ['text', 'vision', 'tool-use', 'structured-output', 'streaming'], contextLimit: 128000 },
        { modelId: 'o3-mini', displayName: 'o3-mini (reasoning)', capabilities: ['text', 'reasoning', 'tool-use', 'streaming'], contextLimit: 200000 }
      ],
      healthCheck: {
        endpoint: 'https://api.openai.com/v1/models',
        method: 'GET',
        timeout: 5000,
        healthyStatus: [200]
      },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://platform.openai.com/docs/api-reference',
      pricingUrl: 'https://openai.com/api/pricing'
    });
  }

  // Anthropic
  if (!providers['anthropic']) {
    registerProvider({
      providerId: 'anthropic',
      name: 'Anthropic',
      category: ProviderCategories.LLM,
      authSchema: {
        type: AuthSchemaTypes.API_KEY,
        credentialType: 'string',
        documentationUrl: 'https://docs.anthropic.com/en/api'
      },
      capabilities: {
        streaming: true,
        async: false,
        webhooks: false,
        contextLimit: 200000,
        maxOutputTokens: 8192,
        supportedModalities: ['text', 'vision']
      },
      models: [
        { modelId: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', capabilities: ['text', 'vision', 'reasoning', 'tool-use', 'streaming'], contextLimit: 200000 },
        { modelId: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', capabilities: ['text', 'vision', 'tool-use', 'streaming'], contextLimit: 200000 },
        { modelId: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', capabilities: ['text', 'vision', 'reasoning', 'tool-use', 'streaming'], contextLimit: 200000 }
      ],
      healthCheck: {
        endpoint: 'https://api.anthropic.com/v1/models',
        method: 'GET',
        timeout: 5000,
        healthyStatus: [200]
      },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://docs.anthropic.com/en/api',
      pricingUrl: 'https://www.anthropic.com/pricing'
    });
  }

  // Google Gemini
  if (!providers['gemini']) {
    registerProvider({
      providerId: 'gemini',
      name: 'Google Gemini',
      category: ProviderCategories.LLM,
      authSchema: {
        type: AuthSchemaTypes.API_KEY,
        credentialType: 'string',
        documentationUrl: 'https://ai.google.dev/gemini-api/docs'
      },
      capabilities: {
        streaming: true,
        async: false,
        webhooks: false,
        contextLimit: 1048576,
        maxOutputTokens: 8192,
        supportedModalities: ['text', 'vision']
      },
      models: [
        { modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', capabilities: ['text', 'vision', 'tool-use', 'streaming'], contextLimit: 1048576 },
        { modelId: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', capabilities: ['text', 'vision', 'reasoning', 'tool-use', 'streaming'], contextLimit: 2097152 }
      ],
      healthCheck: {
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        method: 'GET',
        timeout: 5000,
        healthyStatus: [200]
      },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://ai.google.dev/gemini-api/docs',
      pricingUrl: 'https://ai.google.dev/pricing'
    });
  }

  // Groq
  if (!providers['groq']) {
    registerProvider({
      providerId: 'groq',
      name: 'Groq Cloud',
      category: ProviderCategories.LLM,
      authSchema: { type: AuthSchemaTypes.API_KEY, credentialType: 'string', documentationUrl: 'https://console.groq.com/docs/quickstart' },
      capabilities: { streaming: true, async: false, webhooks: false, contextLimit: 128000, maxOutputTokens: 8192, supportedModalities: ['text'] },
      models: [
        { modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile', capabilities: ['text', 'tool-use', 'streaming'], contextLimit: 128000 },
        { modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', capabilities: ['text', 'tool-use', 'streaming'], contextLimit: 128000 }
      ],
      healthCheck: { endpoint: 'https://api.groq.com/openai/v1/models', method: 'GET', timeout: 5000, healthyStatus: [200] },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://console.groq.com/docs/quickstart',
      pricingUrl: 'https://groq.com/pricing'
    });
  }

  // DeepSeek
  if (!providers['deepseek']) {
    registerProvider({
      providerId: 'deepseek',
      name: 'DeepSeek',
      category: ProviderCategories.LLM,
      authSchema: { type: AuthSchemaTypes.API_KEY, credentialType: 'string', documentationUrl: 'https://platform.deepseek.com/api-docs' },
      capabilities: { streaming: true, async: false, webhooks: false, contextLimit: 64000, maxOutputTokens: 8192, supportedModalities: ['text'] },
      models: [
        { modelId: 'deepseek-chat', displayName: 'DeepSeek-V3', capabilities: ['text', 'tool-use', 'streaming'], contextLimit: 64000 },
        { modelId: 'deepseek-reasoner', displayName: 'DeepSeek-R1', capabilities: ['text', 'reasoning', 'streaming'], contextLimit: 64000 }
      ],
      healthCheck: { endpoint: 'https://api.deepseek.com/v1/models', method: 'GET', timeout: 5000, healthyStatus: [200] },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://platform.deepseek.com/api-docs',
      pricingUrl: 'https://platform.deepseek.com/pricing'
    });
  }

  // Mistral
  if (!providers['mistral']) {
    registerProvider({
      providerId: 'mistral',
      name: 'Mistral AI',
      category: ProviderCategories.LLM,
      authSchema: { type: AuthSchemaTypes.API_KEY, credentialType: 'string', documentationUrl: 'https://docs.mistral.ai' },
      capabilities: { streaming: true, async: false, webhooks: false, contextLimit: 128000, maxOutputTokens: 8192, supportedModalities: ['text', 'vision'] },
      models: [
        { modelId: 'mistral-small-latest', displayName: 'Mistral Small', capabilities: ['text', 'tool-use', 'streaming'], contextLimit: 32768 },
        { modelId: 'codestral-latest', displayName: 'Codestral', capabilities: ['text', 'code', 'streaming'], contextLimit: 32768 }
      ],
      healthCheck: { endpoint: 'https://api.mistral.ai/v1/models', method: 'GET', timeout: 5000, healthyStatus: [200] },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://docs.mistral.ai',
      pricingUrl: 'https://mistral.ai/pricing'
    });
  }

  // Ollama (Local)
  if (!providers['ollama']) {
    registerProvider({
      providerId: 'ollama',
      name: 'Ollama (Local)',
      category: ProviderCategories.LLM,
      authSchema: { type: AuthSchemaTypes.CUSTOM, credentialType: 'string', documentationUrl: 'https://ollama.com' },
      capabilities: { streaming: true, async: false, webhooks: false, contextLimit: 128000, maxOutputTokens: 8192, supportedModalities: ['text', 'vision'] },
      models: [
        { modelId: 'llama3.2', displayName: 'Llama 3.2 (Local)', capabilities: ['text', 'streaming'], contextLimit: 128000 },
        { modelId: 'mistral', displayName: 'Mistral (Local)', capabilities: ['text', 'streaming'], contextLimit: 32768 }
      ],
      healthCheck: { endpoint: 'http://localhost:11434/v1/models', method: 'GET', timeout: 3000, healthyStatus: [200] },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://ollama.com',
      pricingUrl: 'https://ollama.com'
    });
  }

  // LM Studio (Local)
  if (!providers['lmstudio']) {
    registerProvider({
      providerId: 'lmstudio',
      name: 'LM Studio (Local)',
      category: ProviderCategories.LLM,
      authSchema: { type: AuthSchemaTypes.CUSTOM, credentialType: 'string', documentationUrl: 'https://lmstudio.ai' },
      capabilities: { streaming: true, async: false, webhooks: false, contextLimit: 32768, maxOutputTokens: 4096, supportedModalities: ['text'] },
      models: [
        { modelId: 'loaded-model', displayName: 'Loaded Model', capabilities: ['text', 'streaming'], contextLimit: 32768 }
      ],
      healthCheck: { endpoint: 'http://localhost:1234/v1/models', method: 'GET', timeout: 3000, healthyStatus: [200] },
      adapterVersion: '1.0.0',
      documentationUrl: 'https://lmstudio.ai',
      pricingUrl: 'https://lmstudio.ai'
    });
  }
}

/**
 * Health check for provider registry
 */
export function registryHealth() {
  return {
    status: 'healthy',
    providerCount: Object.keys(providers).length,
    totalModels: Object.values(providers).reduce((sum, p) => sum + p.models.length, 0),
    categories: [...new Set(Object.values(providers).map(p => p.category))]
  };
}

// Initialize default providers on module load
initializeDefaultProviders();
