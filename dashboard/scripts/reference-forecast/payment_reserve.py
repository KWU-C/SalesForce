"""納税・賞与の支払準備(参考)。freeeの実績・予定から、消費税と賞与の将来支払と、会計上の残高を集計する(2026-11-17)。

使い方: python3 -I payment_reserve.py <出力JSON> <資金予測の基準日 YYYY-MM-DD>
出力: 金額の集計だけ(取引先名・個人名・口座番号は持たない)。PDF(経理報告・資金繰り表)の数値は使わない。

次の3つを混同しない:
- 会計上の残高: 賞与引当金・未払消費税等・仮受/仮払消費税(試算表)。支払額・準備額ではない
- 将来の支払見込額: 次に支払う税・賞与の金額(実績の支払から推計し、推計の式を残す)
- 管理上の準備額(PDFのように資金を留保する額): ここでは作らない・転記しない
控除後残高は画面側で「資金予測に未反映の支払見込額」だけを差し引いて出す(予測に含まれる支払は差し引かない)。
"""
import json, os, sys, datetime
sys.path.insert(0, os.path.expanduser("~/Documents/_終了(または待機)/freee-finance-cli"))
from freee_cli.client import FreeeClient, HR_BASE_URL

OUT, BASE = sys.argv[1], sys.argv[2]
os.umask(0o077)
JST = datetime.timezone(datetime.timedelta(hours=9))
c = FreeeClient()
cid = next(x["id"] for x in c.get_companies() if x.get("display_name") == "株式会社TCD")
items = c._request("GET", "/api/1/account_items", {"company_id": cid})["account_items"]
acc = {a["id"]: a["name"] for a in items}
aid = {a["name"]: a["id"] for a in items}


def pages(path, key, params, limit=100):
    res, off = [], 0
    while True:
        r = c._request("GET", path, dict(params, company_id=cid, limit=limit, offset=off))
        res += r[key]
        if len(r[key]) < limit:
            return res
        off += limit


# ---------- 会計上の残高(試算表、最新の締まった月末) ----------
base = datetime.date.fromisoformat(BASE)
last_closed = base.replace(day=1) - datetime.timedelta(days=1)  # 基準日の前月末
fy = last_closed.year if last_closed.month >= 9 else last_closed.year - 1  # freeeの会計年度(9月始まり)
bs = c._request("GET", "/api/1/reports/trial_bs", {"company_id": cid, "fiscal_year": fy, "start_month": 9, "end_month": last_closed.month})
bal = {b["account_item_name"]: b.get("closing_balance") or 0 for b in bs["trial_bs"]["balances"] if b.get("account_item_name")}
accounting = {
    "asOf": last_closed.isoformat(),
    "bonusProvision": bal.get("賞与引当金", 0),
    "consumptionTaxPayable": bal.get("未払消費税等", 0),
    "consumptionTaxReceived": bal.get("仮受消費税", 0),
    "consumptionTaxPaid": bal.get("仮払消費税", 0),
}

# ---------- 消費税: 前期の中間納付(仮払税金への支払)と確定納付(未払消費税等の支払) ----------
since = f"{fy - 1}-09-01"
interim = []
for d in pages("/api/1/deals", "deals", {"account_item_id": aid["仮払税金"], "start_issue_date": since, "type": "expense"}):
    amt = sum(x["amount"] for x in d["details"] if x["account_item_id"] == aid["仮払税金"])
    # 中間納付は100万円以上の仮払税金(源泉税の還付・少額の印紙等を除く)
    if amt >= 1_000_000:
        interim.append({"date": d["issue_date"], "amount": amt, "paid": [p["date"] for p in d.get("payments", [])]})
final = []
for d in pages("/api/1/deals", "deals", {"account_item_id": aid["未払消費税等"], "start_issue_date": since, "type": "expense"}):
    amt = sum(x["amount"] for x in d["details"] if x["account_item_id"] == aid["未払消費税等"])
    final.append({"date": d["issue_date"], "amount": amt})
for j in pages("/api/1/manual_journals", "manual_journals", {"account_item_id": aid["未払消費税等"], "start_issue_date": since}):
    for x in j["details"]:
        bank = any("預金" in acc.get(y["account_item_id"], "") for y in j["details"] if y is not x)
        if x["account_item_id"] == aid["未払消費税等"] and x["entry_side"] == "debit" and bank:
            final.append({"date": j["issue_date"], "amount": x["amount"]})
interim.sort(key=lambda x: x["date"])
final.sort(key=lambda x: x["date"])
prev_term_interims = [x for x in interim if x["date"] >= f"{fy - 1}-09-01" and x["date"] < f"{fy}-09-01"]
prev_term_final = [x for x in final if x["date"] >= f"{fy}-09-01"]  # 前期分の確定納付は当期に入ってから
annual = sum(x["amount"] for x in prev_term_interims) + sum(x["amount"] for x in prev_term_final)
interim_est = annual * 3 // 12
# 当期の中間納付の予定がfreeeに登録済みか(登録済みならその金額を使う)
registered_interim = [x for x in interim if x["date"] >= f"{fy}-09-01"]

# ---------- 賞与: 前年12月・当年7月の支給実績(振替伝票・取引の賞与関係の科目) ----------
BONUS_ACCTS = {"賞与", "[製]賞与", "役員賞与"}


def bonus_actual(d0, d1):
    gross = ded = net = 0
    pay_date = None
    for j in pages("/api/1/manual_journals", "manual_journals", {"start_issue_date": d0, "end_issue_date": d1}):
        names = {acc.get(x["account_item_id"], "") for x in j["details"]}
        if not names & BONUS_ACCTS:
            continue
        for x in j["details"]:
            n = acc.get(x["account_item_id"], "")
            if n in BONUS_ACCTS and x["entry_side"] == "debit":
                gross += x["amount"]
            elif n == "預り金" and x["entry_side"] == "credit":
                ded += x["amount"]
            elif "預金" in n and x["entry_side"] == "credit":
                net += x["amount"]
                pay_date = j["issue_date"]
    for d in pages("/api/1/deals", "deals", {"start_issue_date": d0, "end_issue_date": d1, "type": "expense"}):
        names = {acc.get(x["account_item_id"], "") for x in d["details"]}
        if not names & BONUS_ACCTS:
            continue
        for x in d["details"]:
            n = acc.get(x["account_item_id"], "")
            if n in BONUS_ACCTS:
                gross += x["amount"]
            elif n == "預り金":
                ded += x["amount"]
        for p in d.get("payments", []):
            net += p["amount"]
            pay_date = p["date"]
    return {"payDate": pay_date, "gross": gross, "deductions": ded, "net": net}


prev_dec = bonus_actual(f"{base.year - 1}-12-01", f"{base.year - 1}-12-15")
prev_jul = bonus_actual(f"{base.year}-07-01", f"{base.year}-07-15")


def hr_bonus(y, m):
    try:
        r = c._request("GET", "/api/v1/bonuses/employee_payroll_statements", {"company_id": cid, "year": y, "month": m, "limit": 100}, base_url=HR_BASE_URL)
        L = r.get("employee_payroll_statements", [])
    except Exception:
        return None
    if not L:
        return None
    f = lambda v: int(float(v or 0))
    return {"count": len(L), "fixed": sum(1 for x in L if x.get("fixed")), "gross": sum(f(x.get("gross_payment_amount")) for x in L),
            "deductions": sum(f(x.get("total_deduction_amount")) for x in L), "net": sum(f(x.get("net_payment_amount")) for x in L)}


this_dec = hr_bonus(base.year, 12)

man = lambda v: f"{v / 10000:,.0f}万円"
yen = lambda v: f"{v:,}円"
fy_term = fy - 1976  # 2026年度(2026/9〜) = 50期
items_out = []

# 消費税 中間納付(当期第1回)。前期の年税額(中間3回＋確定)の3/12
q1_month = f"{fy + 1}-01"
if registered_interim:
    x = registered_interim[0]
    items_out.append({"id": "consumptionTaxInterim", "label": f"消費税 中間納付（{fy_term}期 第1回）", "targetMonth": x["date"][:7], "amount": x["amount"],
                      "kind": "予定", "reflectedInForecastFrom": None,
                      "basis": f"freeeに登録済みの仮払税金の支払（{x['date']}）"})
else:
    items_out.append({
        "id": "consumptionTaxInterim", "label": f"消費税 中間納付（{fy_term}期 第1回、9〜11月分）", "targetMonth": q1_month, "amount": interim_est,
        "kind": "推計", "reflectedInForecastFrom": None,
        "basis": (f"{fy_term - 1}期の消費税（国・地方の計）{yen(annual)}＝中間納付{len(prev_term_interims)}回 "
                  + "＋".join(yen(x["amount"]) for x in prev_term_interims)
                  + f"＋確定納付 {'＋'.join(yen(x['amount']) for x in prev_term_final)}（{'・'.join(x['date'] for x in prev_term_final)}）。"
                  + f"中間納付1回分＝年税額×3/12＝{yen(interim_est)}。前期の中間納付は{'・'.join(x['date'][5:].replace('-', '/') for x in prev_term_interims)}に支払。"
                  + "freeeに当期の中間納付は未登録。税務署から届く中間申告の金額で確定する"),
    })

# 賞与(冬季): 振込(手取り)と、預り分(源泉所得税・社会保険料の本人負担)の翌月納付
if this_dec and this_dec["fixed"] == this_dec["count"]:
    net, ded, kind, src = this_dec["net"], this_dec["deductions"], "予定", f"freee人事労務の{base.year}年12月賞与明細（確定{this_dec['count']}件）"
else:
    net, ded, kind = prev_dec["net"], prev_dec["deductions"], "推計"
    src = (f"{base.year}年12月の賞与明細はfreee人事労務に未作成のため、前年12月の支給実績（{prev_dec['payDate']}、総支給{yen(prev_dec['gross'])}・"
           f"預り{yen(prev_dec['deductions'])}・振込{yen(prev_dec['net'])}）を使う。参考：{base.year}年7月は総支給{yen(prev_jul['gross'])}・振込{yen(prev_jul['net'])}")
items_out.append({"id": "bonusNet", "label": "冬季賞与 振込（手取り）", "targetMonth": f"{base.year}-12", "amount": net, "kind": kind,
                  "reflectedInForecastFrom": f"{base.year}-12", "basis": src + "。資金予測（標準）は12/4に同額を出金として計上済み"})
items_out.append({"id": "bonusDeductions", "label": "冬季賞与の預り分（源泉所得税・社会保険料の本人負担）の納付", "targetMonth": f"{base.year + 1}-01", "amount": ded,
                  "kind": "推計", "reflectedInForecastFrom": None,
                  "basis": src + "。預り分は翌月（源泉税1/10・社会保険料1月末）に納付。会社負担の社会保険料は金額を算定できないため含めない"})

out = {
    "fetchedAt": datetime.datetime.now(JST).isoformat(timespec="seconds"),
    "accounting": accounting,
    "items": items_out,
    "history": {
        "consumptionTax": [{"date": x["date"], "amount": x["amount"], "kind": "中間納付"} for x in interim]
                          + [{"date": x["date"], "amount": x["amount"], "kind": "確定納付"} for x in final],
        "bonus": [dict(prev_dec, label="前年12月"), dict(prev_jul, label="当年7月")],
    },
    "limits": [
        "会計上の残高（賞与引当金・未払消費税等・仮受／仮払消費税）は帳簿の残高で、支払見込額・準備額ではない",
        "管理上の準備額（経理報告PDFの引当・準備の額）は転記していない",
        "消費税の中間納付額は前期の年税額からの推計。税務署の通知額と端数が違うことがある",
        "賞与の会社負担の社会保険料、法人税等の納付はここに含めていない",
    ],
}
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps({"accounting": accounting, "items": [{k: v for k, v in x.items() if k != "basis"} for x in items_out],
                  "annual": annual, "prevInterims": len(prev_term_interims), "prevDec": prev_dec, "prevJul": prev_jul}, ensure_ascii=False))
