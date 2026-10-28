/**
 * Minimal Gemini API client (REST, no SDK) with JSON mode, an overall time budget,
 * and failover to a faster backup model when the primary is overloaded or slow.
 * @module gemini
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MIN_ATTEMPT_MS = 3_000;

export class GeminiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

/**
 * Extract the model's text, skipping any "thought" parts.
 * @param {any} payload
 * @returns {string}
 */
export function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

/**
 * Parse JSON, tolerating an accidental ```json fence.
 * @param {string} text
 */
export function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * @param {{
 *   apiKey: string, model: string, fallbackModel?: string, timeoutMs: number,
 *   thinkingLevel?: string, fetchImpl?: typeof fetch, now?: () => number,
 * }} options
 */
export function createGeminiClient({ apiKey, model, fallbackModel = '', timeoutMs, thinkingLevel = 'low', fetchImpl = fetch, now = Date.now }) {
  const models = [...new Set([model, fallbackModel].filter(Boolean))];

  /**
   * One request to one model.
   * @param {string} name model id
   * @param {string} body
   * @param {number} budgetMs
   */
  async function call(name, body, budgetMs) {
    const res = await fetchImpl(`${API_BASE}/${encodeURIComponent(name)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
      signal: AbortSignal.timeout(budgetMs),
    });
    if (!res.ok) throw new GeminiError(`Gemini HTTP ${res.status} (${name})`, res.status);
    const text = extractText(await res.json());
    if (!text) throw new GeminiError(`Gemini returned an empty response (${name})`);
    return parseJsonText(text);
  }

  return {
    enabled: Boolean(apiKey),
    model,

    /**
     * Generate structured JSON within `timeoutMs` in total.
     * @param {{ system: string, prompt: string, schema: object }} input
     * @returns {Promise<unknown>}
     */
    async generateJson({ system, prompt, schema }) {
      if (!apiKey) throw new GeminiError('Gemini API key is not configured');
      const request = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.8,
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      };
      const plainRequest = { ...request, generationConfig: { ...request.generationConfig } };
      delete plainRequest.generationConfig.thinkingConfig;

      const deadline = now() + timeoutMs;
      let lastError = new GeminiError('Gemini request failed');

      for (let i = 0; i < models.length; i += 1) {
        // Leave room for the backup model when there is one.
        const remaining = deadline - now();
        const share = i < models.length - 1 ? Math.floor(remaining * 0.6) : remaining;
        if (share < MIN_ATTEMPT_MS) break;
        try {
          return await call(models[i], JSON.stringify(request), share);
        } catch (firstError) {
          let error = firstError;
          // A model that rejects the thinking setting gets one plain retry.
          if (error instanceof GeminiError && error.status === 400 && thinkingLevel && deadline - now() >= MIN_ATTEMPT_MS) {
            try {
              return await call(models[i], JSON.stringify(plainRequest), deadline - now());
            } catch (retryError) {
              error = retryError;
            }
          }
          lastError = error instanceof GeminiError
            ? error
            : new GeminiError(error instanceof Error ? `${error.name}: ${error.message} (${models[i]})` : 'Gemini request failed');
          const failover = lastError.status === undefined || RETRYABLE.has(lastError.status);
          if (!failover) break;
        }
      }
      throw lastError;
    },
  };
}
