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

// NOTE: the route is still /api/gemini for backward compatibility — three
// frontends (Muraqabah, Translations, PromptCraft) hardcode this URL. The
// engine underneath is now DeepSeek V4 (paid) instead of Gemini free, to dodge
// the constant free-tier "high demand" rate limiting. We keep the response in
// the Gemini shape so none of the callers need to change.
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

  // Guard the upstream call with our own timeout so a slow response returns a
  // clean JSON error (with CORS headers) instead of letting the platform kill
  // the function, which reaches the browser as an opaque "Load failed".
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);

  try {
    let r, data;
    try {
      r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          max_tokens: 4096,
          // Non-thinking mode: snappy, Google-Translate feel — we don't need a
          // visible reasoning pass for rewriting/summarising prompts.
          thinking: { type: "disabled" },
          stream: false,
        }),
        signal: ac.signal,
      });
      data = await r.json();
    } catch (err) {
      clearTimeout(timer);
      res.status(503).json({ error: { message: "AI lambat sangat sekejap ni, cuba lagi ya." } });
      return;
    }
    clearTimeout(timer);

    if (!r.ok || data?.error) {
      const msg = data?.error?.message || "AI tak dapat jawab sekejap ni, cuba lagi.";
      res.status(r.status && r.status >= 400 ? r.status : 502).json({ error: { message: msg } });
      return;
    }

    // Adapt DeepSeek's OpenAI-shaped reply to the Gemini shape the callers
    // already parse (`candidates[0].content.parts[0].text`).
    const text = data?.choices?.[0]?.message?.content || "";
    res.status(200).json({ candidates: [{ content: { parts: [{ text }] } }] });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
}
