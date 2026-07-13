// LLM chain: local model first (Ollama-compatible endpoint), then Gemini,
// then null — callers always carry a deterministic fallback, so a dead or
// absent model can never block a round.
//
//   npx convex env set LOCAL_LLM_URL http://127.0.0.1:11434   (Ollama default)
//   npx convex env set LOCAL_LLM_MODEL llama3.2               (optional)
//   npx convex env set GEMINI_API_KEY <key>                   (cloud fallback)

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function localJson(prompt: string): Promise<any | null> {
  const base = process.env.LOCAL_LLM_URL;
  if (!base) return null;
  const json = await fetchJson(`${base.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LOCAL_LLM_MODEL ?? "llama3.2",
      messages: [{ role: "user", content: prompt }],
      format: "json",
      stream: false,
    }),
  }, 25000); // local models are slower — generous timeout, still bounded
  const text = json?.message?.content;
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function geminiJson(prompt: string): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const json = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
      }),
    }, 15000);
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export async function llmJson(prompt: string): Promise<any | null> {
  return (await localJson(prompt)) ?? (await geminiJson(prompt));
}

export function llmStatus() {
  return {
    local: process.env.LOCAL_LLM_URL ?? null,
    localModel: process.env.LOCAL_LLM_URL ? (process.env.LOCAL_LLM_MODEL ?? "llama3.2") : null,
    gemini: !!process.env.GEMINI_API_KEY,
  };
}
