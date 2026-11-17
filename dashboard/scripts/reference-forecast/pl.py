"""損益の仮定別の参考試算(9〜12月、A〜C)。予測の上限・下限ではない。

使い方: python3 -I pl.py <作業ディレクトリ> <前回の損益計算表(04_損益予測.csv)>
入力: 前回の計算表(2026-11-16、pl_forecast.pyの出力。freee試算表の実績・係数を含む)、sf_process.json(最新のSalesforce)
出力: pl_result.json

前回の計算表の9・10月(freeeの実績・帳簿)と係数(外注=SF原価×補正係数、粗利率)はそのまま使い、
11・12月の売上高と外注加工費だけを最新のSalesforce確定案件で計算し直す(資金の予測と同じ時点にそろえる)。
PDFの数値は使わない。
"""
import json, sys, csv, re

B, PREV = sys.argv[1], sys.argv[2]
sf = json.load(open(f"{B}/sf_process.json"))["result"]["records"]
OK = {"受注", "納品", "請求", "入金"}


def sfsum(m, field):
    return sum(r[field] or 0 for r in sf if (r["seikyuubi__c"] or "")[:7] == m and r["phase__c"] in OK and (r["juchukakudo__c"] or "").startswith("A"))


rows = list(csv.DictReader(open(PREV, encoding="utf-8-sig")))
num = lambda v: int(v) if v not in ("", None) else None
calib = gm = None
for r in rows:
    m1 = re.search(r"原価×([0-9.]+)", r["根拠"])
    m2 = re.search(r"粗利率([0-9.]+)%", r["根拠"])
    calib = calib or (float(m1.group(1)) if m1 else None)
    gm = gm or (float(m2.group(1)) / 100 if m2 else None)
assert calib and gm

SCN = {"A": "仕掛品の増減を0と置く", "B": "仕掛品が前年同月と同じだけ増減すると置く", "C": "売上×49期通期の粗利率"}
out = []
for r in rows:
    sid = r["シナリオ"][0]
    m = r["月"]
    rec = {k: num(r[k]) for k in ("売上高", "製造労務費", "外注加工費", "業務委託費", "その他製造経費", "総製造費用", "仕掛品増減", "売上原価", "粗利", "販管費", "営業外損益", "経常利益")}
    basis = r["根拠"]
    if m in ("2026-11", "2026-12"):
        rev = sfsum(m, "uriagegoukei__c")
        if sid in ("A", "B"):
            outs = sfsum(m, "genka_goukei__c") * calib
            total = rec["製造労務費"] + outs + rec["業務委託費"] + rec["その他製造経費"]
            cogs = total - rec["仕掛品増減"]
            gp = rev - cogs
            rec.update(売上高=round(rev), 外注加工費=round(outs), 総製造費用=round(total), 売上原価=round(cogs), 粗利=round(gp),
                       経常利益=round(gp - rec["販管費"] + rec["営業外損益"]))
        else:
            gp = rev * gm
            rec.update(売上高=round(rev), 粗利=round(gp), 経常利益=round(gp - rec["販管費"] + rec["営業外損益"]))
        basis += "／売上・外注は2026-11-17取得のSalesforceで再計算"
    out.append({"scenario": sid, "month": m, **{k: v for k, v in rec.items()}, "basis": basis})

res = {"scenarios": [], "coefficients": {"outsourcingPerSfCost": calib, "grossMargin49": gm}}
for sid, label in SCN.items():
    ms = [x for x in out if x["scenario"] == sid]
    res["scenarios"].append({"id": sid, "label": label, "months": ms,
                             "cumulative": {"売上高": sum(x["売上高"] for x in ms), "経常利益": sum(x["経常利益"] for x in ms)}})
json.dump(res, open(f"{B}/pl_result.json", "w"), ensure_ascii=False, indent=1)
for s in res["scenarios"]:
    print(s["id"], s["label"], f"9〜12月 売上 {s['cumulative']['売上高']:,} 経常 {s['cumulative']['経常利益']:,}", [f"{x['month'][5:]}月 {x['経常利益']:,}" for x in s["months"]])
