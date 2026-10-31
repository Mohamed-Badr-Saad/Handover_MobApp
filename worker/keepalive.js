/* Plant Handover - Cloudflare Worker
   - Serves the app files (unchanged behaviour: every file comes from the assets).
   - Once a day (cron in wrangler.jsonc) calls the database's keepalive()
     function, so the free Supabase project never pauses after 7 days without use.
   Only the project URL and the PUBLISHABLE key are used - both are public. */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(wakeUp(env));
  }
};

export async function wakeUp(env) {
  const url = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/keepalive";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { apikey: env.SUPABASE_KEY, Authorization: "Bearer " + env.SUPABASE_KEY, "Content-Type": "application/json" },
        body: "{}"
      });
      const text = await res.text();
      console.log("keepalive attempt " + attempt + ": " + res.status + " " + text);
      if (res.ok) { return { ok: true, status: res.status, body: text }; }
    } catch (e) {
      console.log("keepalive attempt " + attempt + " failed: " + (e && e.message));
    }
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
  return { ok: false };
}
