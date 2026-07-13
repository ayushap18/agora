// LLM tiers, all settings-driven (BYOK from the Settings page, env fallback):
//   local  — any Ollama-compatible endpoint
//   gemini — Google AI Studio key
//   hf     — Hugging Face router (OpenAI-compatible chat completions)
// llmJson chains local → gemini → hf → null; callers always carry a
// deterministic fallback, so a dead model can never block a round.
import { internal } from "./_generated/api";

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

// models often wrap JSON in prose/code fences — extract the first object
function parseLoose(text: string | undefined | null): any | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

type Cfg = { geminiKey: string | null; localUrl: string | null; localModel: string;
             hfToken: string | null; hfModel: string };

export async function getCfg(ctx: any): Promise<Cfg> {
  return await ctx.runQuery(internal.settings.getRaw, {});
}

export async function localJson(cfg: Cfg, prompt: string): Promise<any | null> {
  if (!cfg.localUrl) return null;
  const json = await fetchJson(`${cfg.localUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.localModel,
      messages: [{ role: "user", content: prompt }],
      format: "json", stream: false,
    }),
  }, 25000);
  return parseLoose(json?.message?.content);
}

export async function geminiJson(cfg: Cfg, prompt: string): Promise<any | null> {
  if (!cfg.geminiKey) return null;
  const json = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${cfg.geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
      }),
    }, 15000);
  return parseLoose(json?.candidates?.[0]?.content?.parts?.[0]?.text);
}

export async function hfJson(cfg: Cfg, prompt: string): Promise<any | null> {
  if (!cfg.hfToken) return null;
  const json = await fetchJson("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.hfToken}` },
    body: JSON.stringify({
      model: cfg.hfModel,
      messages: [
        { role: "system", content: "Reply with ONLY a JSON object, no prose." },
        { role: "user", content: prompt },
      ],
      max_tokens: 900, temperature: 0.8,
    }),
  }, 25000);
  return parseLoose(json?.choices?.[0]?.message?.content);
}

export async function llmJson(ctx: any, prompt: string): Promise<any | null> {
  const cfg = await getCfg(ctx);
  return (await localJson(cfg, prompt)) ?? (await geminiJson(cfg, prompt)) ?? (await hfJson(cfg, prompt));
}

export function tiersOf(cfg: Cfg) {
  return [
    cfg.localUrl ? { id: "local", label: `local · ${cfg.localModel}` } : null,
    cfg.geminiKey ? { id: "gemini", label: "gemini 2.0 flash" } : null,
    cfg.hfToken ? { id: "hf", label: `hf · ${cfg.hfModel.split("/").pop()}` } : null,
  ].filter(Boolean) as { id: string; label: string }[];
}
