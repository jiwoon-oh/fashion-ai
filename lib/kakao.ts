"use client";

// 카카오톡 공유 (Kakao JavaScript SDK). JavaScript 키는 공개용 키라 브라우저에 들어가도 된다.
const SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js";
const SDK_INTEGRITY = "sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w";
export const KAKAO_JS_KEY = (process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "").trim();

type KakaoSdk = {
  isInitialized(): boolean;
  init(key: string): void;
  Share: { sendDefault(settings: Record<string, unknown>): void };
};
declare global {
  interface Window { Kakao?: KakaoSdk }
}

let loading: Promise<KakaoSdk | null> | null = null;

// 공유창이 열릴 때 미리 불러 둔다 (버튼 누른 순간 바로 카톡이 열리게)
export function preloadKakao(): Promise<KakaoSdk | null> {
  if (!KAKAO_JS_KEY || typeof window === "undefined") return Promise.resolve(null);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const ready = () => {
      const k = window.Kakao;
      if (!k) return resolve(null);
      try {
        if (!k.isInitialized()) k.init(KAKAO_JS_KEY);
        resolve(k);
      } catch {
        resolve(null);
      }
    };
    if (window.Kakao) return ready();
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.integrity = SDK_INTEGRITY;
    s.crossOrigin = "anonymous";
    s.async = true;
    s.onload = ready;
    s.onerror = () => { loading = null; resolve(null); };
    document.head.append(s);
  });
  return loading;
}

export function kakaoShare(opts: { title: string; description: string; url: string; imageUrl: string; buttonTitle: string }): boolean {
  const k = window.Kakao;
  if (!k || !k.isInitialized()) return false;
  const link = { mobileWebUrl: opts.url, webUrl: opts.url };
  k.Share.sendDefault({
    objectType: "feed",
    content: { title: opts.title, description: opts.description, imageUrl: opts.imageUrl, link },
    buttons: [{ title: opts.buttonTitle, link }],
  });
  return true;
}
