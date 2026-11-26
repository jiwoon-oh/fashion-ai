import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
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

/**
 * 로그인한 사용자. 기본은 로그인 토큰(JWT)의 서명을 서버에서 바로 확인한다 (getClaims: 보통 DB·인증 서버에 안 물어봄 → 빠름).
 * strict 면 인증 서버에 직접 물어본다 (회원 탈퇴처럼 되돌릴 수 없는 작업용).
 */
export async function currentUser(opts: { strict?: boolean } = {}): Promise<User | null> {
  const sb = await sessionClient();
  if (!sb) return null;
  if (opts.strict) {
    const { data } = await sb.auth.getUser();
    return data.user ?? null;
  }
  const { data, error } = await sb.auth.getClaims();
  const c = data?.claims;
  if (error || !c?.sub) return null;
  // 이 앱이 쓰는 건 id·user_metadata 정도라 토큰 안의 값으로 User 모양을 만든다
  return {
    id: c.sub,
    email: c.email,
    phone: c.phone,
    aud: String(c.aud ?? "authenticated"),
    role: c.role,
    app_metadata: (c.app_metadata ?? {}) as User["app_metadata"],
    user_metadata: (c.user_metadata ?? {}) as User["user_metadata"],
    is_anonymous: c.is_anonymous,
    created_at: "",
  } as User;
}

// 점수·배틀 기록용. 비밀 키를 쓰므로 서버에서만. RLS 를 건너뛴다.
let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!SUPABASE_URL || !key) return null;
  return (admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
