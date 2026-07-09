const ALLOWED_ORIGINS = [
  "https://rezkysaid.github.io",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  if (!isAllowedOrigin(origin)) { res.status(403).json({ error: "Forbidden origin" }); return; }

  const { prompt } = req.body || {};
  if (!prompt) { res.status(400).json({ error: "Missing prompt" }); return; }

  // Try flash first; if its free-tier quota is exhausted, fall back to
  // flash-lite, which has higher free rate limits.
  const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

  try {
    let lastData = null;
    let lastStatus = 429;
    for (const model of MODELS) {
      // Gemini 3.x uses thinkingLevel ("low" = minimal); Gemini 2.5 uses
      // thinkingBudget (0 = off). Sending the wrong one is a 400, so pick
      // per model. Keep thinking minimal for a snappy, Google-Translate feel.
      const thinkingConfig = model.startsWith("gemini-3")
        ? { thinkingLevel: "low" }
        : { thinkingBudget: 0 };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 4096, temperature: 0.8, thinkingConfig },
          }),
        }
      );
      const data = await r.json();
      // Fall through to the next model not only when the free quota is
      // exhausted, but also when a model is retired/unavailable (e.g. a
      // future Gemini deprecation) so one dead model can't hard-fail the app.
      const status = data?.error?.status;
      const exhausted = r.status === 429 || status === "RESOURCE_EXHAUSTED";
      const unavailable =
        r.status === 404 ||
        status === "NOT_FOUND" ||
        /no longer available|not found|is not supported|deprecated/i.test(data?.error?.message || "");
      if (!exhausted && !unavailable) { res.status(200).json(data); return; }
      lastData = data;
      lastStatus = exhausted ? 429 : 502;
    }
    res.status(lastStatus).json(lastData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
