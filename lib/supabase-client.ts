import { createBrowserClient } from "@supabase/ssr";
import { fetchWithTimeout, supabaseAnonKey, supabaseUrl } from "./supabase-env";

// 瀏覽器端 client（client component 用）。不 import next/headers。
export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchWithTimeout },
  });
}
