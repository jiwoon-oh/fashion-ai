"""R4: 하위 에이전트 결과(agent_out/*.json)를 합치고 검증해서 lib/roast-bank.json 을 만든다.

검증: 35자 이하, 금지어(욕설·혐오·외모·정치) 재검사, 스타일 이름 확인, 기존 예시·서로 간 중복 제거.
사용: python tools/roast_mining/merge_bank.py
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = ROOT / "game_research" / "roast_mining"
BANK = ROOT / "lib" / "roast-bank.json"
MAX_LEN = 35

STYLES = [
    "짧고 직관적인 조롱", "걱정하는 척 긁기", "칭찬하는 척 조롱", "과장형 조롱", "AI 챗봇이라서 가능한 멘트",
    "뉴스·공문체", "리뷰·별점체", "반전 한 방", "단호한 명령형", "감성 나레이션체",
    # 1회차 NEW 스타일 중 사용자 승인분 (2026-11-26). lib/roaster.ts ROAST_STYLES 와 같이 맞춘다
    "의문형 떠보기", "다수 동조 압박체", "사과문체",
    # 옛날 예능 자막 말투 12종 (2026-11-26 사용자 요청)
    "제작진 속마음 자막체", "~하는 중 상황요약체", "효과음 자막체", "별명 붙이기 자막체", "모르면서 아는 척 자막체", "※주의 경고 자막체", "특집 제목 패러디체", "자막 정정·삭제 요청체", "뜬금 유행어 끼워넣기체", "카메라 줌인 설명체", "회상 장면·자료화면체", "결과 발표 구분 박스체",
]
CATEGORIES = {"돌려까기", "조롱", "순수비난"}


def load_filter_module():
    spec = importlib.util.spec_from_file_location("filter_titles", HERE / "filter_titles.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s)


def existing_examples() -> set[str]:
    out: set[str] = set()
    for f in (ROOT / "lib" / "roaster.ts", ROOT / "lib" / "scoring.ts"):
        if f.exists():
            out |= {norm(m) for m in re.findall(r'"([^"\n]{2,60})"', f.read_text(encoding="utf-8"))}
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ft = load_filter_module()
    # 한줄평 검사는 제목 검사보다 넓게: 뉴스 단어(기자·사고 등)는 공문체 한줄평에 쓰일 수 있어 정치·실존인물만 본다
    banned = [ft.EXCLUDE_RE["profanity"], ft.EXCLUDE_RE["hate"], ft.EXCLUDE_RE["body"],
              re.compile(r"대통령|윤석열|이재명|한동훈|국힘|민주당|북한|전쟁|사망|살인")]

    files = sorted((BASE / "agent_out").glob("batch_*.json"))
    seen = existing_examples()
    cur = HERE / "curation.json"
    if cur.exists():  # R4b 사람 검수로 뺀 문장
        seen |= {norm(d["text"]) for d in json.loads(cur.read_text(encoding="utf-8")).get("drop_lines", [])}
    styles: dict[str, list[str]] = {s: [] for s in STYLES}
    needs_review: list[dict] = []
    patterns: dict[str, dict] = {}
    rejected = Counter()

    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            rejected["bad_json_file"] += 1
            continue
        for p in d.get("patterns", []):
            tpl = str(p.get("template", "")).strip()
            cat = str(p.get("category", "")).strip()
            if not tpl or cat not in CATEGORIES or any(rx.search(tpl) for rx in banned):
                rejected["pattern_invalid"] += 1
                continue
            key = norm(tpl)
            if key in patterns:
                patterns[key]["seen"] += int(p.get("seen", 1) or 1)
            else:
                patterns[key] = {"category": cat, "template": tpl[:40], "how": str(p.get("how", "")).strip()[:60], "seen": int(p.get("seen", 1) or 1)}
        for ln in d.get("lines", []):
            text = re.sub(r"\s+", " ", str(ln.get("text", ""))).strip().strip('"')
            style = str(ln.get("style", "")).strip()
            if not text:
                continue
            if len(text) > MAX_LEN:
                rejected["too_long"] += 1
                continue
            if any(rx.search(text) for rx in banned):
                rejected["banned_word"] += 1
                continue
            key = norm(text)
            if key in seen:
                rejected["duplicate"] += 1
                continue
            seen.add(key)
            if style.startswith("NEW:") and style[4:].strip() in styles:  # 승인된 NEW 스타일은 정식 스타일로
                style = style[4:].strip()
            if style in styles:
                styles[style].append(text)
            elif style.startswith("NEW:"):
                needs_review.append({"style": style, "text": text})
            else:
                rejected["unknown_style"] += 1

    pat_list = sorted(patterns.values(), key=lambda p: (-p["seen"], p["category"], p["template"]))
    bank = {
        "version": "roast-bank-1",
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "tools/roast_mining (R1 제목 수집 → R2 거르기 → R3 하위 에이전트 → R4 검증). 원문 제목은 포함하지 않음",
        "rules": "옷과 안목만 놀림. 육두문자·혐오·외모·나이·성별·가난·정치 제외. 35자 이내",
        "styles": styles,
        "patterns": pat_list,
        "needs_review": needs_review,
    }
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    report = {
        "agent_files": [f.name for f in files],
        "lines_by_style": {k: len(v) for k, v in styles.items()},
        "lines_total": sum(len(v) for v in styles.values()),
        "patterns": len(pat_list),
        "patterns_by_category": dict(Counter(p["category"] for p in pat_list)),
        "needs_review": len(needs_review),
        "rejected": dict(rejected),
    }
    BASE.mkdir(parents=True, exist_ok=True)
    (BASE / "merge_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
