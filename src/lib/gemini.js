/**
 * Minimal Gemini API client (REST, no SDK) with timeout, retry and JSON mode.
 * @module gemini
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

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
 * @param {{ apiKey: string, model: string, timeoutMs: number, fetchImpl?: typeof fetch, retries?: number, retryDelayMs?: number }} options
 */
export function createGeminiClient({ apiKey, model, timeoutMs, fetchImpl = fetch, retries = 1, retryDelayMs = 600 }) {
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;

  return {
    enabled: Boolean(apiKey),
    model,

    /**
     * Generate structured JSON.
     * @param {{ system: string, prompt: string, schema: object }} input
     * @returns {Promise<unknown>}
     */
    async generateJson({ system, prompt, schema }) {
      if (!apiKey) throw new GeminiError('Gemini API key is not configured');
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.8,
        },
      });

      let lastError = new GeminiError('Gemini request failed');
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) {
            lastError = new GeminiError(`Gemini HTTP ${res.status}`, res.status);
            if (RETRYABLE.has(res.status) && attempt < retries) {
              await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
              continue;
            }
            throw lastError;
          }
          const text = extractText(await res.json());
          if (!text) throw new GeminiError('Gemini returned an empty response');
          return parseJsonText(text);
        } catch (error) {
          if (error instanceof GeminiError) throw error;
          lastError = new GeminiError(error instanceof Error ? error.message : 'Gemini request failed');
          if (attempt >= retries) throw lastError;
        }
      }
      throw lastError;
    },
  };
}
