import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const URL_ENV = Deno.env.get("SUPABASE_URL")!;
export const service = createClient(
  URL_ENV,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
export async function user(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) throw Error("No session");
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw Error("Unauthorized");
  return data.user;
}
export async function encrypted(value: string) {
  const key = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!key) throw Error("TOKEN_ENCRYPTION_KEY missing");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const k = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      k,
      new TextEncoder().encode(value),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...bytes));
}
export async function decrypted(value: string) {
  const key = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!key) throw Error("TOKEN_ENCRYPTION_KEY missing");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const k = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "decrypt",
  ]);
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12) },
      k,
      raw.slice(12),
    ),
  );
}
export async function googleToken(uid: string) {
  const { data } = await service
    .from("connections")
    .select("google_refresh_token")
    .eq("user_id", uid)
    .single();
  if (!data?.google_refresh_token) throw Error("Google Calendar не подключен");
  const refresh = await decrypted(data.google_refresh_token);
  const form = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error_description || "Google token error");
  return result.access_token as string;
}
export async function google(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Error(`Google Calendar ${r.status}: ${await r.text()}`);
  return r.status === 204 ? {} : r.json();
}
