import { cors, json, user, service, encrypted } from "../_shared/core.ts";
const client = Deno.env.get("GOOGLE_CLIENT_ID")!,
  secret = Deno.env.get("GOOGLE_CLIENT_SECRET")!,
  redirect = Deno.env.get("GOOGLE_REDIRECT_URI")!;
async function sign(text: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HMAC",
    { hash: "SHA-256" },
    false,
    ["sign"],
  );
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)),
      ),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const u = new URL(req.url);
    if (u.pathname.endsWith("/callback")) {
      const code = u.searchParams.get("code"),
        state = u.searchParams.get("state");
      if (!code || !state) throw Error("Authorization declined");
      const [id, ts, nonce, sig] = state.split(".");
      if (
        !id ||
        !ts ||
        !nonce ||
        sig !== (await sign(`${id}.${ts}.${nonce}`)) ||
        Date.now() - Number(ts) > 600000
      )
        throw Error("Invalid OAuth state");
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          code,
          client_id: client,
          client_secret: secret,
          redirect_uri: redirect,
          grant_type: "authorization_code",
        }),
      });
      const x = await r.json();
      if (!r.ok || !x.refresh_token)
        throw Error(
          x.error_description ||
            "No refresh token. Revoke access and try again.",
        );
      const { error } = await service
        .from("connections")
        .update({
          google_refresh_token: await encrypted(x.refresh_token),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", id);
      if (error) throw error;
      const origin = Deno.env.get("APP_ORIGIN")!,
        base = Deno.env.get("APP_BASE_PATH") || "/";
      return Response.redirect(origin + base + "?google=connected", 302);
    }
    const person = await user(req);
    const ts = Date.now(),
      nonce = crypto.randomUUID().replaceAll("-", "");
    const raw = `${person.id}.${ts}.${nonce}`;
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      access_type: "offline",
      prompt: "consent",
      state: `${raw}.${await sign(raw)}`,
    });
    return json({
      url: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
    });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
