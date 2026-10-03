// Provider Adapter Contract - Standardized interface for all provider implementations
// PROVIDER PLATFORM #6: Common adapter contract for provider implementations
// Every provider must implement these methods for consistent behavior

import { getUserCredential, setCredentialTestStatus } from './credentialVault.js';
import { getProvider } from './providerRegistry.js';

/**
 * Standardized Error Types
 */
export const ErrorTypes = {
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAVAILABLE: 'UNAVAILABLE',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  CONTENT_REJECTED: 'CONTENT_REJECTED',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Base Provider Adapter - Abstract class that all providers must extend
 */
/**
 * Normalise a configured API base: strip trailing slashes so path joins never
 * produce `//chat/completions`, which some gateways 404 on. Written as a loop
 * rather than a regex so there is no escaping to get subtly wrong.
 */
function trimBase(url) {
  let out = String(url || '');
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/**
 * How long to wait for a provider to *start* answering, before giving up.
 * Not a cap on the answer itself: a long generation is legitimate, but a
 * provider that never sends response headers is not, and without this the
 * streamed request inherits whatever signal the caller happened to pass —
 * which, on the agent paths that pass none, means no timeout at all. The
 * request then sits until the runtime gives up minutes later, which the user
 * experiences as a permanent "Thinking…".
 */
const PROVIDER_HEADERS_TIMEOUT_MS = Number(process.env.METALOID_PROVIDER_TIMEOUT_MS || 30_000);

/**
 * A signal for a streamed request: aborts if the provider never answers, and
 * still honours a caller's abort mid-stream. The timer is cleared as soon as
 * headers arrive, so it limits time-to-first-byte and not total duration.
 */
function streamGate(request) {
  const controller = new AbortController();
  const caller = request && request.signal;
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason);
    // once:true — the caller's signal belongs to the request, so this listener
    // is collected with it rather than accumulating per attempt.
    else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new Error(`provider sent no response within ${PROVIDER_HEADERS_TIMEOUT_MS}ms`)),
    PROVIDER_HEADERS_TIMEOUT_MS
  );
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    /** Headers are in: stop counting, let the stream run as long as it needs. */
    answered() { clearTimeout(timer); },
  };
}

export class ProviderAdapter {
  constructor(providerId, credentialVault) {
    this.providerId = providerId;
    this.credentialVault = credentialVault;
    this.provider = getProvider(providerId);
    
    if (!this.provider) {
      throw new Error(`Provider not registered: ${providerId}`);
    }
  }
  
  /**
   * Authentication & Credential Validation
   * Validate credential with provider
   */
  async authenticate(userId, credentialId) {
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        return { valid: false, error: 'Credential not found' };
      }
      
      // Default implementation: just check if credential exists
      // Subclasses should override with actual provider validation
      const result = await this.validateCredential(credential.credential);
      
      await setCredentialTestStatus(userId, this.providerId, result.valid ? 'valid' : 'invalid', {
        adapter: this.constructor.name,
        timestamp: new Date().toISOString()
      });
      
      return result;
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  /**
   * Validate credential format
   * Subclasses should override with provider-specific validation
   */
  async validateCredential(credential) {
    // Default implementation: check if credential is non-empty string
    if (!credential || typeof credential !== 'string' || credential.length < 10) {
      return { valid: false, error: 'Invalid credential format' };
    }
    return { valid: true };
  }
  
  /**
   * Model Discovery
   * Fetch available models from provider
   * Subclasses should override with actual provider API call
   */
  async listModels(userId, credentialId) {
    // Default implementation: return static models from registry
    return this.provider.models || [];
  }
  
  /**
   * Request Validation
   * Validate request against provider capabilities
   */
  async validateRequest(request) {
    const { model, messages, streaming } = request;
    
    // Check if model exists
    const modelExists = this.provider.models.some(m => m.modelId === model);
    if (!modelExists) {
      return { valid: false, error: `Model not found: ${model}` };
    }
    
    // Check streaming support
    if (streaming && !this.provider.capabilities.streaming) {
      return { valid: false, error: 'Provider does not support streaming' };
    }
    
    // Validate messages format
    if (!Array.isArray(messages) || messages.length === 0) {
      return { valid: false, error: 'Invalid messages format' };
    }
    
    return { valid: true };
  }
  
  /**
   * Execute request (non-streaming)
   * Subclasses must implement this
   */
  async execute(userId, credentialId, request) {
    throw new Error('execute() must be implemented by subclass');
  }
  
  /**
   * Execute request (streaming)
   * Subclasses must implement this
   */
  async stream(userId, credentialId, request, onToken) {
    throw new Error('stream() must be implemented by subclass');
  }
  
  /**
   * Poll async job status
   * Subclasses should implement if provider supports async operations
   */
  async poll(userId, credentialId, jobId) {
    return { status: 'UNSUPPORTED', error: 'Async operations not supported' };
  }
  
  /**
   * Cancel async job
   * Subclasses should implement if provider supports cancellation
   */
  async cancel(userId, credentialId, jobId) {
    return { cancelled: false, error: 'Cancellation not supported' };
  }
  
  /**
   * Response Normalization
   * Normalize provider response to standard format
   */
  normalizeResponse(providerResponse) {
    // Default implementation: assume response is already normalized
    return {
      text: providerResponse.text || '',
      model: providerResponse.model || '',
      usage: providerResponse.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      metadata: providerResponse.metadata || {}
    };
  }
  
  /**
   * Error Normalization
   * Normalize provider error to standard types
   */
  normalizeError(providerError) {
    const message = String(providerError.message || providerError || 'Unknown error');
    // accept statusCode (raw) or code (already-normalized re-entry) — never UNKNOWN on re-throw
    const statusCode = providerError.statusCode || providerError.status || providerError.code;
    if (providerError.type && Object.values(ErrorTypes).includes(providerError.type)) return providerError;
    
    // Classify error type
    if (statusCode === 401 || statusCode === 403) {
      return { type: ErrorTypes.AUTHENTICATION_FAILED, message, code: statusCode, retryable: false };
    }
    if (statusCode === 429) {
      return { type: ErrorTypes.RATE_LIMITED, message, code: statusCode, retryable: true };
    }
    if (statusCode === 408 || message.includes('timeout')) {
      return { type: ErrorTypes.TIMEOUT, message, code: statusCode, retryable: true };
    }
    if (statusCode === 400) {
      return { type: ErrorTypes.INVALID_REQUEST, message, code: statusCode, retryable: false };
    }
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return { type: ErrorTypes.UNAVAILABLE, message, code: statusCode, retryable: true };
    }
    if (message.includes('quota') || message.includes('limit')) {
      return { type: ErrorTypes.QUOTA_EXCEEDED, message, code: statusCode, retryable: false };
    }
    if (message.includes('model') && (statusCode === 404 || statusCode === 400)) {
      return { type: ErrorTypes.MODEL_UNAVAILABLE, message, code: statusCode, retryable: false };
    }
    if (message.includes('content') && (statusCode === 400 || statusCode === 422)) {
      return { type: ErrorTypes.CONTENT_REJECTED, message, code: statusCode, retryable: false };
    }
    
    return { type: ErrorTypes.UNKNOWN, message, code: statusCode, retryable: false };
  }
  
  /**
   * Health Check
   * Check provider health
   * Subclasses should override with actual provider health check
   */
  async healthCheck(userId, credentialId) {
    const start = Date.now();
    
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        return { status: 'auth_failed', latency: Date.now() - start };
      }
      
      // Default implementation: just check if credential exists
      const authResult = await this.authenticate(userId, credentialId);
      
      if (!authResult.valid) {
        return { status: 'auth_failed', latency: Date.now() - start };
      }
      
      return { status: 'healthy', latency: Date.now() - start };
    } catch (error) {
      return { status: 'unavailable', latency: Date.now() - start, error: error.message };
    }
  }
}

/**
 * OpenRouter Adapter - Implementation for OpenRouter provider
 */
export class OpenRouterAdapter extends ProviderAdapter {
  constructor(credentialVault) {
    super('openrouter', credentialVault);
    // Same override the catalogue and the platform-key path already honour
    // (openrouter.js). Hardcoding it here meant a deployment pointed at an
    // OpenAI-compatible proxy — or a test pointed at a fake — had its BYOK
    // traffic leave for the real vendor while everything else used the proxy.
    this.baseUrl = trimBase(process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1');
  }
  
  async validateCredential(credential) {
    if (!credential || typeof credential !== 'string' || credential.length < 20) {
      return { valid: false, error: 'Invalid OpenRouter API key format' };
    }
    return { valid: true };
  }
  
  async listModels(userId, credentialId) {
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        throw new Error('Credential not found');
      }
      
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${credential.credential}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'METALOID'
        },
        signal: AbortSignal.timeout(8000)
      });
      
      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return (data.data || []).map(model => ({
        modelId: model.id,
        displayName: model.name || model.id,
        capabilities: this._classifyCapabilities(model.id),
        contextLimit: model.context_length || null,
        streaming: true,
        async: false,
        availability: 'public'
      }));
    } catch (error) {
      console.error('OpenRouter model listing failed:', error.message);
      return this.provider.models; // Fallback to static models
    }
  }
  
  _classifyCapabilities(modelId) {
    const id = modelId.toLowerCase();
    const capabilities = ['text'];
    
    if (id.includes('vision') || id.includes('vl-') || id.includes('image') || id.includes('llava')) {
      capabilities.push('vision');
    }
    if (id.includes('code') || id.includes('coder') || id.includes('dev-')) {
      capabilities.push('coding');
    }
    if (id.includes('reason') || id.includes('70b') || id.includes('400b')) {
      capabilities.push('reasoning');
    }
    
    return capabilities;
  }
  
  async execute(userId, credentialId, request) {
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        throw new Error('Credential not found');
      }
      
      const { model, messages, system, maxTokens = 1200 } = request;
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${credential.credential}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'METALOID'
        },
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: maxTokens,
          messages: system ? [{ role: 'system', content: system }, ...messages] : messages
        }),
        signal: AbortSignal.timeout(60000)
      });
      
      if (!response.ok) {
        const error = await response.text().catch(() => '');
        throw this.normalizeError({ message: `OpenRouter ${response.status}: ${error}`, statusCode: response.status });
      }
      
      const data = await response.json();
      
      return this.normalizeResponse({
        text: data.choices?.[0]?.message?.content || '',
        model: data.model || model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
  
  async stream(userId, credentialId, request, onToken) {
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        throw new Error('Credential not found');
      }
      
      const { model, messages, system } = request;
      const sys = system || 'You are METALOID, a private personal AI assistant. Be concise unless complexity demands detail.';
      
      const gate = streamGate(request);
      let response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${credential.credential}`,
            'HTTP-Referer': 'http://localhost:5173',
            'X-Title': 'METALOID'
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [{ role: 'system', content: sys }, ...messages]
          }),
          signal: gate.signal
        });
      } finally {
        // Headers arrived, or the attempt failed. Either way time-to-first-byte
        // is no longer the question, so the connect budget stops here.
        gate.answered();
      }

      if (!response.ok || !response.body) {
        const error = await response.text().catch(() => '');
        throw this.normalizeError({ message: `OpenRouter ${response.status}: ${error}`, statusCode: response.status });
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              onToken(fullText);
            }
          } catch { /* ignore partial chunks */ }
        }
      }
      
      return this.normalizeResponse({
        text: fullText,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } // Usage not available in streaming
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
  
  async healthCheck(userId, credentialId) {
    const start = Date.now();
    
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        return { status: 'auth_failed', latency: Date.now() - start };
      }
      
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${credential.credential}`
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.status === 401 || response.status === 403) {
        return { status: 'auth_failed', latency: Date.now() - start };
      }
      
      if (response.status === 429) {
        return { status: 'rate_limited', latency: Date.now() - start };
      }
      
      if (!response.ok) {
        return { status: 'unavailable', latency: Date.now() - start };
      }
      
      return { status: 'healthy', latency: Date.now() - start };
    } catch (error) {
      return { status: 'unavailable', latency: Date.now() - start, error: error.message };
    }
  }
}

/**
 * NVIDIA Adapter - Implementation for NVIDIA NIM provider
 */
export class NvidiaAdapter extends ProviderAdapter {
  constructor(credentialVault) {
    super('nvidia', credentialVault);
    this.baseUrl = trimBase(process.env.NVIDIA_BASE || 'https://integrate.api.nvidia.com/v1');
  }
  
  async validateCredential(credential) {
    if (!credential || typeof credential !== 'string' || credential.length < 20) {
      return { valid: false, error: 'Invalid NVIDIA API key format' };
    }
    return { valid: true };
  }
  
  async execute(userId, credentialId, request) {
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        throw new Error('Credential not found');
      }
      
      const { model = 'nvidia/llama-3.1-nemotron-70b-instruct', messages, system, maxTokens = 1200 } = request;
      const sys = system || 'You are METALOID, a private personal AI assistant. Be concise unless complexity demands detail.';
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${credential.credential}`
        },
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: maxTokens,
          temperature: 0.6,
          messages: [{ role: 'system', content: sys }, ...messages]
        }),
        signal: AbortSignal.timeout(60000)
      });
      
      if (!response.ok) {
        const error = await response.text().catch(() => '');
        throw this.normalizeError({ message: `NVIDIA ${response.status}: ${error}`, statusCode: response.status });
      }
      
      const data = await response.json();
      
      return this.normalizeResponse({
        text: data.choices?.[0]?.message?.content || '',
        model: data.model || model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
  
  async stream(userId, credentialId, request, onToken) {
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        throw new Error('Credential not found');
      }
      
      const { model = 'nvidia/llama-3.1-nemotron-70b-instruct', messages, system } = request;
      const sys = system || 'You are METALOID, a private personal AI assistant. Be concise unless complexity demands detail.';
      
      const gate = streamGate(request);
      let response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${credential.credential}`
          },
          body: JSON.stringify({
            model,
            stream: true,
            temperature: 0.6,
            messages: [{ role: 'system', content: sys }, ...messages]
          }),
          signal: gate.signal
        });
      } finally {
        gate.answered(); // headers in, or the attempt is over
      }

      if (!response.ok || !response.body) {
        const error = await response.text().catch(() => '');
        throw this.normalizeError({ message: `NVIDIA ${response.status}: ${error}`, statusCode: response.status });
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              onToken(fullText);
            }
          } catch { /* ignore partial chunks */ }
        }
      }
      
      return this.normalizeResponse({
        text: fullText,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
  
  async healthCheck(userId, credentialId) {
    const start = Date.now();
    
    try {
      const credential = await this.credentialVault.getUserCredential(userId, this.providerId);
      if (!credential) {
        return { status: 'auth_failed', latency: Date.now() - start };
      }
      
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${credential.credential}`
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.status === 401 || response.status === 403) {
        return { status: 'auth_failed', latency: Date.now() - start };
      }
      
      if (response.status === 429) {
        return { status: 'rate_limited', latency: Date.now() - start };
      }
      
      if (!response.ok) {
        return { status: 'unavailable', latency: Date.now() - start };
      }
      
      return { status: 'healthy', latency: Date.now() - start };
    } catch (error) {
      return { status: 'unavailable', latency: Date.now() - start, error: error.message };
    }
  }
}
