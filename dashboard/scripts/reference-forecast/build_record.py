"""資金・損益の参考予測の保存用記録(JSON)を組み立てる。金額は円のまま持ち、万円への換算は画面で行う。

使い方: python3 -I build_record.py <作業ディレクトリ> <assumptions.json> <出力ファイル> <コードのコミット> [--carry-from <旧record.json>]
入力: cash_result.json(engine.py)、match_summary.json(match.py)、pl_result.json(pl.py)、freee.json・sf_process.jsonの取得日時
--carry-from: 損益(pl)・納税賞与の支払見込額(paymentReserve)・資金サマリーの控除額と準備額(monthEndReserve)を旧記録から
  そのまま引き継ぐ(再計算しない、2026-11-18)。このとき pl_result.json は不要
取引先名・個人名・口座番号は含めない(件数・金額の集計だけ)。
"""
import json, sys, os, datetime

B, ASSUME, OUT, COMMIT = sys.argv[1:5]
CARRY = json.load(open(sys.argv[sys.argv.index("--carry-from") + 1])) if "--carry-from" in sys.argv else None
A = json.load(open(ASSUME))
cash = json.load(open(f"{B}/cash_result.json"))
match = json.load(open(f"{B}/match_summary.json"))
pl = None if CARRY else json.load(open(f"{B}/pl_result.json"))
JST = datetime.timezone(datetime.timedelta(hours=9))
mtime = lambda p: datetime.datetime.fromtimestamp(os.path.getmtime(p), JST).isoformat(timespec="seconds")
now = datetime.datetime.now(JST)

man = lambda v: f"{v / 10000:,.0f}万円"
chk = cash["checks"]
pay12 = chk["payroll"]["2026-12"]
bulk_ref = "、".join(f"{r['date'][5:].replace('-', '/')} 一括振込{man(r['bulk'])}／同日の外注・一般経費の支払{man(r['bulkClassesTotal'])}" for r in chk["bulkReference"])
amb_hold = match["by_class"].get("判定保留(曖昧)", {"count": 0, "amount": 0})
start = cash["startBalances"]

record = {
    "schemaVersion": 1,
    "id": f"{cash['baseDate']}_{now.strftime('%Y%m%dT%H%M%S')}",
    "baseDate": cash["baseDate"],
    "createdAt": now.isoformat(timespec="seconds"),
    "createdBy": "scripts/reference-forecast(ローカル実行)",
    "codeCommit": COMMIT,
    "dataFetchedAt": {"freee": mtime(f"{B}/freee.json"), "salesforce": mtime(f"{B}/sf_process.json")},
    "cash": {
        "startBalance": start["当座普通"],
        "startTimeDeposit": start["定期"],
        "startCash": start["現金"],
        "cases": [{"id": c["id"], "label": c["label"],
                   "months": [{k: m[k] for k in ("month", "start", "end", "minEndOfDay", "minIntraday", "byBasis", "byCategory")} for m in c["months"]]}
                  for c in cash["cases"]],
        "dec31Receipts": cash["dec31Receipts"],
        "checks": {"ownTransfers": chk["ownTransfers"], "excludedFromBulk": chk["excludedFromBulk"], "bulkReference": chk["bulkReference"],
                   "payrollDecember": pay12, **({"adjustments": chk["adjustments"]} if "adjustments" in chk else {})},
    },
    "matching": {
        "byClass": [{"label": k, "count": v["count"], "amount": v["amount"]} for k, v in match["by_class"].items()],
        "ambiguous": match["ambiguous"],
        "freeeUnmatchedUnsettled": match["freee_unmatched_unsettled"],
    },
    "pl": CARRY["pl"] if CARRY else {
        "scenarios": [{"id": s["id"], "label": s["label"],
                       "months": [{"month": x["month"], "revenue": x["売上高"], "grossProfit": x["粗利"], "ordinaryProfit": x["経常利益"],
                                   "wipChange": x.get("仕掛品増減"), "basis": x["basis"]} for x in s["months"]],
                       "cumulative": {"revenue": s["cumulative"]["売上高"], "ordinaryProfit": s["cumulative"]["経常利益"]}}
                      for s in pl["scenarios"]],
    },
    "notes": {
        "basis": [
            f"起点（{cash['baseDate']}）の当座・普通預金は{man(start['当座普通'])}。{A['base_balances']['_根拠']}",
            "登録済み：freeeの未決済の売上・支払（基準日時点。基準日より後の決済は戻して数えた）と、11月の給与明細（勤怠反映済み・未確定）の振込額",
            "SF予定：freeeに未登録で、Salesforceに入金予定日があるもの。SF補完：入金予定日が空欄・請求日より前のものを請求翌月末で補ったもの（標準の12月だけに含める）",
            "過去明細（定例）：8〜11月の銀行明細の摘要と日付から置いた定例の出金（PDFの数値は使っていない）",
            f"自社振替：同日・同額・入出金が逆・別口座で、freeeの振替記録（振替元・振替先の口座が一致）があるものだけを除外。11/1〜16は確認済み{chk['ownTransfers'].get('confirmed', 0)}件・保留{chk['ownTransfers'].get('pending', 0)}件（保留は出金のまま残す）",
            f"月末一括振込：過去の一括振込は外注・一般経費の支払で構成されていた（{bulk_ref}）。未登録分は、同じ支払分類（外注・一般経費）の登録済み支払だけを差し引いて推計し、借入返済・税・社会保険は差し引かない",
            f"入金照合：Salesforce確定案件（確度A・請求日10/1以降）をfreeeの売上取引と取引先・請求月・金額で照合。取引先名が部分一致でしか見つからないもの、別の月に照合されていない同額のfreee取引があるものは「判定保留（曖昧）」として予測に加えない（{amb_hold['count']}件・{man(amb_hold['amount'])}）",
        ],
        "estimates": [
            f"12月の給与：freeeの12月給与明細は{pay12['count']}件あるが、全件未確定で{pay12['calculatedAt']}に計算された下書き（勤怠期間の前で勤怠・経費精算が未反映）。振込額{man(pay12['transfer'])}を推計として使い、明細と振込の差を標準25万円・慎重286万円（前年12月の差）と置く",
            "12月の賞与：12月の賞与明細が未作成のため、前年12/5の賞与振込額（慎重は＋10%）を12/4に置く",
            "月末一括振込の未登録分：標準は8〜10月の平均、慎重は11月が最大・12月が前年12/30の年末一括振込を使う",
            "12/10前後の出金：11/1〜16の銀行出金（社会保険・労働保険・借入返済・積立・自社振替を除く）を流用",
            f"年末：標準・慎重は12/31予定の入出金を12/30に寄せる。「年末入金が翌年へずれる」は12/31予定の入金（Salesforce {man(cash['dec31Receipts']['sfAddedStandardKinds'])}・freee {man(cash['dec31Receipts']['freeeUnsettled'])}）を1/4に回す",
        ],
        "limits": [
            "ケースの違いは、確認した条件を置き換えた比較であり、未把握の支出や入金の遅れを含む予測誤差の範囲ではない",
            "同じ取引先・同じ月に同額の案件が複数あるとき、どのfreee取引と対応するかは件数で割り当てている（判定の合計額は変わらない）",
            "日末残高は同じ日の入金と出金の順序に依存しない。同じ日に出金が先に起きた場合の最低は詳細の数値を参照",
            "損益のA〜Cは、仕掛品の扱いの仮定を変えた参考試算で、予測の上限・下限ではない。A・Bは完成する案件の仕掛品の取り崩し（12月の利益を下げる方向）を十分に反映できていない",
            "PDF（経理報告・資金繰り表）の数値は計算に使っていない",
        ],
    },
}

# ---------- 2026-11-18 の仮定・調整(engine.py の adjustments)を注記に反映し、引き継いだ値を付ける ----------
adj = chk.get("adjustments")
if adj:
    std = adj["byCase"]["standard"]
    cau = adj["byCase"]["cautious"]
    gb, gp, it = adj["generalBulk"], adj["payrollGap"], adj["interest"]
    parts = "、".join(f"{b['date'][5:].replace('-', '/')} {man(b['bulk'])}＝外注{man(b['gaichu'])}＋一般{man(b['general'])}" for b in adj["bulkParts"])
    r11 = std["reimbursement_2026-11"]
    notes = record["notes"]
    notes["basis"] = [x for x in notes["basis"] if not x.startswith("月末一括振込：")] + [
        f"月末一括振込：一般経費と外注に分けて推計し、それぞれ同じ分類の登録済み支払だけを差し引く（{parts}）",
        f"経費精算：給与明細の振込額に含まれる（明細の振込額＝銀行の給与振込）。11/25期日で登録済みの経費精算{man(r11['registered'])}は明細の経費精算{man(r11['statementExpense'])}と同額のため、給与と重複させない",
        "12/10前後の推計：11/1〜16の取引先への振込のうち、10/31（土）期日の外注を11/2に払った分（" + "、".join(man(x["amount"]) for x in std["decEarlyCarryoverExcluded"]) + "）は12月に繰り返さないため除く",
    ]
    notes["estimates"] = [x for x in notes["estimates"] if not x.startswith("月末一括振込の未登録分")] + [
        f"一般経費（月末一括振込の未登録分）：8〜10月の一括振込のうち外注以外の平均{man(gb['mean'])}（慎重は最大{man(gb['max'])}）−登録済みの一般経費",
        f"外注（月末）：11月は登録済みのみ（慎重は未登録外注{man(adj['unregisteredGaichu']['amount'])}を11月末に加え、12/10前後の推計から同額を引く）。12月は8〜10月の月末期日の外注の平均{man(adj['gaichuMonthEndMean'])}−登録済み（慎重は前年12/30の年末一括振込−一般経費の最大）",
        f"給与振込と明細の差：8〜10月の平均{man(gp['mean'])}（慎重は最大{man(gp['max'])}）を11月に加える",
        f"当座貸越の利息：8〜10月の月末の引落の平均{man(it['mean'])}（慎重は最大）を11/30・12/30に置く",
    ]
    notes["estimates"] = notes["estimates"] + [
        "仮定（確定情報ではない）：Salesforceの追加分のうち、請求日と入金予定日が同じ11/30の2件（" + "、".join(man(x["amount"]) for x in std.get("sfMoved", [])) + "）は、同じ取引先の過去の入金に合わせて請求の翌月末（12/31）に入金と置く。移動先の月に同じ取引先の同額のfreee取引が無いことを確認（12月の入金と二重に数えない）",
        "仮定（確定情報ではない）：電子債権で決済する取引先の11/30期日の売上（" + "、".join(man(x["amount"]) for x in std.get("notes", [])) + "）は、過去5回と同じく期日前後に電子債権で受け取り、約2か月後（2027年1月）に現金化すると置き、予測期間に入れない",
        "慎重の仮定：月末期日の入金を29日遅れた実績と期日超過の未入金がある取引先の11/30期日分（" + man(sum(x["amount"] for x in cau.get("lateSlip", []))) + "）を12/29へずらす",
        f"慎重の仮定：{adj['unregisteredGaichu']['basis']}の{man(adj['unregisteredGaichu']['amount'])}を11月末に支払う",
        "年末入金が翌年へずれるケース：12/31予定の入金（12月へ移したSalesforceの2件を含む）を翌年に回す",
    ]
    notes["limits"] = notes["limits"] + ["損益・納税賞与の支払見込額・控除額と準備額は、旧記録の値を引き継いでいる（今回は再計算していない。準備額の計算方法も変えていない）"]
if CARRY:
    record["carriedFrom"] = CARRY["id"]
    for f in ("paymentReserve", "monthEndReserve"):
        if f in CARRY:
            record[f] = CARRY[f]
os.umask(0o077)
json.dump(record, open(OUT, "w"), ensure_ascii=False, indent=1)
print(record["id"], f"{os.path.getsize(OUT):,} bytes")
