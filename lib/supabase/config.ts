// Supabase 화면의 "API URL"(…/rest/v1)을 넣는 실수가 잦아서, 뒤에 붙은 경로·슬래시·공백을 떼고 쓴다
export const normalizeSupabaseUrl = (v: string | undefined) =>
  (v ?? "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");

export const SUPABASE_URL = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_PUBLISHABLE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
export const authConfigured = () => Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
