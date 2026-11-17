"""資金サマリーの控除額(短期借入)と「納税・賞与の準備額」を、月末ごとにfreeeから算出する(2026-11-17)。

使い方: python3 -I month_end_reserve.py <出力JSON> <資金予測の基準日 YYYY-MM-DD>
対象: 締まった直近2か月の月末(実績)と、基準日の月の月末(予測)。
出力は金額の集計だけ(口座番号・個人名は持たない)。経理報告・資金繰り表(PDF)の数値は計算に使わない。

準備額は「支払見込額」(次に支払う額)とは別の考え方で作る:
- 消費税の準備額 = 月末までに発生した、まだ納付していない消費税
    = 未払消費税等(前期分の確定納付の未払) + 仮受消費税 − 仮払消費税 − 当期に納付済みの中間納付
  予測の月末は、直近の締まった月末の値 + 仮定の月次発生額(前期の年税額 ÷ 12)× 月数
- 賞与の準備額 = 次回賞与の見込額 × 経過月数 ÷ 積立月数
    見込額 = 前年の同じ時期の支給額(振込＋預り分。会社負担の社会保険料は含まない)
    積立月数 = 前回支給月の翌月 〜 次回支給月の前月(次回支給の前の月末に全額になる)
控除額 = freeeの短期借入金(当座貸越)の月末残高。経理資料の「担保」と同じ意味かは確認していないため、
画面では「短期借入控除後」と表示する。
"""
import json, os, sys, datetime
sys.path.insert(0, os.path.expanduser("~/Documents/_終了(または待機)/freee-finance-cli"))
from freee_cli.client import FreeeClient

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


def ym_add(ym, n):
    y, m = int(ym[:4]), int(ym[5:7])
    t = y * 12 + (m - 1) + n
    return f"{t // 12}-{t % 12 + 1:02d}"


def month_end(ym):
    return (datetime.date(int(ym[:4]), int(ym[5:7]), 1) + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)


def fiscal_year(ym):  # freeeの会計年度(9月始まり)
    return int(ym[:4]) if int(ym[5:7]) >= 9 else int(ym[:4]) - 1


def months_between(a, b):  # a〜bの月数(両端を含む)
    return (int(b[:4]) * 12 + int(b[5:7])) - (int(a[:4]) * 12 + int(a[5:7])) + 1


def trial_bs(ym, items=False):
    fy = fiscal_year(ym)
    p = {"company_id": cid, "fiscal_year": fy, "start_month": 9, "end_month": int(ym[5:7])}
    if items:
        p["breakdown_display_type"] = "item"
    return c._request("GET", "/api/1/reports/trial_bs", p)["trial_bs"]["balances"]


base = datetime.date.fromisoformat(BASE)
forecast_ym = BASE[:7]
actual_yms = [ym_add(forecast_ym, -2), ym_add(forecast_ym, -1)]
last_closed = actual_yms[-1]
fy = fiscal_year(forecast_ym)
fy_term = fy - 1976

# ---------- 前提: 前期の消費税の年税額・賞与の支給実績(payment_reserve.json と同じ集計) ----------
# 年税額は payment_reserve.py の照合済みの値を使う(決算振替と一致したもの)
reserve = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
if reserve is None:
    raise SystemExit("payment_reserve.json(照合済みの年税額・賞与実績)を3つ目の引数で渡してください")
hist = reserve["history"]
prev_since, prev_end = f"{fy - 1}-09-01", f"{fy}-08-31"
annual_tax = sum(x["amount"] for x in hist["consumptionTax"] if prev_since <= x["date"] <= prev_end and x["kind"] == "中間納付") + sum(
    x["amount"] for x in hist["consumptionTax"] if x["kind"] == "確定納付" and f"{fy}-09-01" <= x["date"] <= f"{fy}-12-31"
)
monthly_tax = annual_tax // 12
bonus_prev = next(b for b in hist["bonus"] if b["label"] == "前年12月")
bonus_last = next(b for b in hist["bonus"] if b["label"] == "当年7月")
bonus_estimate = bonus_prev["net"] + bonus_prev["deductions"]
next_bonus_month = f"{base.year}-12"
accrual_from = ym_add(bonus_last["payDate"][:7], 1)
accrual_to = ym_add(next_bonus_month, -1)
accrual_span = months_between(accrual_from, accrual_to)

# 当期の消費税の中間納付(仮払税金のうち摘要に「消費税」を含む支払)
interim_paid = []
for d in pages("/api/1/deals", "deals", {"account_item_id": aid["仮払税金"], "start_issue_date": f"{fy}-09-01", "type": "expense"}):
    for x in d["details"]:
        if x["account_item_id"] == aid["仮払税金"] and "消費税" in (x.get("description") or ""):
            interim_paid.append({"date": d["issue_date"], "amount": x["amount"]})


def bonus_part(ym):
    if ym >= next_bonus_month or ym < accrual_from:
        elapsed = 0
    else:
        elapsed = months_between(accrual_from, ym)
    return {"estimate": bonus_estimate, "elapsedMonths": elapsed, "spanMonths": accrual_span,
            "amount": bonus_estimate * elapsed // accrual_span}


def bs_values(ym):
    rows = trial_bs(ym, items=True)
    bal = {b["account_item_name"]: b for b in rows if b.get("account_item_name")}
    v = lambda n: (bal.get(n) or {}).get("closing_balance") or 0
    stb = bal.get("短期借入金") or {}
    stb_items = [{"label": i.get("name") or "", "amount": i.get("closing_balance") or 0} for i in stb.get("items", []) if i.get("closing_balance")]
    return {
        "payable": v("未払消費税等"), "received": v("仮受消費税"), "paid": v("仮払消費税"),
        "shortTermBorrowing": v("短期借入金"), "stbItems": stb_items,
        "overdraftOnly": bool(stb_items) and all(("当座貸越" in i["label"] or "当貸" in i["label"]) for i in stb_items),
    }


def stb_summary(items_):
    by_bank = {}
    for i in items_:
        # 品目名「【借入】<銀行>/<内容>」の銀行の部分でまとめる
        bank = i["label"].split("】", 1)[-1].split("/", 1)[0] or "その他"
        by_bank[bank] = by_bank.get(bank, 0) + i["amount"]
    return [{"bank": k, "amount": v} for k, v in by_bank.items()]


months = []
for ym in actual_yms:
    b = bs_values(ym)
    end = month_end(ym).isoformat()
    paid_interim = sum(x["amount"] for x in interim_paid if x["date"] <= end)
    tax = {"payable": b["payable"], "received": b["received"], "paid": b["paid"], "interimPaid": paid_interim,
           "assumedMonths": 0, "assumedMonthly": 0}
    tax["amount"] = max(0, tax["payable"] + tax["received"] - tax["paid"] - tax["interimPaid"])
    bonus = bonus_part(ym)
    months.append({"month": ym, "kind": "実績", "shortTermBorrowing": b["shortTermBorrowing"], "shortTermBorrowingByBank": stb_summary(b["stbItems"]),
                   "overdraftOnly": b["overdraftOnly"], "consumptionTax": tax, "bonus": bonus, "reserveTotal": tax["amount"] + bonus["amount"]})

# 予測の月末: 短期借入金は取得時点の残高(予測に当座貸越の借入・返済は無い)、消費税は直近の締まった月末＋仮定の月次発生額
cur = bs_values(forecast_ym)
lc = months[-1]["consumptionTax"]
n_ahead = months_between(last_closed, forecast_ym) - 1
paid_ahead = sum(x["amount"] for x in interim_paid if month_end(last_closed).isoformat() < x["date"] <= month_end(forecast_ym).isoformat())
tax = {"payable": lc["payable"], "received": lc["received"], "paid": lc["paid"], "interimPaid": lc["interimPaid"] + paid_ahead,
       "assumedMonths": n_ahead, "assumedMonthly": monthly_tax}
if lc["payable"] != 0:
    raise SystemExit("直近の締まった月末に未払消費税等が残っています。予測月中の納付の有無を確認してから使うこと")
tax["amount"] = max(0, lc["received"] - lc["paid"] - tax["interimPaid"] + monthly_tax * n_ahead)
bonus = bonus_part(forecast_ym)
months.append({"month": forecast_ym, "kind": "予測", "shortTermBorrowing": cur["shortTermBorrowing"], "shortTermBorrowingByBank": stb_summary(cur["stbItems"]),
               "overdraftOnly": cur["overdraftOnly"], "consumptionTax": tax, "bonus": bonus, "reserveTotal": tax["amount"] + bonus["amount"]})

yen = lambda v: f"{v:,}円"
out = {
    "fetchedAt": datetime.datetime.now(JST).isoformat(timespec="seconds"),
    "months": months,
    "assumptions": [
        f"消費税：月末までに発生し、まだ納付していない額（未払消費税等＋仮受消費税−仮払消費税−当期の中間納付済み額）を全額留保する。{int(forecast_ym[5:7])}月末（予測）は{int(last_closed[5:7])}月末の値に、"
        f"{fy_term - 1}期の年税額{yen(annual_tax)}÷12＝{yen(monthly_tax)}を1か月分の発生額として加える（仮定）",
        f"賞与：次回（{int(next_bonus_month[5:7])}月）の支給見込額{yen(bonus_estimate)}（前年12月の振込{yen(bonus_prev['net'])}＋預り分{yen(bonus_prev['deductions'])}。会社負担の社会保険料は含めない）を、"
        f"前回支給（{bonus_last['payDate']}）の翌月から支給月の前月まで（{int(accrual_from[5:7])}〜{int(accrual_to[5:7])}月の{accrual_span}か月）均等に積み立てる（仮定）",
        "賞与引当金（会計上の残高）は準備額に使わない。経理資料（PDF）の引当・準備の額は転記しない",
        "支払見込額（次に支払う額と時期）とは別の計算。準備額は月末時点で手元に残しておく額の目安",
    ],
    "deductionCheck": [
        "控除額はfreeeの短期借入金の月末残高（予測の月末は取得時点の残高。参考予測に当座貸越の借入・返済は含まない）",
        "freeeの短期借入金の品目はすべて当座貸越" if all(m["overdraftOnly"] for m in months) else "freeeの短期借入金に当座貸越以外の品目がある",
        "経理資料（資金繰り表）は、定期預金の欄の「担保」として同額・同じ銀行別内訳を差し引いている。"
        "当座貸越の利用残高・極度額・担保設定額のどれを指すかは確認できていないため、同じ意味とはしていない",
    ],
}
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps([{k: v for k, v in m.items() if k != "shortTermBorrowingByBank"} for m in months], ensure_ascii=False))
