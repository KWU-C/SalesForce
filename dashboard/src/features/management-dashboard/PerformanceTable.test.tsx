// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PerformanceTable } from "./PerformanceTable";

// 金額はすべて架空
describe("業績・採算の表(2026-11-18)", () => {
  afterEach(cleanup);
  const heads = {
    inProgressMonth: 11,
    adjusted: { label: "累計・仕掛品振替反映分", period: "9月", monthCount: 1 },
    progress: { label: "帳簿上の進捗", period: "9月–11月" },
  };

  it("円・▲で出し、累計の2列は概要と同じ範囲(仕掛品振替反映分=9月、帳簿上の進捗=9〜11月)、当月は途中の帳簿値", () => {
    render(
      <PerformanceTable
        months={[9, 10, 11]}
        heads={heads}
        rows={[{ kind: "amount", label: "売上高", values: [25_942_217, 44_312_656, 686_056], cumulative: 70_940_929, previousCumulative: 88_709_777 }]}
      />
    );
    expect(screen.getByText("途中の帳簿値")).toBeTruthy();
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["25,942,217", "44,312,656", "686,056", "25,942,217", "70,940,929", "88,709,777", "▲17,768,848（▲20.0%）"]);
  });

  it("利益の前年比は増減額を基本とし、前年が赤字・0円なら増減率を出さない", () => {
    render(
      <PerformanceTable
        months={[9]}
        heads={{ ...heads, inProgressMonth: null }}
        rows={[
          { kind: "amount", label: "営業利益", values: [9_160_743], cumulative: 9_160_743, previousCumulative: -1_530_912 },
          { kind: "amount", label: "経常利益", values: [8_287_365], cumulative: 8_287_365, previousCumulative: 0 },
        ]}
      />
    );
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("＋10,691,655");
    expect(cells).toContain("＋8,287,365");
    expect(cells.some((c) => c?.includes("%"))).toBe(false);
  });
});
