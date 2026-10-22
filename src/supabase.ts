import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const loginEmail = import.meta.env.VITE_LOGIN_EMAIL as
  string | undefined;
export const configured = Boolean(url && key && loginEmail);
export const supabase = createClient(
  url || "https://invalid.supabase.co",
  key || "missing",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
export async function invoke<T = unknown>(name: string, body: object = {}) {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (error.context instanceof Response) {
      const detail = await error.context
        .clone()
        .json()
        .catch(() => null);
      if (typeof detail?.error === "string")
        throw new Error(detail.error.replace(/^Error: /, ""));
    }
    throw error;
  }
  return data as T;
}
