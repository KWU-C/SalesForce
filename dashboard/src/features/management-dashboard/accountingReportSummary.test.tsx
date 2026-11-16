// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatOkuManYen, summarizeAccountingReport } from "./accountingReportSummary";
import { AccountingReportSummarySection } from "./AccountingReportSummarySection";
import { targetMonth } from "./overviewComparison";
import type { PerformanceColumn } from "./overviewComparison";
import type { MonthlyReport } from "./accountingReports";

// 金額はすべて架空の値
function report(month: string, values: Record<string, unknown>): MonthlyReport {
  return {
    targetMonth: month,
    values: { documentName: "経理報告", ...values },
    changeType: "initial",
    createdBy: "a@example.com",
    createdAt: "2026-10-20T01:00:00.000Z",
    updatedBy: "a@example.com",
    updatedAt: "2026-10-20T01:00:00.000Z",
    revisions: [],
  } as unknown as MonthlyReport;
}

const fullValues = {
  revenueCumulative: 30_000_000,
  prevYearRevenueCumulative: 10_000_000,
  monthlyRevenueTarget: 50_000_000,
  annualRevenueTarget: 600_000_000,
  ordinaryProfitCumulative: 2_000_000,
  prevYearOrdinaryProfitCumulative: -3_000_000,
  operatingProfitCumulative: 2_500_000,
  basisDate: "2026-10-31",
  cashWatchItems: "12月：賞与\n\n1月：消費税 ",
};

function freeeColumn(revenue: number | null, ordinary: number | null): PerformanceColumn {
  const amount = (current: number | null) => ({ current, previous: null, change: null });
  return {
    through: targetMonth(50, 10),
    months: [9, 10],
    amounts: { revenue: amount(revenue), grossProfit: amount(null), operatingProfit: amount(null), ordinaryProfit: amount(ordinary) },
    missingMonths: [],
    previousMissingMonths: [],
    noWipTransferMonths: [],
    fetchedFrom: null,
    fetchedTo: null,
  };
}

describe("formatOkuManYen", () => {
  it("資料と同じ億・万・円で1円単位まで書く", () => {
    expect(formatOkuManYen(12_345_678)).toBe("1,234万5,678円");
    expect(formatOkuManYen(-12_345_678)).toBe("▲1,234万5,678円");
    expect(formatOkuManYen(640_000_000)).toBe("6億4,000万円");
    expect(formatOkuManYen(1_200_000_005)).toBe("12億5円");
    expect(formatOkuManYen(0)).toBe("0円");
  });
});

describe("summarizeAccountingReport", () => {
  it("締まった月以前で最新の登録月を選び、前期比・目標差(月次目標×月数)を計算する", () => {
    const s = summarizeAccountingReport(
      [report("2026-09", fullValues), report("2026-10", fullValues), report("2026-11", fullValues)],
      targetMonth(50, 10)
    );
    expect(s.status).toBe("registered");
    if (s.status !== "registered") return;
    expect(s.report.targetMonth).toBe("2026-10");
    expect(s.monthCount).toBe(2);
    expect(s.revenueChange).toBe(20_000_000);
    expect(s.cumulativeRevenueTarget).toBe(100_000_000);
    expect(s.revenueTargetGap).toBe(-70_000_000);
    expect(s.ordinaryProfitChange).toBe(5_000_000);
    expect(s.cashWatchItems).toEqual(["12月：賞与", "1月：消費税"]);
    expect(s.latestClosedMissing).toBe(false);
  });

  it("前月の報告が無ければ古い月の報告を出し、未登録と分かるようにする。追加前の報告の新項目は未記載", () => {
    const s = summarizeAccountingReport([report("2026-09", { revenueCumulative: 1_000 })], targetMonth(50, 10));
    if (s.status !== "registered") throw new Error("registered expected");
    expect(s.latestClosedMissing).toBe(true);
    expect(s.monthCount).toBe(1);
    expect(s.basis).toEqual({ month: 9, day: 30, fromDocument: false });
    expect(s.operatingProfit).toBeNull();
    expect(s.revenueTargetGap).toBeNull();
    expect(s.cashWatchItems).toEqual([]);
  });

  it("登録が無ければ none", () => {
    expect(summarizeAccountingReport([report("2026-11", fullValues)], targetMonth(50, 10)).status).toBe("none");
  });
});

describe("経理報告の表示", () => {
  afterEach(cleanup);

  it("資料と同じ3段(売上高累計・経常利益・資金繰り)で出し、freee帳簿とは差だけ添える", () => {
    const summary = summarizeAccountingReport([report("2026-10", fullValues)], targetMonth(50, 10));
    render(<AccountingReportSummarySection summary={summary} freeeColumn={freeeColumn(30_000_000, 1_000_000)} failed={false} />);
    expect(screen.getByRole("heading", { name: "損益計算書：50期経理報告（10月31日現在実績） 2ヶ月" })).toBeTruthy();
    expect(screen.getByText("3,000万円")).toBeTruthy();
    expect(screen.getByText("前期売上高累計：1,000万円")).toBeTruthy();
    expect(screen.getByText("※2,000万円増加")).toBeTruthy();
    expect(screen.getByText("※月次目標：月5,000万円×2ヶ月より7,000万円下回る")).toBeTruthy();
    expect(screen.getByText("※通期目標：6億円")).toBeTruthy();
    expect(screen.getByText("累計200万円")).toBeTruthy();
    expect(screen.getByText("前期同月累計：▲300万円")).toBeTruthy();
    expect(screen.getByText("500万円増加")).toBeTruthy();
    expect(screen.getByText("※営業利益：250万円")).toBeTruthy();
    expect(screen.getByText("12月：賞与")).toBeTruthy();
    expect(screen.getByText("1月：消費税")).toBeTruthy();
    expect(screen.getByText("freee帳簿の同じ期間の累計と一致")).toBeTruthy();
    expect(screen.getByText("freee帳簿の同じ期間の累計 100万円（経理報告との差 ▲100万円）")).toBeTruthy();
  });

  it("前月分が未登録・登録が無いことを隠さない", () => {
    render(
      <AccountingReportSummarySection
        summary={summarizeAccountingReport([report("2026-09", fullValues)], targetMonth(50, 10))}
        freeeColumn={null}
        failed={false}
      />
    );
    expect(screen.getByText(/50期10月分の経理報告は未登録です/)).toBeTruthy();
    expect(screen.getAllByText(/月末後に取得した値が無いため未照合/)).toHaveLength(2);
    cleanup();
    render(<AccountingReportSummarySection summary={summarizeAccountingReport([], targetMonth(50, 10))} freeeColumn={null} failed={false} />);
    expect(screen.getByText("50期10月までの経理報告が登録されていません。")).toBeTruthy();
  });
});
