// 로그 이벤트 이름 목록 (docs/log-design-otbbal.md). 브라우저(lib/track.ts)와 서버(/api/log)가 같이 쓴다.
// 새 이벤트를 만들면 여기와 문서를 같이 고친다.

export const COMMON_EVENTS = ["visit", "stage_enter", "first_play", "play", "replay", "share", "exit"] as const;

export const OTBBAL_EVENTS = [
  "photo_upload",
  "battle_start",
  "score_done",
  "share_open",
  "room_create",
  "room_open",
  "room_result",
  "login_prompt",
  "login",
  "ranking_view",
  "ranking_register",
  "friends_view",
  "setting_change",
] as const;

export type EventName = (typeof COMMON_EVENTS)[number] | (typeof OTBBAL_EVENTS)[number];

export const APPS = ["otbbal", "dolsu"] as const;
export type App = (typeof APPS)[number];

/** 옷빨은 목록에 있는 이름만, 돌수제비는 공통 + 형식(snake_case)만 맞으면 받는다 */
export function allowedEvent(app: App, name: string): boolean {
  if ((COMMON_EVENTS as readonly string[]).includes(name)) return true;
  if (app === "otbbal") return (OTBBAL_EVENTS as readonly string[]).includes(name);
  return /^[a-z][a-z0-9_]{1,39}$/.test(name);
}
