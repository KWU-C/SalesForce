import { describe, expect, it } from "vitest";
import { computeResourceLoad, STANDARD_GROSS_PROFIT_PER_PERSON_DAY, AVAILABLE_PERSON_DAYS_PER_MONTH } from "./resourceLoad";
import type { ResourceLoadDeal } from "./resourceLoad";

const CR_IDS = ["CR1", "CR2", "CR3", "CR4"] as const;
const HEADCOUNT = { CR1: 11, CR2: 9, CR3: 13, CR4: 8 };

describe("computeResourceLoad", () => {
  it("distributes a deal's gross profit evenly across order month through completion month (inclusive)", () => {
    // 受注:2026-01, 完了:2026-12 → 12か月均等配分。現在月9月なら9,10,11月のみが現在以降
    const deals: ResourceLoadDeal[] = [
      { crId: "CR1", grossProfit: 12_000_000, orderDate: "2026-01-15", completionDate: "2026-12-01" },
    ];

    const { crLoads } = computeResourceLoad(deals, CR_IDS, 2026, 9, HEADCOUNT);
    const cr1 = crLoads.find((c) => c.crId === "CR1")!;

    // 12,000,000 / 12ヶ月 = 1,000,000円/月。現在月(9月)分のみ
    expect(cr1.referenceGrossProfit1m).toBe(1_000_000);
    // 現在月+翌月+翌々月(9,10,11月) = 3,000,000円
    expect(cr1.referenceGrossProfit3m).toBe(3_000_000);
  });

  it("does not re-count amounts already allocated to months before the current month", () => {
    // 受注:2025-09, 完了:2026-08 → 12か月配分。現在月2026-09は配賦期間の外(過去の消化済み)
    const deals: ResourceLoadDeal[] = [
      { crId: "CR2", grossProfit: 1_200_000, orderDate: "2025-09-01", completionDate: "2026-08-31" },
    ];

    const { crLoads } = computeResourceLoad(deals, CR_IDS, 2026, 9, HEADCOUNT);
    const cr2 = crLoads.find((c) => c.crId === "CR2")!;

    expect(cr2.referenceGrossProfit1m).toBe(0);
    expect(cr2.referenceGrossProfit3m).toBe(0);
  });

  it("computes required/available person-days and load rate from headcount and the fixed constants", () => {
    const deals: ResourceLoadDeal[] = [
      { crId: "CR3", grossProfit: STANDARD_GROSS_PROFIT_PER_PERSON_DAY * 13 * AVAILABLE_PERSON_DAYS_PER_MONTH, orderDate: "2026-09-01", completionDate: "2026-09-30" },
    ];

    const { crLoads } = computeResourceLoad(deals, CR_IDS, 2026, 9, HEADCOUNT);
    const cr3 = crLoads.find((c) => c.crId === "CR3")!;

    expect(cr3.requiredPersonDays1m).toBeCloseTo(13 * AVAILABLE_PERSON_DAYS_PER_MONTH, 5);
    expect(cr3.availablePersonDays1m).toBe(13 * AVAILABLE_PERSON_DAYS_PER_MONTH);
    expect(cr3.loadRate1m).toBeCloseTo(100, 5);
  });

  it("treats null grossProfit as 0 rather than throwing or producing NaN", () => {
    const deals: ResourceLoadDeal[] = [
      { crId: "CR4", grossProfit: null, orderDate: "2026-09-01", completionDate: "2026-09-30" },
    ];

    const { crLoads } = computeResourceLoad(deals, CR_IDS, 2026, 9, HEADCOUNT);
    const cr4 = crLoads.find((c) => c.crId === "CR4")!;

    expect(cr4.referenceGrossProfit1m).toBe(0);
    expect(cr4.loadRate1m).toBe(0);
  });

  it("excludes and counts anomalies where completion month precedes order month", () => {
    const deals: ResourceLoadDeal[] = [
      { crId: "CR1", grossProfit: 1_000_000, orderDate: "2026-09-01", completionDate: "2026-08-01" },
    ];

    const { crLoads, anomalyCount } = computeResourceLoad(deals, CR_IDS, 2026, 9, HEADCOUNT);
    const cr1 = crLoads.find((c) => c.crId === "CR1")!;

    expect(anomalyCount).toBe(1);
    expect(cr1.referenceGrossProfit1m).toBe(0);
  });

  it("sums multiple deals within the same CR and month", () => {
    const deals: ResourceLoadDeal[] = [
      { crId: "CR1", grossProfit: 800_000, orderDate: "2026-09-01", completionDate: "2026-09-30" },
      { crId: "CR1", grossProfit: 1_600_000, orderDate: "2026-08-01", completionDate: "2026-10-31" },
    ];

    const { crLoads } = computeResourceLoad(deals, CR_IDS, 2026, 9, HEADCOUNT);
    const cr1 = crLoads.find((c) => c.crId === "CR1")!;

    // 800,000(9月のみ配賦) + 1,600,000/3ヶ月分(8,9,10月)のうち9月分のみ = 800,000 + 533,333.33...
    expect(cr1.referenceGrossProfit1m).toBeCloseTo(800_000 + 1_600_000 / 3, 2);
  });
});
