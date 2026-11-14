// server/gateway/models.ts
var DEFAULT_MODEL = "drex-max-v1.1";
var MODEL_OVERRIDES = {
  // voice_leading: 'drex-v2.0',
};
function modelFor(callType, hasImages = false) {
  const base = (process.env.DREX_MODEL ?? "").trim() || DEFAULT_MODEL;
  if (hasImages) return base.startsWith("drex-max") ? base : DEFAULT_MODEL;
  const env = process.env[`DREX_MODEL_${callType.toUpperCase()}`];
  return env && env.trim() || MODEL_OVERRIDES[callType] || base;
}

// server/gateway/gateway.ts
var HOSTS = ["https://console.nace.ai/v1/systemone", "https://drex.nace.ai/v1/systemone"];
var hostIndex = 0;
var apiUrl = () => (process.env.DREX_API_URL ?? "").trim().replace(/^["']|["']$/g, "") || HOSTS[hostIndex];
function apiKey() {
  const k = (process.env.NACE_API_KEY ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return k.startsWith("nace_sk_") ? k : null;
}

// server/vercel-health.ts
async function handler(_req, res) {
  const key = apiKey();
  const raw = (process.env.NACE_API_KEY ?? "").trim();
  const out = {
    keyFound: !!key,
    keyProblem: key ? null : raw ? "NACE_API_KEY is set but does not start with nace_sk_" : "NACE_API_KEY is not set for this deployment (add it in Project Settings, Environment Variables, then redeploy)",
    model: modelFor("setup"),
    tier: process.env.DREX_TIER ?? "(not set: free-tier pacing)",
    apiUrl: apiUrl()
  };
  if (key) {
    const hosts = [.../* @__PURE__ */ new Set([apiUrl(), "https://drex.nace.ai/v1/systemone"])];
    out.calls = [];
    for (const url of hosts) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelFor("setup"), state: "A test.", questions: { ok: { type: "noul", instructions: "Is this a test?" } } }),
          signal: AbortSignal.timeout(2e4)
        });
        const text = await r.text();
        out.calls.push({ url, status: r.status, ms: Date.now() - t0, reply: text.startsWith("{") ? text.slice(0, 200) : `not JSON (${text.slice(0, 60).replace(/\s+/g, " ")}\u2026)` });
      } catch (err) {
        out.calls.push({ url, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
      }
    }
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out, null, 2));
}
export {
  handler as default
};
