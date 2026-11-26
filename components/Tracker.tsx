"use client";

import { useEffect } from "react";
import { startTracking } from "@/lib/track";

// 모든 화면 공통: 로그 시작 (visit · login · exit). 화면에는 아무것도 안 그린다
export default function Tracker({ loggedIn }: { loggedIn: boolean }) {
  useEffect(() => { startTracking({ loggedIn }); }, [loggedIn]);
  return null;
}
