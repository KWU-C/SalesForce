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

2026-11-18 の明細確認を受けた変更(準備額の計算は変えない):
5. 月末一括振込を一般経費と外注に分けて推計し、それぞれ同じ分類の登録済み支払だけを差し引く
   (一般経費=8〜10月の一括振込のうち外注以外。外注=標準は11月が登録済みのみ・12月は月末期日の外注の平均)
6. 経費精算: 給与明細の振込額に含まれるため、支給日期日で登録済みの経費精算の支払は、明細の経費精算と同額なら数えない
7. 給与振込と明細の差(8〜10月)と、月末の当座貸越利息を加える
8. 仮定: Salesforceで請求日＝入金予定日(11/30)の追加分は請求の翌月末に入金。電子債権で決済する取引先の売上は約2か月後に現金化(予測期間外)
9. 慎重: Salesforceの10月仕入でfreee未登録の外注を11月末に支払い、月末期日を大きく遅れた実績のある取引先の11月期日の入金が翌月へずれる
10. 12/10前後の推計から、前月末期日の支払が休日で11/2にずれた分を除く
"""
import json, sys, csv, collections, calendar, datetime, statistics as st

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


PAY = {m: payroll(m) for m in ("2026-08", "2026-09", "2026-10", "2026-11", "2026-12")}


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
WIN = {"2026-11": ("2026-11-17", "2026-11-30"), "2026-12": ("2026-12-01", "2026-12-31")}


def month_end_next(d):
    y, m = int(d[:4]), int(d[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


# ---------- 2026-11-18 追加: 過去明細からの集計(いずれも銀行明細・freeeの取引から計算し、PDFは使わない) ----------
def bulk_parts():
    """8〜10月の月末一括振込を、同日・同口座で決済された外注の支払と、それ以外(一般経費)に分ける"""
    out = []
    for amt in R["month_end_bulk_transfers_aug_oct"]:
        t = next(t for t in BANK if t["amount"] == amt and t["entry_side"] == "expense")
        gaichu = sum(p["amount"] for dl in F["deals_expense_hist"] if pay_class(dl) == "外注"
                     for p in dl.get("payments", []) if p["date"] == t["date"] and p.get("from_walletable_id") == t["walletable_id"])
        out.append({"date": t["date"], "bulk": amt, "gaichu": gaichu, "general": amt - gaichu})
    return out


def month_end_gaichu():
    """8〜10月の月末期日(月末の2日前〜月末)の外注の支払額。10/31(土)期日分は11/2に払われたため期日で数える"""
    out = []
    for ym in ("2026-08", "2026-09", "2026-10"):
        last = f"{ym}-{calendar.monthrange(int(ym[:4]), int(ym[5:7]))[1]:02d}"
        lo = f"{ym}-{int(last[8:]) - 2:02d}"
        s = sum(p["amount"] for dl in F["deals_expense_hist"] if pay_class(dl) == "外注" and lo <= (dl.get("due_date") or "") <= last
                for p in dl.get("payments", []))
        out.append({"month": ym, "amount": s})
    return out


def payroll_gaps():
    """8〜10月の給与振込(銀行)と給与明細の振込額の差"""
    out = []
    for ym in ("2026-08", "2026-09", "2026-10"):
        st = PAY[ym]["transfer"]
        cand = [t for t in BANK if t["entry_side"] == "expense" and t["date"][:7] == ym and "15" <= t["date"][8:] <= "25"
                and (t["description"] or "").strip() == "ﾌﾘｺﾐ" and abs(t["amount"] - st) <= st * 0.05]
        t = min(cand, key=lambda t: abs(t["amount"] - st))
        out.append({"month": ym, "bankDate": t["date"], "bank": t["amount"], "statement": st, "gap": t["amount"] - st})
    return out


def overdraft_interest():
    """当座貸越の利息(月末の引落、摘要「ｶｼﾘｿｸ」)の8〜10月"""
    return [{"date": t["date"], "amount": t["amount"]} for t in BANK
            if t["entry_side"] == "expense" and (t["description"] or "").startswith("ｶｼﾘｿｸ") and "2026-08-01" <= t["date"] <= "2026-10-31"]


NOTES_WALLET = next(w["id"] for w in F["walletables"] if w["name"] == "受取手形・電子債権")


def notes_partners():
    """2026-05以降の売上の決済がすべて受取手形・電子債権の口座で、3回以上ある取引先(電子債権で受け取り、約2か月後に現金化)"""
    by = collections.defaultdict(list)
    for d in F["deals_income_all"]:
        for p in d.get("payments", []):
            if p["date"] >= "2026-05-01":
                by[d.get("partner_id")].append(p.get("from_walletable_id") == NOTES_WALLET)
    return {pid for pid, xs in by.items() if len(xs) >= 3 and all(xs)}


def late_partners():
    """月末期日の売上を20日以上遅れて入金したことがあり(2026-06〜10月期日)、基準日に期日を過ぎた未入金がある取引先"""
    late, overdue = set(), set()
    for d in F["deals_income_all"]:
        dd = d.get("due_date") or ""
        if "2026-06-01" <= dd <= "2026-10-31" and dd[8:] >= "28":
            if any((datetime.date.fromisoformat(p["date"]) - datetime.date.fromisoformat(dd)).days >= 20 for p in d.get("payments", [])):
                late.add(d.get("partner_id"))
        if d["issue_date"] <= BASE and asof(d) > 0 and dd and dd < "2026-11-17":
            overdue.add(d.get("partner_id"))
    return late & overdue


BULK = bulk_parts()
GAICHU_ME = month_end_gaichu()
GAPS = payroll_gaps()
INTEREST = overdraft_interest()
NOTES_P = notes_partners()
LATE_P = late_partners()
NEW = A["adjustments_20261118"]
general_stat = {"mean": round(st.mean(b["general"] for b in BULK)), "max": max(b["general"] for b in BULK)}
gaichu_me_mean = round(st.mean(g["amount"] for g in GAICHU_ME))
gap_stat = {"mean": round(st.mean(g["gap"] for g in GAPS)), "max": max(g["gap"] for g in GAPS)}
interest_stat = {"mean": round(st.mean(x["amount"] for x in INTEREST)), "max": max(x["amount"] for x in INTEREST)}
applied = collections.defaultdict(dict)  # 仮定・調整の記録(ケース×項目)


INCOME_CACHE = {}


def income_events(case):
    """売上の入金予定(freee未決済・Salesforce追加)を、ケースの仮定で日付を動かした一覧にする(ケースごとに1回だけ作る)"""
    if case not in INCOME_CACHE:
        INCOME_CACHE[case] = _income_events(case)
    return INCOME_CACHE[case]


def _income_events(case):
    k = CASES[case]["assume"]
    ev = []
    for d in F["deals_income_all"]:
        dd = d.get("due_date") or ""
        due = asof(d)
        if not (d["issue_date"] <= BASE and due > 0 and WIN["2026-11"][0] <= dd <= WIN["2026-12"][1]):
            continue
        if d.get("partner_id") in NOTES_P:
            # 電子債権で受け取り、現金化は約2か月後の20日前後(過去5回)。予測期間(〜12月)には入れない
            cash_ym = month_end_next(month_end_next(dd))[:7]
            applied[case].setdefault("notes", []).append({"due": dd, "amount": due, "assumedCashMonth": cash_ym})
            continue
        if k == "慎重" and d.get("partner_id") in LATE_P and dd <= WIN["2026-11"][1]:
            applied[case].setdefault("lateSlip", []).append({"due": dd, "amount": due, "assumedDate": NEW["late_slip_date"]})
            ev.append(dict(date=NEW["late_slip_date"], amount=due, cat="入金:売掛(入金遅れの仮定)", group="推計・仮定",
                           basis=f"仮定(慎重: {dd}期日の売上が翌月へずれる。月末期日を20日以上遅れて入金した実績と期日超過の未入金がある取引先)"))
            continue
        ev.append(dict(date=dd, amount=due, cat="入金:売掛", group="登録済み", basis="登録済み(freeeの未決済の売上)"))
    for e in SF:
        date, group, basis, cat = e["date"], "SF予定" if e["kind"] == "SF予定" else "SF補完", e["kind"], "入金:売掛(SF追加)"
        if e["kind"] == "SF予定" and WIN["2026-11"][0] <= date <= WIN["2026-11"][1] and e.get("billed") == date:
            # 請求日と入金予定日が同じ(11/30)。同じ取引先の過去の入金は請求の翌月末のため、入金は翌月末と仮定する
            if e.get("freeeSameAmountLater"):
                raise SystemExit(f"{e['sfId']}: 同じ取引先に同額のfreee取引が請求月以降にあります。二重計上の確認が必要です")
            new = month_end_next(e["billed"])
            applied[case].setdefault("sfMoved", []).append({"sfId": e["sfId"], "amount": e["amount"], "from": date, "to": new})
            date, group, basis, cat = new, "推計・仮定", "仮定(Salesforceの入金予定日が請求日と同じ11/30のため、請求の翌月末に入金と仮定。確定情報ではない)", "入金:売掛(SF追加・入金月は仮定)"
        ev.append(dict(date=date, amount=e["amount"], cat=cat, group=group, basis=basis, sfKind=e["kind"]))
    return ev


def build(month, case):
    E = []
    shift = CASES[case]["yearEnd"]
    k = CASES[case]["assume"]

    def ev(date, amount, cat, group, basis, acct="当座普通", pclass=None):
        date = shift_date(date, "in" if amount > 0 else "out", shift)
        if date is None:
            return
        E.append(dict(date=date, amount=int(round(amount)), cat=cat, group=group, basis=basis, acct=acct, pclass=pclass))

    lo, hi = WIN[month]
    cfg = A["cases"][month][k]
    for x in income_events(case):
        if not (lo <= x["date"] <= hi):
            continue
        if "sfKind" in x and x["sfKind"] not in cfg["include_sf"]:
            continue
        ev(x["date"], x["amount"], x["cat"], x["group"], x["basis"])

    # 給与明細の経費精算は給与振込に含まれる(明細の振込額＝銀行の給与振込、8月は一致)。
    # 支給日期日で登録済みの経費精算の支払は、明細の経費精算と同額なら給与と重複するため数えない
    pm = month
    pay_date = next(iter({x.get("pay_date") for x in F["hr_payroll"][pm]}))
    reimb = [d for d in F["deals_expense"] if d["issue_date"] <= BASE and asof(d) > 0 and d.get("due_date") == pay_date
             and pay_class(d) in ("一般経費", "税・社会保険")]
    reimb_sum = sum(asof(d) for d in reimb)
    dedupe = PAY[pm]["expense"] > 0
    if dedupe and abs(reimb_sum - PAY[pm]["expense"]) > 1000:
        raise SystemExit(f"{pm}: 支給日期日の登録済み支払{reimb_sum:,}円が給与明細の経費精算{PAY[pm]['expense']:,}円と合いません")
    applied[case][f"reimbursement_{pm}"] = {"payDate": pay_date, "registered": reimb_sum, "statementExpense": PAY[pm]["expense"], "excluded": dedupe}
    reimb_ids = {d["id"] for d in reimb} if dedupe else set()

    for d in F["deals_expense"]:
        dd = d.get("due_date") or ""
        due = asof(d)
        if d["issue_date"] <= BASE and due > 0 and lo <= dd <= hi and d["id"] not in reimb_ids:
            c = pay_class(d)
            cat = {"借入返済": "出金:借入返済", "税・社会保険": "出金:税社保", "外注": "出金:外注"}.get(c, "出金:一般経費")
            ev(dd, -due, cat, "登録済み", "登録済み(freeeの未決済の支払)", pclass=c)

    def registered(cls, lo_, hi_):
        """同じ支払分類の登録済み支払(一括振込の推計から差し引く)。分類の違うものは数えて記録する"""
        s = 0
        for e in E:
            if e["group"] == "登録済み" and e["amount"] < 0 and lo_ <= e["date"] <= hi_ and e["pclass"]:
                if e["pclass"] == cls:
                    s += -e["amount"]
                elif e["pclass"] not in BULK_CLASSES:
                    checks["excludedFromBulk"][(case, month, e["pclass"])] += -e["amount"]
        return s

    gstat = "max" if k == "慎重" else "mean"
    gap = gap_stat["max" if k == "慎重" else "mean"]
    intr = interest_stat["max" if k == "慎重" else "mean"]
    gaichu_unreg = NEW["unregistered_gaichu_sf_oct"]["amount"] if k == "慎重" else 0
    if month == "2026-11":
        g, b = payroll_basis("2026-11")
        ev(R["payroll_bank_day"]["2026-11"], -PAY["2026-11"]["transfer"], "出金:給与", g, b + "（経費精算を含む）／日付は過去明細から推定")
        ev(R["payroll_bank_day"]["2026-11"], -gap, "出金:給与(明細との差)", "推計・仮定",
           f"推計(8〜10月の給与振込と明細の差の{'最大' if k == '慎重' else '平均'})")
        ev("2026-11-25", -R["monthly_25th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-27", -R["lease_insurance_26_28"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-27", -R["small_outflows_after_17th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-11-30", -max(0, general_stat[gstat] - registered("一般経費", "2026-11-28", "2026-11-30")), "出金:一般経費(月末一括振込の未登録分)", "推計・仮定",
           f"推計(8〜10月の月末一括振込のうち外注以外の{'最大' if k == '慎重' else '平均'}−登録済みの一般経費)")
        reg_g = registered("外注", "2026-11-28", "2026-11-30")
        if gaichu_unreg:
            ev("2026-11-30", -gaichu_unreg, "出金:外注(未登録)", "推計・仮定",
               "仮定(慎重: Salesforceの10月仕入でfreee未登録の外注を11月末に支払う)")
        applied[case]["bulk_2026-11"] = {"general": general_stat[gstat], "registeredGeneral": registered("一般経費", "2026-11-28", "2026-11-30"),
                                         "registeredGaichu": reg_g, "unregisteredGaichu": gaichu_unreg}
        ev("2026-11-30", -intr, "出金:利息(当座貸越)", "過去明細(定例)", f"過去明細(8〜10月の月末の当座貸越利息の{'最大' if k == '慎重' else '平均'})")
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
                    checks["ownTransfers"][t["id"]] = ot
                if ot != "confirmed":
                    nov.append(t)
        excl = tuple(A["december"]["early_month_excluded_descriptions"])
        one_off = set(A["december"]["early_month_excluded_amounts"])
        vendor = lambda t: (t["description"] or "").strip() == "ﾌﾘｺﾐ" or (t["description"] or "").startswith("W21")

        def carryover_day(date, wid):
            """前月末期日の支払が休日で翌月にずれた日(10/31(土)期日の外注を11/2に支払)。12月には繰り返さない。
            その日・その口座の取引先への振込の9割以上が、前月の月末(28日以降)期日の支払で決済されている日だけを対象にする"""
            day_total = sum(t["amount"] for t in nov if vendor(t) and t["date"] == date and t["walletable_id"] == wid)
            prev_me = sum(p["amount"] for dl in F["deals_expense_hist"] if "2026-10-28" <= (dl.get("due_date") or "") <= "2026-10-31"
                          for p in dl.get("payments", []) if p["date"] == date and p.get("from_walletable_id") == wid)
            return day_total > 0 and prev_me >= day_total * 0.9
        carried = [t for t in nov if vendor(t) and carryover_day(t["date"], t["walletable_id"])]
        applied[case]["decEarlyCarryoverExcluded"] = [{"date": t["date"], "amount": t["amount"]} for t in carried]
        base_out = sum(t["amount"] for t in nov if not any(x in (t["description"] or "") for x in excl)
                       and t["amount"] not in one_off and not vendor(t))
        ev("2026-12-10", -base_out, "出金:定例(源泉・住民税・カード・口座振替等)", "過去明細(定例)", "過去明細(11/1〜16を流用)")
        reg_early = registered("外注", "2026-12-01", "2026-12-16") + registered("一般経費", "2026-12-01", "2026-12-16")
        vnov = sum(t["amount"] for t in nov if vendor(t) and t not in carried)
        early = max(0, vnov - reg_early - gaichu_unreg)
        applied[case]["decEarly"] = {"vendorNov": vnov, "registered": reg_early, "lessUnregisteredGaichuPaidInNov": gaichu_unreg, "amount": early}
        ev("2026-12-10", -early, "出金:外注・一般(10日前後の振込の未登録分)", "推計・仮定",
           "推計(11/1〜16の取引先への振込(前月末分の繰越を除く)−同じ支払分類の登録済み" + ("−11月末に支払うと置いた未登録外注" if gaichu_unreg else "") + ")")
        g, b = payroll_basis("2026-12")
        dgap = D["payroll_gap_cautious"] if k == "慎重" else D["payroll_gap_standard"]
        ev(R["payroll_bank_day"]["2026-12"], -PAY["2026-12"]["transfer"], "出金:給与", g, b + "／日付は過去明細から推定")
        ev(R["payroll_bank_day"]["2026-12"], -dgap, "出金:給与(明細との差)", "推計・仮定",
           "仮定(" + ("前年12月の明細と振込の差" if k == "慎重" else "直近の明細と振込の差") + ")")
        ev("2026-12-25", -R["monthly_25th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-12-28", -R["lease_insurance_26_28"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        ev("2026-12-28", -R["small_outflows_after_17th"], "出金:一般経費", "過去明細(定例)", "過去明細(定例)")
        reg_gen = registered("一般経費", "2026-12-28", "2026-12-31")
        reg_gai = registered("外注", "2026-12-28", "2026-12-31")
        ev("2026-12-30", -max(0, general_stat[gstat] - reg_gen), "出金:一般経費(月末一括振込の未登録分)", "推計・仮定",
           f"推計(8〜10月の月末一括振込のうち外注以外の{'最大' if k == '慎重' else '平均'}−登録済みの一般経費)")
        if k == "慎重":
            gai_est = R["december_prev_year_end_bulk"] - general_stat["max"]
            gai_basis = "推計(慎重: 前年12/30の年末一括振込−一般経費の最大を外注分とし、登録済みの外注を差し引く)"
        else:
            gai_est = gaichu_me_mean
            gai_basis = "推計(8〜10月の月末期日の外注の支払の平均−登録済みの外注)"
        ev("2026-12-30", -max(0, gai_est - reg_gai), "出金:外注(月末の未登録分)", "推計・仮定", gai_basis)
        applied[case]["bulk_2026-12"] = {"general": general_stat[gstat], "registeredGeneral": reg_gen, "gaichuEstimate": gai_est, "registeredGaichu": reg_gai}
        ev("2026-12-30", -intr, "出金:利息(当座貸越)", "過去明細(定例)", f"過去明細(8〜10月の月末の当座貸越利息の{'最大' if k == '慎重' else '平均'})")
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

inc_std = income_events("standard")
dec31 = {"sfAdded": sum(e["amount"] for e in inc_std if e["date"] == "2026-12-31" and "sfKind" in e),
         "sfAddedStandardKinds": sum(e["amount"] for e in inc_std if e["date"] == "2026-12-31" and e.get("sfKind") in A["cases"]["2026-12"]["標準"]["include_sf"]),
         "freeeUnsettled": sum(asof(d) for d in F["deals_income_all"] if d["issue_date"] <= BASE and asof(d) > 0 and d.get("due_date") == "2026-12-31")}
out = {"baseDate": BASE, "startBalances": base, "cases": cases_out, "dec31Receipts": dec31,
       "checks": {"ownTransfers": dict(collections.Counter(checks["ownTransfers"].values())),
                  "excludedFromBulk": [{"case": k[0], "month": k[1], "class": k[2], "amount": v} for k, v in checks["excludedFromBulk"].items()],
                  "bulkReference": bulk_reference(),
                  "payroll": PAY,
                  "adjustments": {"bulkParts": BULK, "monthEndGaichu": GAICHU_ME, "payrollGaps": GAPS, "overdraftInterest": INTEREST,
                                  "generalBulk": general_stat, "gaichuMonthEndMean": gaichu_me_mean, "payrollGap": gap_stat, "interest": interest_stat,
                                  "notesPartnerCount": len(NOTES_P), "latePartnerCount": len(LATE_P),
                                  "unregisteredGaichu": NEW["unregistered_gaichu_sf_oct"],
                                  "byCase": {c: dict(v) for c, v in applied.items()}}}}
json.dump(out, open(f"{B}/cash_result.json", "w"), ensure_ascii=False, indent=1)
for c in cases_out:
    print(f"[{c['label']}]", " / ".join(f"{m['month']} 末 {m['end']:,} 日末最低 {m['minEndOfDay']['date']} {m['minEndOfDay']['amount']:,}" for m in c["months"]))
    for m in c["months"]:
        print("    ", m["month"], " ".join(f"{k} {v:+,}" for k, v in m["byBasis"].items()))
print("自社振替(11/1〜16の出金側):", out["checks"]["ownTransfers"], " 一括振込から差し引かなかった登録済み:", out["checks"]["excludedFromBulk"])
print("一括振込の構成:", [(r["date"], r["bulk"], r["bulkClassesTotal"]) for r in out["checks"]["bulkReference"]])
print("12/31予定の入金:", dec31)
