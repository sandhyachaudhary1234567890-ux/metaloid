// Model Catalog - Normalized model registry with capabilities and metadata
// PROVIDER PLATFORM #9: Central model capability registry
// Stores model information from all providers in a normalized format

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const MODELS_FILE = path.join(DIR, 'models.json');

let modelCatalog = {};

// Load persisted model catalog
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(MODELS_FILE)) {
    modelCatalog = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  }
} catch { /* start empty */ }

function persistCatalog() {
  try {
    fs.writeFileSync(MODELS_FILE, JSON.stringify(modelCatalog, null, 2).slice(0, 10_000_000));
  } catch { /* disk full — state stays in RAM */ }
}

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

/**
 * Model Capability Types
 */
export const ModelCapabilities = {
  TEXT: 'text',
  VISION: 'vision',
  CODING: 'coding',
  REASONING: 'reasoning',
  FUNCTION_CALLING: 'function_calling',
  STREAMING: 'streaming',
  ASYNC: 'async'
};

/**
 * Model Availability
 */
export const ModelAvailability = {
  PUBLIC: 'public',
  BETA: 'beta',
  ENTERPRISE: 'enterprise'
};

/**
 * Register a model
 */
export function registerModel(modelData) {
  const { providerId, modelId, displayName, capabilities, contextLimit, maxOutputTokens, pricing, availability, modalities, languages } = modelData;
  
  // Validate required fields
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('providerId required');
  }
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('modelId required');
  }
  if (!displayName || typeof displayName !== 'string') {
    throw new Error('displayName required');
  }
  
  // Generate unique model key
  const modelKey = `${providerId}:${modelId}`;
  
  const model = {
    modelKey,
    providerId,
    modelId,
    displayName,
    capabilities: {
      text: capabilities?.text !== false,
      vision: capabilities?.vision || false,
      coding: capabilities?.coding || false,
      reasoning: capabilities?.reasoning || false,
      functionCalling: capabilities?.functionCalling || false,
      streaming: capabilities?.streaming !== false,
      async: capabilities?.async || false
    },
    contextLimit: contextLimit || null,
    maxOutputTokens: maxOutputTokens || null,
    pricing: pricing || null,
    availability: availability || ModelAvailability.PUBLIC,
    modalities: modalities || ['text'],
    languages: languages || ['en'],
    registeredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  modelCatalog[modelKey] = model;
  persistCatalog();
  
  emit('model.registered', { providerId, modelId, displayName });
  
  return model;
}

/**
 * Get model details
 */
export function getModel(providerId, modelId) {
  const modelKey = `${providerId}:${modelId}`;
  return modelCatalog[modelKey] || null;
}

/**
 * List models by criteria
 */
export function listModels(criteria = {}) {
  const { providerId, capability, availability, modality } = criteria;
  
  let result = Object.values(modelCatalog);
  
  // Filter by provider
  if (providerId) {
    result = result.filter(m => m.providerId === providerId);
  }
  
  // Filter by capability
  if (capability) {
    result = result.filter(m => m.capabilities[capability] === true);
  }
  
  // Filter by availability
  if (availability) {
    result = result.filter(m => m.availability === availability);
  }
  
  // Filter by modality
  if (modality) {
    result = result.filter(m => m.modalities.includes(modality));
  }
  
  return result.map(m => ({
    providerId: m.providerId,
    modelId: m.modelId,
    displayName: m.displayName,
    capabilities: m.capabilities,
    contextLimit: m.contextLimit,
    maxOutputTokens: m.maxOutputTokens,
    availability: m.availability,
    modalities: m.modalities,
    languages: m.languages
  }));
}

/**
 * Update model information
 */
export function updateModel(providerId, modelId, updates) {
  const modelKey = `${providerId}:${modelId}`;
  const model = modelCatalog[modelKey];
  
  if (!model) {
    throw new Error(`Model not found: ${modelKey}`);
  }
  
  // Update allowed fields
  const allowedUpdates = ['displayName', 'capabilities', 'contextLimit', 'maxOutputTokens', 'pricing', 'availability', 'modalities', 'languages'];
  
  for (const field of allowedUpdates) {
    if (updates[field] !== undefined) {
      if (field === 'capabilities') {
        // Merge capabilities
        model.capabilities = { ...model.capabilities, ...updates[field] };
      } else {
        model[field] = updates[field];
      }
    }
  }
  
  model.updatedAt = new Date().toISOString();
  persistCatalog();
  
  emit('model.updated', { providerId, modelId });
  
  return model;
}

/**
 * Remove model
 */
export function removeModel(providerId, modelId) {
  const modelKey = `${providerId}:${modelId}`;
  
  if (!modelCatalog[modelKey]) {
    throw new Error(`Model not found: ${modelKey}`);
  }
  
  delete modelCatalog[modelKey];
  persistCatalog();
  
  emit('model.removed', { providerId, modelId });
  
  return { ok: true };
}

/**
 * Search models by capability
 */
export function searchModelsByCapability(capability) {
  return Object.values(modelCatalog).filter(m => m.capabilities[capability] === true);
}

/**
 * Get models for a provider
 */
export function getProviderModels(providerId) {
  return Object.values(modelCatalog).filter(m => m.providerId === providerId);
}

/**
 * Sync models from provider registry
 * This function pulls model information from the provider registry and updates the catalog
 */
export function syncModelsFromRegistry(providerRegistry) {
  const providers = providerRegistry.listProviders();
  let synced = 0;
  
  for (const provider of providers) {
    const providerModels = providerRegistry.getProviderModels(provider.providerId);
    
    for (const modelData of providerModels) {
      try {
        registerModel({
          providerId: provider.providerId,
          modelId: modelData.modelId,
          displayName: modelData.displayName,
          capabilities: {
            text: modelData.capabilities.includes('text'),
            vision: modelData.capabilities.includes('vision'),
            coding: modelData.capabilities.includes('coding'),
            reasoning: modelData.capabilities.includes('reasoning'),
            functionCalling: modelData.capabilities.includes('function_calling'),
            streaming: modelData.streaming,
            async: modelData.async
          },
          contextLimit: modelData.contextLimit,
          maxOutputTokens: modelData.maxOutputTokens,
          availability: modelData.availability,
          modalities: provider.capabilities.supportedModalities
        });
        synced++;
      } catch (error) {
        console.error(`Failed to sync model ${modelData.modelId}:`, error.message);
      }
    }
  }
  
  return synced;
}

/**
 * Get model statistics
 */
export function getModelStats() {
  const providerCounts = {};
  const capabilityCounts = {};
  const availabilityCounts = {};
  
  for (const model of Object.values(modelCatalog)) {
    // Count by provider
    providerCounts[model.providerId] = (providerCounts[model.providerId] || 0) + 1;
    
    // Count by capability
    for (const [cap, enabled] of Object.entries(model.capabilities)) {
      if (enabled) {
        capabilityCounts[cap] = (capabilityCounts[cap] || 0) + 1;
      }
    }
    
    // Count by availability
    availabilityCounts[model.availability] = (availabilityCounts[model.availability] || 0) + 1;
  }
  
  return {
    totalModels: Object.keys(modelCatalog).length,
    providerCounts,
    capabilityCounts,
    availabilityCounts
  };
}

/**
 * Get catalog health
 */
export function catalogHealth() {
  return {
    status: 'healthy',
    modelCount: Object.keys(modelCatalog).length,
    providerCount: new Set(Object.values(modelCatalog).map(m => m.providerId)).size,
    lastSync: new Date().toISOString()
  };
}
