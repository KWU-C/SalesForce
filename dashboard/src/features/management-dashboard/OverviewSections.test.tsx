// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PerformanceSummaryBand, PreviousMonthEndBalance } from "./OverviewSections";
import { targetMonth } from "./overviewComparison";
import type { CashColumn, PerformanceColumn } from "./overviewComparison";

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
    render(<PerformanceSummaryBand kind="adjusted" column={column()} failed={false} />);
    expect(screen.getByRole("heading", { name: "9月–10月 累計・仕掛品振替反映分" })).toBeTruthy();
    expect(screen.getByText(/50期・2026年9月1日〜2026年10月31日の累計（2ヶ月）/)).toBeTruthy();
    const titles = screen.getAllByText(/^(売上高累計|経常利益累計)$/).map((e) => e.textContent);
    expect(titles).toEqual(["売上高累計", "経常利益累計"]);
    expect(screen.getByText("増減 ＋¥700（＋87.5%）")).toBeTruthy();
    // 前年が赤字でも増減額で読む。営業利益累積は経常利益の補足
    expect(screen.getByText("前年同期 ▲¥600")).toBeTruthy();
    expect(screen.getByText("増減 ＋¥400")).toBeTruthy();
    expect(screen.getByText("営業利益累計 ▲¥30")).toBeTruthy();
    // 売上総利益は独立したボックスにしない
    expect(screen.queryByText(/売上総利益/)).toBeNull();
  });

  it("9月に開いたときの実績は前期9月–8月(年をまたぐ)、期首月だけの進捗は「9月」", () => {
    render(<PerformanceSummaryBand kind="adjusted" column={column({ through: targetMonth(49, 8) })} failed={false} />);
    expect(screen.getByRole("heading", { name: "9月–8月 累計・仕掛品振替反映分" })).toBeTruthy();
    expect(screen.getByText(/49期・2025年9月1日〜2026年8月31日の累計/)).toBeTruthy();
    cleanup();
    render(<PerformanceSummaryBand kind="progress" column={column({ through: targetMonth(51, 9) })} failed={false} />);
    expect(screen.getByRole("heading", { name: "9月 帳簿上の進捗" })).toBeTruthy();
    expect(screen.getByText(/51期・2027年9月1日〜2027年9月30日の累計/)).toBeTruthy();
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
    expect(screen.getByRole("heading", { name: "9月–11月 帳簿上の進捗" })).toBeTruthy();
    expect(screen.getAllByText("未取得")).toHaveLength(2);
    expect(screen.getByText(/11月は保存された値が無いため、累計を表示していません/)).toBeTruthy();
    expect(screen.getByText(/前年同期（49期）の11月が未取得/)).toBeTruthy();
    expect(screen.getByText(/10月はfreeeで仕掛品振替が未検出/)).toBeTruthy();
    expect(screen.getByText(/11月分はfreeeに登録済みの11月日付の取引を含む途中の値です/)).toBeTruthy();
  });
});

describe("仕掛品振替反映分・経理確認済みの累計", () => {
  afterEach(cleanup);

  it("経理確認の指定があれば見出しを「経理確認済み」にし、対象外の月・振替未検出を事実どおり書く", () => {
    render(
      <PerformanceSummaryBand
        kind="adjusted"
        column={column({ noWipTransferMonths: [10] })}
        failed={false}
        basis={{ kind: "confirmed", through: targetMonth(50, 10), updatedAt: new Date("2026-11-16T01:00:00Z") }}
        excludedMonths={[targetMonth(50, 11)]}
      />
    );
    expect(screen.getByRole("heading", { name: "9月–10月 累計・経理確認済み" })).toBeTruthy();
    expect(screen.getByText(/経理確認で指定された10月までです/)).toBeTruthy();
    expect(screen.getByText(/50期11月は月末を経過していますが、経理確認の対象月に含まれていないため/)).toBeTruthy();
    expect(screen.getByText(/10月はfreeeで仕掛品振替が未検出ですが、経理確認の指定にもとづき累計に含めています/)).toBeTruthy();
  });

  it("未指定なら暫定の仕掛品振替反映分。月末を経過した対象外の月を明示し、対象の月が無ければ累計を出さない", () => {
    render(
      <PerformanceSummaryBand
        kind="adjusted"
        column={column({ through: targetMonth(50, 9), months: [9] })}
        failed={false}
        excludedMonths={[targetMonth(50, 10)]}
      />
    );
    expect(screen.getByRole("heading", { name: "9月 累計・仕掛品振替反映分" })).toBeTruthy();
    expect(screen.getByText(/50期10月は月末を経過していますが、freeeで仕掛品振替が未検出のため/)).toBeTruthy();
    cleanup();
    render(<PerformanceSummaryBand kind="adjusted" column={null} failed={false} />);
    expect(screen.getByText(/経理確認の対象月が未指定で、仕掛品振替が確認できた月/)).toBeTruthy();
  });
});

describe("資金残高（前月末実績）", () => {
  afterEach(cleanup);
  const fetched = (amount: number | null): CashColumn => ({
    status: "fetched",
    checkingSavings: 700,
    timeDeposit: 400,
    depositTotalBeforeCollateral: 1_100,
    depositTotalAfterCollateral: amount === null ? null : 1_100 - amount,
    collateral: { amount, asOf: amount === null ? null : "2026-10-05", source: null },
    cashClosing: 1_103,
    kindsDifference: 0,
    fetchedAt: new Date("2026-11-16T05:42:00Z"),
  });

  it("freeeの月末残高の内訳を対象月・取得日時つきで出し、担保控除額が未登録なら未設定(予定資料で補わない)", () => {
    render(<PreviousMonthEndBalance target={targetMonth(50, 10)} cash={fetched(null)} />);
    expect(screen.getByRole("heading", { name: "資金残高（2026年10月末実績）" })).toBeTruthy();
    expect(screen.getByText(/50期10月末（2026年10月31日）時点のfreeeの残高／freee取得: 2026\/11\/16 14:42/)).toBeTruthy();
    expect(screen.getByText("¥700")).toBeTruthy();
    expect(screen.getByText("¥1,100")).toBeTruthy();
    expect(screen.getByText("うち定期預金 ¥400")).toBeTruthy();
    expect(screen.getByText("未設定")).toBeTruthy();
    expect(screen.getByText(/担保控除額が経理の管理設定に未登録/)).toBeTruthy();
    expect(screen.queryByText(/予定）/)).toBeNull();
  });

  it("担保控除額が登録されていれば、その額と基準日で控除後を出す。月末後の取得が無ければ金額を出さない", () => {
    render(<PreviousMonthEndBalance target={targetMonth(50, 10)} cash={fetched(300)} />);
    expect(screen.getByText("¥800")).toBeTruthy();
    expect(screen.getByText("担保控除額 ¥300（2026-10-05時点の経理の管理設定）")).toBeTruthy();
    cleanup();
    render(
      <PreviousMonthEndBalance
        target={targetMonth(50, 10)}
        cash={{ status: "notFetched", collateral: { amount: null, asOf: null, source: null } }}
      />
    );
    expect(screen.getByText(/月末後にfreeeから取得した値がまだ無い/)).toBeTruthy();
  });
});
