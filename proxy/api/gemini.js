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
  const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

  try {
    let lastData = null;
    for (const model of MODELS) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );
      const data = await r.json();
      const exhausted = r.status === 429 || data?.error?.status === "RESOURCE_EXHAUSTED";
      if (!exhausted) { res.status(200).json(data); return; }
      lastData = data;
    }
    res.status(429).json(lastData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
