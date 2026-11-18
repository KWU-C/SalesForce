// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PerformanceSummaryTable } from "./OverviewSections";
import { targetMonth } from "./overviewComparison";
import type { PerformanceColumn } from "./overviewComparison";

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

const progressCol = () => column({ through: targetMonth(50, 11), months: [9, 10, 11] });

describe("経営サマリーの表", () => {
  afterEach(cleanup);

  it("累計と帳簿上の進捗を1つの表にし、列は売上高累計→経常利益累計→営業利益累計、行は当期累計/前年同期/増減", () => {
    render(<PerformanceSummaryTable adjusted={{ column: column(), failed: false }} progress={{ column: progressCol(), failed: false }} />);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader").map((e) => e.textContent)).toEqual(["期間・項目", "売上高累計", "経常利益累計", "営業利益累計"]);
    const groups = screen.getAllByRole("rowheader").map((e) => e.textContent);
    expect(groups).toEqual(["9月–10月累計・仕掛品振替反映分", "9月–11月帳簿上の進捗"]);
    expect(screen.getByText(/9月–10月 累計・仕掛品振替反映分：50期・2026年9月1日〜2026年10月31日の累計（2ヶ月）/)).toBeTruthy();
    expect(screen.getByText(/9月–11月 帳簿上の進捗：.*11月分はfreeeに登録済みの11月日付の取引を含む途中の値です/)).toBeTruthy();
    const firstRows = screen.getAllByRole("row").slice(1, 4).map((r) => r.textContent);
    // 前年が赤字でも増減額で読む。率は売上高だけ
    expect(firstRows).toEqual(["9月–10月累計・仕掛品振替反映分当期累計1,500▲200▲30", "前年同期800▲60010", "増減＋700（＋87.5%）＋400▲40"]);
    expect(screen.queryByText(/売上総利益/)).toBeNull();
  });

  it("9月に開いたときの実績は前期9月–8月(年をまたぐ)、期首月だけの進捗は「9月」", () => {
    render(
      <PerformanceSummaryTable
        adjusted={{ column: column({ through: targetMonth(49, 8) }), failed: false }}
        progress={{ column: column({ through: targetMonth(51, 9) }), failed: false }}
      />
    );
    expect(screen.getByText(/9月–8月 累計・仕掛品振替反映分：49期・2025年9月1日〜2026年8月31日の累計/)).toBeTruthy();
    expect(screen.getByText(/^9月 帳簿上の進捗：51期・2027年9月1日〜2027年9月30日の累計/)).toBeTruthy();
  });

  it("未取得・前年同期の欠け・仕掛品振替未検出を隠さず出す(0円で代用しない)", () => {
    const missing = { current: null, previous: null, change: null };
    render(
      <PerformanceSummaryTable
        adjusted={{ column: column(), failed: false }}
        progress={{
          column: column({
            through: targetMonth(50, 11),
            months: [9, 10, 11],
            amounts: { revenue: missing, grossProfit: missing, operatingProfit: missing, ordinaryProfit: missing },
            missingMonths: [11],
            previousMissingMonths: [11],
            noWipTransferMonths: [10],
          }),
          failed: false,
        }}
      />
    );
    expect(screen.getAllByText("未取得")).toHaveLength(6);
    expect(screen.getAllByText("比較不可")).toHaveLength(3);
    expect(screen.getByText(/9月–11月 帳簿上の進捗：11月は保存された値が無いため、累計を表示していません/)).toBeTruthy();
    expect(screen.getByText(/前年同期（49期）の11月が未取得/)).toBeTruthy();
    expect(screen.getByText(/10月はfreeeで仕掛品振替が未検出です/)).toBeTruthy();
  });
});

describe("仕掛品振替反映分・経理確認済みの累計", () => {
  afterEach(cleanup);

  it("経理確認の指定があれば「経理確認済み」にし、対象外の月・振替未検出を事実どおり書く", () => {
    render(
      <PerformanceSummaryTable
        adjusted={{
          column: column({ noWipTransferMonths: [10] }),
          failed: false,
          basis: { kind: "confirmed", through: targetMonth(50, 10), updatedAt: new Date("2026-11-16T01:00:00Z") },
          excludedMonths: [targetMonth(50, 11)],
        }}
        progress={{ column: progressCol(), failed: false }}
      />
    );
    expect(screen.getAllByRole("rowheader")[0].textContent).toBe("9月–10月累計・経理確認済み");
    expect(screen.getByText(/経理確認で指定された10月までです/)).toBeTruthy();
    expect(screen.getByText(/50期11月は月末を経過していますが、経理確認の対象月に含まれていないため/)).toBeTruthy();
    expect(screen.getByText(/10月はfreeeで仕掛品振替が未検出ですが、経理確認の指定にもとづき累計に含めています/)).toBeTruthy();
  });

  it("未指定なら暫定の仕掛品振替反映分。対象外の月を明示し、対象の月が無ければ累計を出さない", () => {
    render(
      <PerformanceSummaryTable
        adjusted={{ column: column({ through: targetMonth(50, 9), months: [9] }), failed: false, excludedMonths: [targetMonth(50, 10)] }}
        progress={{ column: progressCol(), failed: false }}
      />
    );
    expect(screen.getAllByRole("rowheader")[0].textContent).toBe("9月累計・仕掛品振替反映分");
    expect(screen.getByText(/50期10月は月末を経過していますが、freeeで仕掛品振替が未検出のため/)).toBeTruthy();
    cleanup();
    render(<PerformanceSummaryTable adjusted={{ column: null, failed: false }} progress={{ column: progressCol(), failed: false }} />);
    expect(screen.getByText(/経理確認の対象月が未指定で、仕掛品振替が確認できた月（月末後に取得したもの）も無い/)).toBeTruthy();
    expect(screen.getByText(/累計を表示していません（経理確認の対象月が未指定/)).toBeTruthy();
  });
});
