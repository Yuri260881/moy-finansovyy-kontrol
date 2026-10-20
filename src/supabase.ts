import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);
export const supabase = createClient(
  url || "https://invalid.supabase.co",
  key || "missing",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
export async function invoke<T = unknown>(name: string, body: object = {}) {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw error;
  return data as T;
}
