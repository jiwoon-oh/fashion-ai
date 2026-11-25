import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, authConfigured } from "./config";

// 로그인한 사용자를 쿠키로 확인하는 클라이언트 (Route Handler / Server Component 용)
export async function sessionClient() {
  if (!authConfigured()) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Component 안에서는 쿠키를 못 쓴다. proxy.ts 가 대신 갱신한다.
        }
      },
    },
  });
}

export async function currentUser() {
  const sb = await sessionClient();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

// 점수·배틀 기록용. 비밀 키를 쓰므로 서버에서만. RLS 를 건너뛴다.
let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !key) return null;
  return (admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
