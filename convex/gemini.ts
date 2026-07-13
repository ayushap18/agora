// Direct Gemini REST — no SDK. Runs in Convex's default runtime (fetch is built in).
// Returns parsed JSON or null on ANY failure;
// callers must always have a deterministic fallback.
export async function geminiJson(prompt: string): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
        }),
      }
    );
    if (!r.ok) return null;
    const json = await r.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
