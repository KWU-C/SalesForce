// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CashPlanOutlook, PerformanceSummaryBand } from "./OverviewSections";
import { targetMonth } from "./overviewComparison";
import type { PerformanceColumn } from "./overviewComparison";
import type { CashPlan } from "./accountingReports";

// 金額はすべて架空の値
function column(overrides: Partial<PerformanceColumn> = {}): PerformanceColumn {
  return {
    through: targetMonth(50, 10),
    months: [9, 10],
    amounts: {
      revenue: { current: 1_500, previous: 800, change: 700 },
      grossProfit: { current: 500, previous: 300, change: 200 },
      operatingProfit: { current: -30, previous: 10, change: -40 },
      ordinaryProfit: { current: -200, previous: -600, change: 400 },
    },
    missingMonths: [],
    previousMissingMonths: [],
    noWipTransferMonths: [],
    fetchedFrom: new Date("2026-11-13T07:59:00Z"),
    fetchedTo: new Date("2026-11-13T07:59:30Z"),
    ...overrides,
  };
}

describe("経営サマリーの段", () => {
  afterEach(cleanup);

  it("帯に期間と実績/進捗を出し、売上高累積→経常利益累積の順に備考を並べる", () => {
    render(<PerformanceSummaryBand kind="actual" column={column()} failed={false} />);
    expect(screen.getByRole("heading", { name: "経営サマリー（9月–10月 実績）" })).toBeTruthy();
    expect(screen.getByText(/50期・2026年9月1日〜2026年10月31日の累積/)).toBeTruthy();
    const titles = screen.getAllByText(/^(売上高累積|経常利益累積)$/).map((e) => e.textContent);
    expect(titles).toEqual(["売上高累積", "経常利益累積"]);
    expect(screen.getByText("増減 ＋¥700（＋87.5%）")).toBeTruthy();
    // 前年が赤字でも増減額で読む。営業利益累積は経常利益の補足
    expect(screen.getByText("前年同期 ▲¥600")).toBeTruthy();
    expect(screen.getByText("増減 ＋¥400")).toBeTruthy();
    expect(screen.getByText("営業利益累積 ▲¥30")).toBeTruthy();
    // 売上総利益は独立したボックスにしない
    expect(screen.queryByText(/売上総利益/)).toBeNull();
  });

  it("9月に開いたときの実績は前期9月–8月(年をまたぐ)、期首月だけの進捗は「9月」", () => {
    render(<PerformanceSummaryBand kind="actual" column={column({ through: targetMonth(49, 8) })} failed={false} />);
    expect(screen.getByRole("heading", { name: "経営サマリー（9月–8月 実績）" })).toBeTruthy();
    expect(screen.getByText(/49期・2025年9月1日〜2026年8月31日の累積/)).toBeTruthy();
    cleanup();
    render(<PerformanceSummaryBand kind="progress" column={column({ through: targetMonth(51, 9) })} failed={false} />);
    expect(screen.getByRole("heading", { name: "経営サマリー（9月 進捗）" })).toBeTruthy();
    expect(screen.getByText(/51期・2027年9月1日〜2027年9月30日の累積/)).toBeTruthy();
  });

  it("進捗は当月を含む期間で、未取得・前年同期の欠け・仕掛品振替未検出を隠さず出す", () => {
    render(
      <PerformanceSummaryBand
        kind="progress"
        column={column({
          through: targetMonth(50, 11),
          months: [9, 10, 11],
          amounts: {
            revenue: { current: null, previous: null, change: null },
            grossProfit: { current: null, previous: null, change: null },
            operatingProfit: { current: null, previous: null, change: null },
            ordinaryProfit: { current: null, previous: null, change: null },
          },
          missingMonths: [11],
          previousMissingMonths: [11],
          noWipTransferMonths: [10],
        })}
        failed={false}
      />
    );
    expect(screen.getByRole("heading", { name: "経営サマリー（9月–11月 進捗）" })).toBeTruthy();
    expect(screen.getAllByText("未取得")).toHaveLength(2);
    expect(screen.getByText(/11月は保存された値が無いため、累積を表示していません/)).toBeTruthy();
    expect(screen.getByText(/前年同期（49期）の11月が未取得/)).toBeTruthy();
    expect(screen.getByText(/10月はfreeeで仕掛品振替が未検出です/)).toBeTruthy();
    expect(screen.getByText(/11月分はfreeeに登録済みの11月日付の取引を含む途中の値です/)).toBeTruthy();
  });
});

describe("収支予定", () => {
  afterEach(cleanup);

  it("登録済みの予定がある月だけ金額を出し、無い月は未算出(他の値で埋めない)", () => {
    const plan = {
      targetMonth: "2026-11",
      values: {
        checkingSavingsTotal: 1_000,
        timeDepositTotal: 300,
        collateralDeduction: 200,
        depositTotalAfterCollateral: 1_100,
        sourceUpdatedOn: "2026-10-14",
      },
    } as unknown as CashPlan;
    render(
      <CashPlanOutlook
        outlook={[
          { target: targetMonth(50, 11), plan },
          { target: targetMonth(50, 12), plan: null },
        ]}
        failed={false}
      />
    );
    expect(screen.getByText("¥1,000")).toBeTruthy();
    expect(screen.getByText("¥1,100")).toBeTruthy();
    expect(screen.getByText("うち担保控除額（予定に記載の額） ¥200")).toBeTruthy();
    expect(screen.getByText("2026/10/14時点・経理の資金繰り予定")).toBeTruthy();
    expect(screen.getAllByText("未算出")).toHaveLength(2);
    expect(screen.getByText(/登録された予定なし/)).toBeTruthy();
    expect(screen.getByText("2026年12月末（予定）")).toBeTruthy();
    expect(screen.getByText(/freeeが算出した予測ではありません/)).toBeTruthy();
  });
});
