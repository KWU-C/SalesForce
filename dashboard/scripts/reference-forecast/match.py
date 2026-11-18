"""Salesforce案件とfreee売上取引の照合(参考予測用)。元データは変更しない。取引先名は出力しない(匿名ID)。

使い方: python3 -I match.py <作業ディレクトリ>
入力: freee.json(fetchで取得)、sf_process.json(Process__c)
出力: match_rows.json(照合結果・匿名ID)、sf_events.json(予測に加えるSalesforce入金予定)、match_summary.json

2026-11-16 の確認用資料(match2.py)からの変更(2026-11-17):
- 取引先名の部分一致(一方が他方を含む)で照合したもの、同じ取引先・同じ月に同額の案件や同額のfreee取引が
  複数あり件数で割り当てたものを「曖昧」として識別する
- 「Salesforce追加」の候補のうち、名称の部分一致でしか取引先を特定できないもの、または同じ取引先(部分一致を含む)に
  請求月の違う同額のfreee取引があるものは、二重計上を避けるため「判定保留(曖昧)」にして予測に加えない

2026-11-18: sf_events に請求日(billed)・匿名ID(sfId)・同じ取引先の同額のfreee取引の有無(freeeSameAmountLater)を加えた
"""
import json, sys, unicodedata, calendar, collections, hashlib, itertools

B = sys.argv[1]
BASE_DATE = "2026-11-16"
sf = json.load(open(f"{B}/sf_process.json"))["result"]["records"]
fr = json.load(open(f"{B}/freee.json"))
partners = {p["id"]: p["name"] for p in fr["partners"]}
anon = lambda prefix, x: prefix + hashlib.sha1(str(x).encode()).hexdigest()[:8]


def norm(s):
    s = unicodedata.normalize("NFKC", s or "")
    for w in ("株式会社", "(株)", "有限会社", "一般財団法人", "公益財団法人", "学校法人", "合同会社", " ", "　", "・"):
        s = s.replace(w, "")
    return s


def partner_rel(a, b):
    """exact / partial / None"""
    if not a or not b:
        return None
    if a == b:
        return "exact"
    if a in b or b in a:
        return "partial"
    return None


def month_end_next(d):
    y, m = int(d[:4]), int(d[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def status_asof(d):
    """基準日時点の未決済額(基準日より後の入金を戻す)"""
    later = sum(p["amount"] for p in d.get("payments", []) if p["date"] > BASE_DATE)
    due = d["due_amount"] + later
    return ("unsettled" if due > 0 else "settled"), due


ALL_PARTNERS = {norm(n) for n in partners.values()} - {""}
OK = {"受注", "納品", "請求", "入金"}
S = [dict(id=r["Id"], s=r["seikyuubi__c"], ny=r["nyuukin_yoteibi__c"], amt=int(round(r["uriage_tax__c"] or 0)),
          p=norm((r.get("seikyuusakimei__r") or {}).get("Name")))
     for r in sf if r["phase__c"] in OK and (r["juchukakudo__c"] or "").startswith("A") and r["seikyuubi__c"] and r["seikyuubi__c"] >= "2026-10-01"]
Fd = []
for d in fr["deals_income_all"]:
    if d["issue_date"] < "2026-09-01" or d["issue_date"] > BASE_DATE:
        continue
    st, due = status_asof(d)
    Fd.append(dict(id=d["id"], issue=d["issue_date"], due=d.get("due_date") or "", amt=d["amount"], due_amt=due, status=st,
                   p=norm(partners.get(d.get("partner_id"), ""))))

result = []  # (SF, [freee], 方法, 曖昧の理由のリスト)
fused = set()
groups = collections.defaultdict(list)
for x in S:
    groups[(x["p"], x["s"][:7])].append(x)
for (p, m), xs in groups.items():
    cand = [f for f in Fd if f["id"] not in fused and partner_rel(p, f["p"]) and f["issue"][:7] == m]
    rels = {partner_rel(p, f["p"]) for f in cand}
    names = {f["p"] for f in cand}
    flags_g = []
    if "partial" in rels:
        flags_g.append("名称の部分一致")
    if len(names) > 1:
        flags_g.append("複数の取引先名に一致")
    amt_count_sf = collections.Counter(x["amt"] for x in xs)
    amt_count_fr = collections.Counter(f["amt"] for f in cand)
    rest = list(xs)
    for x in sorted(rest, key=lambda x: x["amt"]):
        f = next((f for f in cand if f["id"] not in fused and abs(f["amt"] - x["amt"]) <= 1), None)
        if f:
            fused.add(f["id"])
            fl = list(flags_g)
            if amt_count_sf[x["amt"]] > 1 or amt_count_fr[f["amt"]] > 1:
                fl.append("同額が複数(件数で割当)")
            result.append((x, [f], "1対1", fl))
    rest = [x for x in rest if not any(x is r[0] for r in result)]
    for x in list(rest):
        pool = [f for f in cand if f["id"] not in fused]
        hit = None
        for k in (2, 3, 4):
            for comb in itertools.combinations(pool, k):
                if abs(sum(f["amt"] for f in comb) - x["amt"]) <= k:
                    hit = comb
                    break
            if hit:
                break
        if hit:
            for f in hit:
                fused.add(f["id"])
            result.append((x, list(hit), "分割(SF1件=freee複数)", flags_g + ["金額の組合せで照合"]))
            rest.remove(x)
    for f in [f for f in cand if f["id"] not in fused]:
        for k in (2, 3, 4):
            hit = next((comb for comb in itertools.combinations(rest, k) if abs(sum(x["amt"] for x in comb) - f["amt"]) <= k), None)
            if hit:
                fused.add(f["id"])
                for x in hit:
                    result.append((x, [f], "まとめ(SF複数=freee1件)", flags_g + ["金額の組合せで照合"]))
                    rest.remove(x)
                break
    has_partner_deals = any(partner_rel(p, f["p"]) for f in Fd if f["issue"][:7] == m)
    for x in rest:
        fl = list(flags_g)
        # 同じ取引先(部分一致を含む)に、請求月の違う同額のfreee取引がある → 既に登録済みの可能性
        # (照合されなかったfreee取引に限るため、全グループの照合後に判定する)
        fl.append(("OTHER_MONTH_CHECK", p, m))
        if not has_partner_deals and p not in ALL_PARTNERS and any(partner_rel(p, q) == "partial" for q in ALL_PARTNERS):
            # freeeの取引先マスタに同じ名前が無く、名前を含む(含まれる)別の取引先だけがある
            fl.append("取引先名が部分一致でしか見つからない")
        result.append((x, [], "判定保留(同じ取引先のfreee取引と金額が合わない)" if has_partner_deals else "freee未登録", fl))

# 同じ取引先(部分一致を含む)に、請求月が違い、どの案件とも照合されていない同額のfreee取引がある
# → その案件の請求が別の月で登録済みの可能性があるため曖昧とする(毎月同額の継続案件は照合済みなので該当しない)
resolved = []
for x, fs, how, fl in result:
    fl2 = []
    for item in fl:
        if isinstance(item, tuple):
            _, p, m = item
            if any(f["id"] not in fused and f["issue"] >= "2026-10-01" and partner_rel(p, f["p"]) and f["issue"][:7] != m and abs(f["amt"] - x["amt"]) <= 1 for f in Fd):
                fl2.append("請求月の違う同額のfreee取引(未照合)あり")
        else:
            fl2.append(item)
    resolved.append((x, fs, how, fl2))
result = resolved

rows, events = [], []
for x, fs, how, fl in result:
    if fs:
        cls = "入金済み除外" if all(f["status"] == "settled" for f in fs) else "freee採用"
    elif how == "freee未登録":
        if x["s"] < "2026-11-01":
            cls = "判定保留(10月請求でfreee未登録)"
        elif fl:
            cls = "判定保留(曖昧)"
        else:
            cls = "Salesforce追加"
    else:
        cls = "判定保留"
    ny = x["ny"]
    kind = "入力"
    if not ny:
        ny, kind = month_end_next(x["s"]), "補完(空欄)"
    elif ny < x["s"]:
        ny, kind = month_end_next(x["s"]), "補完(異常日付)"
    if cls == "Salesforce追加":
        # 請求日(入金予定日と同じ日かを engine.py で見る)と、同じ取引先(部分一致を含む)に同額のfreee取引が
        # 請求月以降にあるか(移動先の月での二重計上の確認用)
        later_same = any(partner_rel(x["p"], f["p"]) and abs(f["amt"] - x["amt"]) <= 1 and f["issue"] >= x["s"][:7] + "-01" for f in Fd)
        events.append(dict(date=ny, amount=x["amt"], kind="SF予定" if kind == "入力" else f"SF{kind}", billed=x["s"],
                           sfId=anon("SF-", x["id"]), freeeSameAmountLater=later_same))
    rows.append({"SF匿名ID": anon("SF-", x["id"]), "取引先匿名ID": anon("P-", x["p"]), "請求月": x["s"][:7], "税込": x["amt"],
                 "入金予定日(採用)": ny, "入金予定日の扱い": kind, "照合方法": how,
                 "freee匿名ID": " ".join(anon("FR-", f["id"]) for f in fs), "freee状態(基準日)": " ".join(f["status"] for f in fs),
                 "freee期日": " ".join(f["due"] for f in fs), "曖昧の理由": " / ".join(dict.fromkeys(fl)), "判定": cls})

json.dump(rows, open(f"{B}/match_rows.json", "w"), ensure_ascii=False)
json.dump(events, open(f"{B}/sf_events.json", "w"), ensure_ascii=False)
summ = collections.defaultdict(lambda: [0, 0])
amb = collections.defaultdict(lambda: [0, 0])
for r in rows:
    summ[r["判定"]][0] += 1
    summ[r["判定"]][1] += r["税込"]
    if r["曖昧の理由"]:
        for reason in r["曖昧の理由"].split(" / "):
            amb[(r["判定"], reason)][0] += 1
            amb[(r["判定"], reason)][1] += r["税込"]
fun = [f for f in Fd if f["id"] not in fused and f["status"] == "unsettled"]
out = {"by_class": {k: {"count": v[0], "amount": v[1]} for k, v in summ.items()},
       "ambiguous": [{"class": k[0], "reason": k[1], "count": v[0], "amount": v[1]} for k, v in sorted(amb.items())],
       "freee_unmatched_unsettled": {"count": len(fun), "amount": sum(f["due_amt"] for f in fun)},
       "sf_events": {k: sum(e["amount"] for e in events if e["kind"] == k) for k in sorted({e["kind"] for e in events})}}
json.dump(out, open(f"{B}/match_summary.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
