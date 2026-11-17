"""既存の予測記録に「納税・賞与の支払準備(参考)」を付けた新しい記録を作る(元の記録は書き換えない、2026-11-17)。

使い方: python3 -I attach_reserve.py <元のrecord.json> <追加するJSON> <出力ファイル> <コードのコミット> [項目名=paymentReserve]
項目名: paymentReserve(支払見込額) / monthEndReserve(資金サマリーの控除額・準備額、month_end_reserve.py の出力)
資金・損益・照合の値は元の記録のまま引き継ぎ(再計算しない)、derivedFrom に資金予測を計算した記録のIDを残す。
"""
import json, sys, os, datetime

SRC, RES, OUT, COMMIT = sys.argv[1:5]
FIELD = sys.argv[5] if len(sys.argv) > 5 else "paymentReserve"
if FIELD not in ("paymentReserve", "monthEndReserve"):
    raise SystemExit(f"項目名が不正です: {FIELD}")
os.umask(0o077)
JST = datetime.timezone(datetime.timedelta(hours=9))
now = datetime.datetime.now(JST)
rec = json.load(open(SRC))
reserve = json.load(open(RES))
new = dict(rec)
new["id"] = f"{rec['baseDate']}_{now.strftime('%Y%m%dT%H%M%S')}"
new["createdAt"] = now.isoformat(timespec="seconds")
new["codeCommit"] = COMMIT
# 引き継いだ記録から更に作るときも、資金予測を計算した元の記録を指す
new["derivedFrom"] = rec.get("derivedFrom", rec["id"])
# 資金予測を計算した日時(画面の「計算日時」)。引き継いだ記録では元の記録の作成日時
new["cashComputedAt"] = rec.get("cashComputedAt", rec["createdAt"])
new[FIELD] = reserve
if os.path.exists(OUT):
    raise SystemExit(f"{OUT} は既にあります(上書きしません)")
json.dump(new, open(OUT, "w"), ensure_ascii=False, indent=1)
print(new["id"])
