"""リーダー別の完了粗利を集計する（年次/四半期/月次共通）。

完了の定義は README.md の「完了粗利の定義」を参照:
- 日付項目: 請求日 (seikyuubi__c)
- フェーズ: 見積・受注・納品・請求・入金を全て含む
- 受注確度: A (80〜100%) のみ

使い方:
    .venv/bin/python src/leader_arari.py                       # 今期・年計
    .venv/bin/python src/leader_arari.py --granularity quarter # 今期・四半期別
    .venv/bin/python src/leader_arari.py --granularity month   # 今期・月別
    .venv/bin/python src/leader_arari.py --fy 2024              # 会計年度を指定
"""

import argparse
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from sf_cli import query

FISCAL_YEAR_START_MONTH = 9

PHASES = "('見積','受注','納品','請求','入金')"
PROBABILITY_A = "'A (80～100%)'"

# 次期チーム編成表(2026-07時点)。ここにない rida__c 名が集計に出てきたら
# 入力ミスの可能性が高いので警告する。
KNOWN_LEADERS = {
    "CR1": ["山本 みき", "福田 恵里", "荒木 可奈子", "笹倉 彩加", "宮崎 ひかる", "日比 秀一",
            "安田 裕一", "柳田 佳奈", "キッティクンラユット ナッタチャイ", "大野 晴", "中島 瞳"],
    "CR2": ["鎌尾 典明", "大杉 涼子", "麻生 真奈", "髙松 比奈", "由良 綾子", "栗原 瑛里子",
            "能登 愛", "ショウ 英美", "梛木 夢乃"],
    "CR4": ["野中 正也", "長谷川 陽菜", "川端 建希", "所 美由紀", "森岡 真菜", "生天目 陽菜",
            "小西 綾香", "松﨑 菜月"],
    "CR3": ["外山 仁美", "若松 貴三", "小林 香織", "浅井 優音", "杉生 康高", "竹本 晃",
            "堤 大知", "菅谷 勇斗", "篠崎 叶", "柳井 悠花", "日下 澄子", "澤間 紋華"],
    "(チーム未定)": ["小川 亜佑実", "岩田 佑樹", "キム ギュリ", "田中 恵子"],
}
ALL_KNOWN_LEADERS = {name for names in KNOWN_LEADERS.values() for name in names}


def fiscal_year_range(fy_start_year: int):
    start = dt.date(fy_start_year, FISCAL_YEAR_START_MONTH, 1)
    end = dt.date(fy_start_year + 1, FISCAL_YEAR_START_MONTH, 1) - dt.timedelta(days=1)
    return start, end


def current_fiscal_year_start(today: dt.date = None) -> int:
    today = today or dt.date.today()
    return today.year if today.month >= FISCAL_YEAR_START_MONTH else today.year - 1


def fiscal_month_index(cal_year: int, cal_month: int, fy_start_year: int) -> int:
    """会計年度内での月インデックス(1=9月 ... 12=8月)を返す。"""
    if cal_month >= FISCAL_YEAR_START_MONTH:
        return cal_month - FISCAL_YEAR_START_MONTH + 1
    return cal_month + (12 - FISCAL_YEAR_START_MONTH) + 1


def fiscal_quarter(fiscal_month_idx: int) -> int:
    return (fiscal_month_idx - 1) // 3 + 1


def fetch_monthly_by_leader(start: dt.date, end: dt.date, target_org: str = "tcd-company") -> pd.DataFrame:
    soql = (
        "SELECT rida__r.Name ridaName, CALENDAR_YEAR(seikyuubi__c) yr, "
        "CALENDAR_MONTH(seikyuubi__c) mo, SUM(arari__c) grossProfit, COUNT(Id) cnt "
        "FROM Process__c "
        f"WHERE seikyuubi__c >= {start.isoformat()} AND seikyuubi__c <= {end.isoformat()} "
        f"AND phase__c IN {PHASES} "
        f"AND juchukakudo__c = {PROBABILITY_A} "
        "GROUP BY rida__r.Name, CALENDAR_YEAR(seikyuubi__c), CALENDAR_MONTH(seikyuubi__c) "
        "ORDER BY rida__r.Name"
    )
    records = query(soql, target_org)
    df = pd.DataFrame(records)
    df = df.drop(columns=[c for c in ["attributes"] if c in df.columns])
    df["grossProfit"] = df["grossProfit"].fillna(0)
    return df


def build_pivot(df: pd.DataFrame, fy_start_year: int, granularity: str) -> pd.DataFrame:
    df = df.copy()
    df["fiscalMonth"] = df.apply(
        lambda r: fiscal_month_index(int(r["yr"]), int(r["mo"]), fy_start_year), axis=1
    )
    if granularity == "month":
        df["period"] = df["fiscalMonth"].apply(lambda m: f"M{m:02d}")
    elif granularity == "quarter":
        df["period"] = df["fiscalMonth"].apply(lambda m: f"Q{fiscal_quarter(m)}")
    else:  # year
        df["period"] = "年計"

    pivot = df.pivot_table(
        index="ridaName", columns="period", values="grossProfit", aggfunc="sum", fill_value=0
    )
    if granularity == "month":
        col_order = [f"M{m:02d}" for m in range(1, 13) if f"M{m:02d}" in pivot.columns]
        pivot = pivot[col_order]
    elif granularity == "quarter":
        col_order = [f"Q{q}" for q in range(1, 5) if f"Q{q}" in pivot.columns]
        pivot = pivot[col_order]

    pivot["合計"] = pivot.sum(axis=1)
    pivot = pivot.sort_values("合計", ascending=False)
    return pivot


def flag_unknown_leaders(leader_names) -> list:
    return sorted(set(leader_names) - ALL_KNOWN_LEADERS)


def main() -> None:
    parser = argparse.ArgumentParser(description="リーダー別完了粗利の集計(請求日/フェーズ5種/受注確度A)")
    parser.add_argument("--fy", type=int, default=None, help="会計年度の開始年(例: 2025 = 2025/09〜2026/08)。省略時は今期")
    parser.add_argument(
        "--granularity", choices=["year", "quarter", "month"], default="year",
        help="集計粒度。year=年計のみ、quarter=四半期別、month=月別",
    )
    args = parser.parse_args()

    fy_start_year = args.fy if args.fy is not None else current_fiscal_year_start()
    start, end = fiscal_year_range(fy_start_year)

    print(f"対象期間: {start} 〜 {end}（請求日ベース・フェーズ5種・受注確度A）\n")

    monthly = fetch_monthly_by_leader(start, end)
    pivot = build_pivot(monthly, fy_start_year, args.granularity)

    total = pivot["合計"].sum()
    print(f"リーダー数: {len(pivot)} / 合計粗利: {total:,.0f}\n")
    print(pivot.to_string(float_format=lambda v: f"{v:,.0f}"))

    unknown = flag_unknown_leaders(pivot.index)
    if unknown:
        print("\n[要確認] チーム一覧にないリーダー名です。入力ミスの可能性があります:")
        for name in unknown:
            print(f"  - {name}: {pivot.loc[name, '合計']:,.0f}円")

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_path = os.path.join(
        project_root, "data", "processed",
        f"leader_arari_fy{fy_start_year}_{args.granularity}.csv",
    )
    pivot.to_csv(out_path)
    print(f"\n保存しました: {out_path}")


if __name__ == "__main__":
    main()
