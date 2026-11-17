import json, os, sys
sys.path.insert(0, os.path.expanduser("~/Documents/_終了(または待機)/freee-finance-cli"))
from freee_cli.client import FreeeClient, HR_BASE_URL
OUT = sys.argv[1]; os.umask(0o077)
c = FreeeClient()
cid = next(x["id"] for x in c.get_companies() if x.get("display_name") == "株式会社TCD")
def pages(path, key, params, limit=100):
    res = []; off = 0
    while True:
        r = c._request("GET", path, dict(params, company_id=cid, limit=limit, offset=off))
        res += r[key]
        if len(r[key]) < limit: return res
        off += limit
out = {}
out["account_items"] = c._request("GET", "/api/1/account_items", {"company_id": cid})["account_items"]
out["partners"] = pages("/api/1/partners", "partners", {}, 3000)
out["walletables"] = c._request("GET", "/api/1/walletables", {"company_id": cid})["walletables"]
out["wallet_txns"] = pages("/api/1/wallet_txns", "wallet_txns", {"start_date": "2025-11-01", "end_date": "2026-11-30"})
out["transfers"] = pages("/api/1/transfers", "transfers", {"start_date": "2025-11-01", "end_date": "2026-11-30"})
out["deals_income_all"] = pages("/api/1/deals", "deals", {"type": "income", "start_issue_date": "2026-01-01"})
out["deals_expense"] = pages("/api/1/deals", "deals", {"type": "expense", "start_due_date": "2026-11-01", "end_due_date": "2027-01-31"})
out["deals_expense_hist"] = pages("/api/1/deals", "deals", {"type": "expense", "start_issue_date": "2025-11-01"})
hr = {}
for ym in [(2025,12),(2026,8),(2026,9),(2026,10),(2026,11),(2026,12)]:
    try:
        r = c._request("GET", "/api/v1/salaries/employee_payroll_statements", {"company_id": cid, "year": ym[0], "month": ym[1], "limit": 100}, base_url=HR_BASE_URL)
        hr[f"{ym[0]}-{ym[1]:02d}"] = r.get("employee_payroll_statements", [])
    except Exception as e:
        hr[f"{ym[0]}-{ym[1]:02d}"] = {"error": str(e)[:200]}
out["hr_payroll"] = hr
json.dump(out, open(f"{OUT}/freee.json", "w"), ensure_ascii=False)
print({k: (len(v) if isinstance(v, list) else {m: (len(x) if isinstance(x, list) else "err") for m, x in v.items()}) for k, v in out.items()})
