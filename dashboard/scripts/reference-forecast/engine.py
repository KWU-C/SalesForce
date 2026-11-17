"""資金の参考予測(11〜12月、日別)。出来事一覧1つから、日別残高・根拠別・分類別の内訳を作る。

使い方: python3 -I engine.py <作業ディレクトリ> <assumptions.json>
入力: freee.json(fetch_freee.pyで取得)、sf_events.json(match.pyの出力)、assumptions.json(金額の仮定。Gitに入れない)
出力: cash_result.json(画面・保存用の集計)、daily.csv(日別の出来事と残高)
取引先名・個人名・口座番号は出力しない。

2026-11-16 の確認用資料(engine2.py)からの変更(2026-11-17、レビュー指摘への対応):
1. 自社振替: 同日・同額・入出金が逆・別口座に加えて、freeeの振替記録(振替元・振替先の口座が一致)で
   裏付けられたものだけを振替とする。裏付けの無いものは「保留」とし、振替として除外しない(出金のまま残す)
2. 一括振込の未登録分: 過去の一括振込と同じ支払分類(外注・一般経費)の登録済み支払だけを差し引く。
   借入返済・税・社会保険は、一括振込に含まれないため差し引かない
3. 給与: 給与明細の値はfreee人事労務から読み、明細の状態(確定・勤怠の反映)で根拠の表示を分ける。
   12月は11/6計算の下書き(未確定・勤怠と経費精算が未反映)のため「推計」と表示する
4. 年末: 標準・慎重に加え、12/31予定の入金が翌年にずれるケースを出す
"""
import json, sys, csv, collections, statistics as st

B = sys.argv[1]
A = json.load(open(sys.argv[2]))
BASE = A["base_date"]
F = json.load(open(f"{B}/freee.json"))
SF = json.load(open(f"{B}/sf_events.json"))
acc = {a["id"]: a["name"] for a in F["account_items"]}
BANK = [t for t in F["wallet_txns"] if t["walletable_type"] == "bank_account" and t["date"] <= BASE]
TRANSFERS = F["transfers"]
R = A["recurring_from_bank"]
D = A["december"]


# ---------- 基準日時点の取引の状態(基準日より後の決済を戻す) ----------
def asof(deal):
    later = sum(p["amount"] for p in deal.get("payments", []) if p["date"] > BASE)
    return deal["due_amount"] + later


# ---------- 1. 自社振替 ----------
def own_transfer(t):
    """'confirmed'(振替記録で裏付け) / 'pending'(同日同額の反対取引はあるが記録で裏付けられない) / None"""
    pair = [u for u in BANK if u["id"] != t["id"] and u["date"] == t["date"] and u["amount"] == t["amount"]
            and u["entry_side"] != t["entry_side"] and u["walletable_id"] != t["walletable_id"]]
    if not pair:
        return None
    for u in pair:
        src, dst = (t, u) if t["entry_side"] == "expense" else (u, t)
        if any(x["date"] == t["date"] and x["amount"] == t["amount"] and x["from_walletable_id"] == src["walletable_id"]
               and x["to_walletable_id"] == dst["walletable_id"] for x in TRANSFERS):
            return "confirmed"
    return "pending"


# ---------- 2. 支払分類 ----------
TAX_SOCIAL = ("法定福利費", "預り金", "租税公課", "未払法人税", "未払消費税", "未払費用")


def pay_class(deal):
    names = [acc.get(x["account_item_id"], "") for x in deal["details"]]
    if any("借入" in n for n in names):
        return "借入返済"
    if names and all(any(k in n for k in TAX_SOCIAL) for n in names):
        return "税・社会保険"
    if any("外注" in n for n in names):
        return "外注"
    return "一般経費"


BULK_CLASSES = ("外注", "一般経費")  # 過去の月末一括振込に含まれる支払分類(下の bulk_reference で確かめる)


def bulk_reference():
    """過去の月末一括振込(銀行明細)と、同日・同口座で決済された支払の分類別合計"""
    out = []
    for amt in R["month_end_bulk_transfers_aug_oct"]:
        t = next((t for t in BANK if t["amount"] == amt and t["entry_side"] == "expense"), None)
        if not t:
            continue
        by = collections.Counter()
        for dl in F["deals_expense_hist"]:
            for p in dl.get("payments", []):
                if p["date"] == t["date"] and p.get("from_walletable_id") == t["walletable_id"]:
                    by[pay_class(dl)] += p["amount"]
        out.append({"date": t["date"], "bulk": amt, "byClass": dict(by),
                    "bulkClassesTotal": sum(by[c] for c in BULK_CLASSES)})
    return out


# ---------- 3. 給与明細 ----------
def payroll(month):
    L = F["hr_payroll"].get(month) or []
    if not isinstance(L, list) or not L:
        return None
    return {"count": len(L), "fixed": sum(1 for x in L if x.get("fixed")),
            "transfer": sum(int(float(x.get("total_transfer_amount") or 0)) for x in L),
            "expense": sum(int(float(x.get("total_expense_amount") or 0)) for x in L),
            "calculatedAt": max((x.get("calculated_at") or "")[:10] for x in L),
            "workedZero": sum(1 for x in L if float(x.get("total_worked_days_count") or 0) == 0)}


PAY = {m: payroll(m) for m in ("2026-10", "2026-11", "2026-12")}


def payroll_basis(m):
    p = PAY[m]
    if p["fixed"] == p["count"]:
        return "登録済み", f"登録済み(給与明細の振込額・確定{p['count']}件)"
    # 勤怠の締め後に計算された明細(勤怠が入っている)か、勤怠期間の前に作られた下書きか
    if p["workedZero"] > p["count"] * 0.5 or p["expense"] == 0:
        return "推計", f"推計(給与明細の下書き{p['count']}件・未確定。{p['calculatedAt']}計算で勤怠と経費精算が未反映)"
    return "登録済み", f"登録済み(給与明細の振込額・未確定{p['count'] - p['fixed']}件、勤怠反映済み)"


# ---------- 年末の扱い ----------
def shift_date(date, kind, mode):
    if date != "2026-12-31":
        return date
    if mode == "to_12_30":
        return "2026-12-30"
    if mode == "receipts_to_next_year":
        return None if kind == "in" else "2026-12-30"
    return date


CASES = {
    "standard": {"label": "標準", "assume": "標準", "yearEnd": "to_12_30"},
    "cautious": {"label": "慎重", "assume": "慎重", "yearEnd": "to_12_30"},
    "yearEndSlip": {"label": "年末入金が翌年へずれる", "assume": "標準", "yearEnd": "receipts_to_next_year"},
    "cautiousYearEndSlip": {"label": "慎重＋年末入金が翌年へずれる", "assume": "慎重", "yearEnd": "receipts_to_next_year"},
}

checks = {"ownTransfers": {}, "excludedFromBulk": collections.Counter()}


def build(month, case):
    E = []
    shift = CASES[case]["yearEnd"]
    k = CASES[case]["assume"]

    def ev(date, amount, cat, group, basis, acct="当座普通", pclass=None):
        date = shift_date(date, "in" if amount > 0 else "out", shift)
        if date is None:
            return
        E.append(dict(date=date, amount=int(round(amount)), cat=cat, group=group, basis=basis, acct=acct, pclass=pclass))

    lo, hi = ("2026-11-17", "2026-11-30") if month == "2026-11" else ("2026-12-01", "2026-12-31")
    cfg = A["cases"][month][k]
    for d in F["deals_income_all"]:
        dd = d.get("due_date") or ""
        due = asof(d)
        if d["issue_date"] <= BASE and due > 0 and lo <= dd <= hi:
            ev(dd, due, "入金:売掛", "登録済み", "登録済み(freeeの未決済の売上)")
    for d in F["deals_expense"]:
        dd = d.get("due_date") or ""
        due = asof(d)
        if d["issue_date"] <= BASE and due > 0 and lo <= dd <= hi:
            c = pay_class(d)
            cat = {"借入返済": "出金:借入返済", "税・社会保険": "出金:税社保", "外注": "出金:外注"}.get(c, "出金:一般経費")
            ev(dd, -due, cat, "登録済み", "登録済み(freeeの未決済の支払)", pclass=c)
    for e in SF:
        if lo <= e["date"] <= hi and e["kind"] in cfg["include_sf"]:
            ev(e["date"], e["amount"], "入金:売掛(SF追加)", "SF予定" if e["kind"] == "SF予定" else "SF補完", e["kind"])

    def registered_bulk(lo_, hi_):
        """一括振込と同じ支払分類の登録済み支払。分類の違うもの(借入返済・税社保)は数えて記録する"""
        s = 0
        for e in E:
            if e["group"] == "登録済み" and e["amount"] < 0 and lo_ <= e["date"] <= hi_ and e["pclass"]:
                if e["pclass"] in BULK_CLASSES:
                    s += -e["amount"]
                else:
                    checks["excludedFromBulk"][(case, month, e["pclass"])] += -e["amount"]
        return s

    me = R["month_end_bulk_transfers_aug_oct"]
    if month == "2026-11":
        g, b = payroll_basis("2026-11")
        ev(R["payroll_bank_day"]["2026-11"], -PAY["2026-11"]["transfer"], "出金:給与", g, b + "／日付は過去明細から推定")
        ev("2026-11-25", -R["monthly_25th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-27", -R["lease_insurance_26_28"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-27", -R["small_outflows_after_17th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        reg = registered_bulk("2026-11-28", "2026-11-30")
        bulk = {"mean": st.mean(me), "max": max(me), "min": min(me)}[cfg["month_end_bulk"]]
        ev("2026-11-30", -max(0, bulk - reg), "出金:外注・一般(月末一括振込の未登録分)", "推計・仮定",
           f"推計(8〜10月の月末一括振込の{'平均' if cfg['month_end_bulk'] == 'mean' else '最大'}−同じ支払分類の登録済み)")
        ev("2026-11-30", -R["social_insurance_month_end"], "出金:税社保", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-30", -R["time_deposit_month_end"], "振替:定期積立", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-30", R["time_deposit_month_end"], "振替:定期積立", "過去明細(定例)", "過去明細(定例)", "定期")
    else:
        up = D["bonus_cautious_uplift"] if k == "慎重" else 0
        ev(D["bonus_date"], -D["bonus_net_prev_dec"] * (1 + up), "出金:賞与", "推計・仮定",
           "仮定(前年12/5の賞与振込額" + ("＋10%" if up else "") + "。12月の賞与明細は未作成)")
        nov = []
        for t in BANK:
            if "2026-11-01" <= t["date"] <= BASE and t["entry_side"] == "expense":
                ot = own_transfer(t)
                if ot:
                    checks["ownTransfers"][t["id"]] = ot  # ケースごとに同じ明細を見るため、明細単位で1回だけ数える
                if ot != "confirmed":
                    nov.append(t)
        excl = tuple(A["december"]["early_month_excluded_descriptions"])
        one_off = set(A["december"]["early_month_excluded_amounts"])
        vendor = lambda t: (t["description"] or "").strip() == "ﾌﾘｺﾐ" or (t["description"] or "").startswith("W21")
        base_out = sum(t["amount"] for t in nov if not any(x in (t["description"] or "") for x in excl)
                       and t["amount"] not in one_off and not vendor(t))
        ev("2026-12-10", -base_out, "出金:定例(源泉・住民税・カード・口座振替等)", "過去明細(定例)", "過去明細(11/1〜16を流用)")
        reg_early = registered_bulk("2026-12-01", "2026-12-16")
        vnov = sum(t["amount"] for t in nov if vendor(t))
        ev("2026-12-10", -max(0, vnov - reg_early), "出金:外注・一般(10日前後の振込の未登録分)", "推計・仮定",
           "推計(11/1〜16の取引先への振込−同じ支払分類の登録済み)")
        g, b = payroll_basis("2026-12")
        gap = D["payroll_gap_cautious"] if k == "慎重" else D["payroll_gap_standard"]
        ev(R["payroll_bank_day"]["2026-12"], -PAY["2026-12"]["transfer"], "出金:給与", g, b + "／日付は過去明細から推定")
        ev(R["payroll_bank_day"]["2026-12"], -gap, "出金:給与(明細との差)", "推計・仮定",
           "仮定(" + ("前年12月の明細と振込の差" if k == "慎重" else "直近の明細と振込の差") + ")")
        ev("2026-12-25", -R["monthly_25th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-12-28", -R["lease_insurance_26_28"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-12-28", -R["small_outflows_after_17th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        reg = registered_bulk("2026-12-28", "2026-12-31")
        bulk = {"mean": st.mean(me), "prev_dec": R["december_prev_year_end_bulk"]}[cfg["month_end_bulk"]]
        ev("2026-12-30", -max(0, bulk - reg), "出金:外注・一般(月末一括振込の未登録分)", "推計・仮定",
           "推計(" + ("前年12/30の年末一括振込" if k == "慎重" else "8〜10月の月末一括振込の平均") + "−同じ支払分類の登録済み)")
        if D["social_insurance_dec_end_in_month"][k]:
            ev("2026-12-30", -R["social_insurance_month_end"], "出金:税社保", "推計・仮定", "仮定(12月末の社会保険料が年内に引落)")
        ev("2026-12-30", -R["time_deposit_month_end"], "振替:定期積立", "過去明細(定例)", "過去明細(定例)")
        ev("2026-12-30", R["time_deposit_month_end"], "振替:定期積立", "過去明細(定例)", "過去明細(定例)", "定期")
    return sorted(E, key=lambda e: (e["date"], -e["amount"]))


def run(month, case, start):
    E = build(month, case)
    bal = dict(start)
    for e in E:
        bal[e["acct"]] += e["amount"]
        e.update({"残高_当座普通": bal["当座普通"], "残高_定期": bal["定期"], "残高_現金": bal["現金"]})
    eod = {}
    for e in E:
        eod[e["date"]] = e["残高_当座普通"]
    low = min(eod.items(), key=lambda x: x[1]) if eod else (None, start["当座普通"])
    worst, b = start["当座普通"], start["当座普通"]
    for d in sorted(eod):
        day = [e for e in E if e["date"] == d and e["acct"] == "当座普通"]
        worst = min(worst, b + sum(e["amount"] for e in day if e["amount"] < 0))
        b += sum(e["amount"] for e in day)
    delta = sum(e["amount"] for e in E if e["acct"] == "当座普通")
    assert start["当座普通"] + delta == bal["当座普通"]  # 検算: 出来事の合計＝残高の増減
    return E, bal, low, worst, eod


base = {k: v for k, v in A["base_balances"].items() if not k.startswith("_")}
rows, cases_out = [], []
for case, meta in CASES.items():
    start = dict(base)
    months = []
    for m in ("2026-11", "2026-12"):
        E, end, low, worst, eod = run(m, case, start)
        by_group, by_cat = collections.Counter(), collections.Counter()
        for e in E:
            if e["acct"] == "当座普通":
                by_group[e["group"]] += e["amount"]
                by_cat[e["cat"]] += e["amount"]
        assert sum(by_group.values()) == end["当座普通"] - start["当座普通"]
        months.append({"month": m, "start": start["当座普通"], "end": end["当座普通"], "endTimeDeposit": end["定期"], "endCash": end["現金"],
                       "minEndOfDay": {"date": low[0], "amount": low[1]}, "minIntraday": worst,
                       "byBasis": dict(by_group), "byCategory": dict(by_cat),
                       "daily": [{"date": d, "balance": v} for d, v in sorted(eod.items())]})
        for e in E:
            rows.append({"ケース": meta["label"], "月": m, "日付": e["date"], "入出金額": e["amount"], "分類": e["cat"], "根拠区分": e["group"],
                         "根拠": e["basis"], "口座区分": e["acct"], "残高_当座普通": e["残高_当座普通"], "残高_定期": e["残高_定期"], "残高_現金": e["残高_現金"]})
        start = end
    cases_out.append({"id": case, "label": meta["label"], "assumption": meta["assume"], "yearEnd": meta["yearEnd"], "months": months})

with open(f"{B}/daily.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

dec31 = {"sfAdded": sum(e["amount"] for e in SF if e["date"] == "2026-12-31"),
         "sfAddedStandardKinds": sum(e["amount"] for e in SF if e["date"] == "2026-12-31" and e["kind"] in A["cases"]["2026-12"]["標準"]["include_sf"]),
         "freeeUnsettled": sum(asof(d) for d in F["deals_income_all"] if d["issue_date"] <= BASE and asof(d) > 0 and d.get("due_date") == "2026-12-31")}
out = {"baseDate": BASE, "startBalances": base, "cases": cases_out, "dec31Receipts": dec31,
       "checks": {"ownTransfers": dict(collections.Counter(checks["ownTransfers"].values())),
                  "excludedFromBulk": [{"case": k[0], "month": k[1], "class": k[2], "amount": v} for k, v in checks["excludedFromBulk"].items()],
                  "bulkReference": bulk_reference(),
                  "payroll": PAY}}
json.dump(out, open(f"{B}/cash_result.json", "w"), ensure_ascii=False, indent=1)
for c in cases_out:
    print(f"[{c['label']}]", " / ".join(f"{m['month']} 末 {m['end']:,} 日末最低 {m['minEndOfDay']['date']} {m['minEndOfDay']['amount']:,}" for m in c["months"]))
    for m in c["months"]:
        print("    ", m["month"], " ".join(f"{k} {v:+,}" for k, v in m["byBasis"].items()))
print("自社振替(11/1〜16の出金側):", out["checks"]["ownTransfers"], " 一括振込から差し引かなかった登録済み:", out["checks"]["excludedFromBulk"])
print("一括振込の構成:", [(r["date"], r["bulk"], r["bulkClassesTotal"]) for r in out["checks"]["bulkReference"]])
print("12/31予定の入金:", dec31)
