"""今期(会計年度)の完了粗利を集計する。

完了の定義:
- 受注確定していること (フェーズが「提案」「見積」「失注」以外)
- かつ、フェーズが「請求」「入金」まで進んでいる(実績)
  または、納品予定日が今期末以前(実績+今期末までの見込み)

対象期間は 受注日(juchuubi__c) が今期(会計年度)に入っている案件(Process__c)。
TCDの会計年度は9月始まり〜翌8月終わり。
"""

import datetime as dt
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from sf_cli import query

FISCAL_YEAR_START_MONTH = 9

CONFIRMED_PHASES = "('提案','見積','失注')"
DONE_PHASES = "('請求','入金')"


def fiscal_year_range(today: Optional[dt.date] = None):
    today = today or dt.date.today()
    if today.month >= FISCAL_YEAR_START_MONTH:
        start = dt.date(today.year, FISCAL_YEAR_START_MONTH, 1)
        end = dt.date(today.year + 1, FISCAL_YEAR_START_MONTH, 1) - dt.timedelta(days=1)
    else:
        start = dt.date(today.year - 1, FISCAL_YEAR_START_MONTH, 1)
        end = dt.date(today.year, FISCAL_YEAR_START_MONTH, 1) - dt.timedelta(days=1)
    return start, end


def _completion_condition(fy_end: dt.date) -> str:
    return (
        f"phase__c NOT IN {CONFIRMED_PHASES} "
        f"AND (phase__c IN {DONE_PHASES} OR nouhinyoteibi__c <= {fy_end.isoformat()})"
    )


def fetch_summary(fy_start: dt.date, fy_end: dt.date, target_org: str = "tcd-company") -> dict:
    soql = (
        "SELECT COUNT(Id) cnt, SUM(uriagegoukei__c) revenue, "
        "SUM(genka_goukei__c) cost, SUM(arari__c) grossProfit "
        "FROM Process__c "
        f"WHERE juchuubi__c >= {fy_start.isoformat()} AND juchuubi__c <= {fy_end.isoformat()} "
        f"AND {_completion_condition(fy_end)}"
    )
    records = query(soql, target_org)
    return records[0]


def fetch_monthly(fy_start: dt.date, fy_end: dt.date, target_org: str = "tcd-company") -> pd.DataFrame:
    soql = (
        "SELECT CALENDAR_YEAR(juchuubi__c) yr, CALENDAR_MONTH(juchuubi__c) mo, "
        "COUNT(Id) cnt, SUM(uriagegoukei__c) revenue, SUM(genka_goukei__c) cost, "
        "SUM(arari__c) grossProfit "
        "FROM Process__c "
        f"WHERE juchuubi__c >= {fy_start.isoformat()} AND juchuubi__c <= {fy_end.isoformat()} "
        f"AND {_completion_condition(fy_end)} "
        "GROUP BY CALENDAR_YEAR(juchuubi__c), CALENDAR_MONTH(juchuubi__c) "
        "ORDER BY CALENDAR_YEAR(juchuubi__c), CALENDAR_MONTH(juchuubi__c)"
    )
    records = query(soql, target_org)
    df = pd.DataFrame(records)
    df = df.drop(columns=[c for c in ["attributes"] if c in df.columns])
    return df


def main() -> None:
    fy_start, fy_end = fiscal_year_range()
    print(f"対象期間: {fy_start} 〜 {fy_end}\n")

    summary = fetch_summary(fy_start, fy_end)
    print("=== 今期完了粗利(サマリー) ===")
    print(f"対象案件数: {summary['cnt']}")
    print(f"売上合計: {summary['revenue']:,}")
    print(f"原価合計: {summary['cost']:,}")
    print(f"完了粗利: {summary['grossProfit']:,}")

    monthly = fetch_monthly(fy_start, fy_end)
    print("\n=== 月別内訳 ===")
    print(monthly.to_string(index=False))

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_path = os.path.join(project_root, "data", "processed", f"kanryo_arari_fy{fy_start.year}.csv")
    monthly.to_csv(out_path, index=False)
    print(f"\n月別データを保存しました: {out_path}")


if __name__ == "__main__":
    main()
