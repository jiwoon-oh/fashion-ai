"""M2: 올해 유행어·밈 조사 결과(game_research/roast_mining/memes_2026/*.json)를 합치고 걸러서 lib/meme-bank.json 을 만든다.

- 조사 원본(출처 URL 포함)은 game_research/(gitignore)에만 두고, 커밋되는 은행에는 표현·뜻·말투 틀만 넣는다.
- 금지어(욕설·혐오·외모·정치)는 merge_bank.py 와 같은 기준으로 다시 검사한다.
- tools/roast_mining/curation.json 의 drop_memes 에 적은 표현은 뺀다 (사람 검수).
사용: python tools/roast_mining/merge_memes.py
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
SRC = ROOT / "game_research" / "roast_mining" / "memes_2026"
OUT = ROOT / "lib" / "meme-bank.json"
REPORT = ROOT / "game_research" / "roast_mining" / "meme_report.json"


def load_filter_module():
    spec = importlib.util.spec_from_file_location("filter_titles", HERE / "filter_titles.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s).lower()


def clean(s: object, n: int) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()[:n]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ft = load_filter_module()
    banned = [ft.EXCLUDE_RE["profanity"], ft.EXCLUDE_RE["hate"], ft.EXCLUDE_RE["body"],
              re.compile(r"대통령|윤석열|이재명|한동훈|국힘|민주당|북한|전쟁|사망|살인|자살|자해|마약|섹스|야동")]
    cur = HERE / "curation.json"
    drop = set()
    if cur.exists():
        drop = {norm(d["phrase"]) for d in json.loads(cur.read_text(encoding="utf-8")).get("drop_memes", [])}

    memes: dict[str, dict] = {}
    rejected = Counter()
    per_file = {}
    for f in sorted(SRC.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            rejected["bad_json_file"] += 1
            continue
        kept = 0
        for it in d.get("items", []):
            phrase = clean(it.get("phrase"), 40)
            meaning = clean(it.get("meaning"), 80)
            template = clean(it.get("template"), 50)
            angle = clean(it.get("fashion_angle"), 60)
            if not phrase or not meaning:
                rejected["empty"] += 1
                continue
            if str(it.get("risk", "none")).strip() not in ("none", "low"):
                rejected["risk"] += 1
                continue
            blob = " ".join([phrase, meaning, template, angle])
            if any(rx.search(blob) for rx in banned):
                rejected["banned_word"] += 1
                continue
            key = norm(phrase)
            if key in drop:
                rejected["curation"] += 1
                continue
            if key in memes:
                memes[key]["seen"] += 1
                continue
            memes[key] = {"phrase": phrase, "meaning": meaning, "template": template, "example": angle if len(angle) <= 35 else "", "topic": d.get("topic", f.stem), "seen": 1}
            kept += 1
        per_file[f.name] = kept

    items = sorted(memes.values(), key=lambda m: (-m["seen"], m["topic"], m["phrase"]))
    bank = {
        "version": "meme-bank-1",
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "tools/roast_mining/merge_memes.py ← 2025-2026 유행어·밈 조사 (출처는 game_research/ 에만)",
        "rules": "옷과 안목만 놀릴 때 자연스러우면 섞어 씀. 욕설·혐오·외모·나이·성별·가난·정치·실존 인물 제외",
        "memes": [{k: m[k] for k in ("phrase", "meaning", "template", "example")} for m in items],
    }
    OUT.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    report = {"kept": len(items), "per_file": per_file, "rejected": dict(rejected)}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
