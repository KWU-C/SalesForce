// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ManagementTabLink, ManagementTabs } from "./ManagementTabs";
import type { ManagementTab } from "./ManagementTabs";

const mountCount = { performance: 0 };

function PerformanceContent() {
  mountCount.performance += 1;
  return <p>業績の中身</p>;
}

function renderTabs() {
  const tabs: ManagementTab[] = [
    {
      id: "overview",
      label: "概要",
      content: (
        <>
          <p>概要の中身</p>
          <ManagementTabLink tab="finance">財務・資金繰りを見る</ManagementTabLink>
        </>
      ),
    },
    { id: "performance", label: "業績・採算", content: <PerformanceContent /> },
    { id: "finance", label: "財務・資金繰り", content: <p>財務の中身</p> },
    { id: "cashflow", label: "入出金明細", content: <p>入出金の中身</p> },
  ];
  return render(<ManagementTabs tabs={tabs} />);
}

const tab = (name: string) => screen.getByRole("tab", { name });
const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");
const visiblePanel = () => {
  const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
  return [...panels].filter((p) => !p.hidden);
};

describe("経営ダッシュボードのタブ", () => {
  beforeAll(() => {
    // jsdomには scrollIntoView が無い
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    mountCount.performance = 0;
  });

  it("初期表示は概要で、タブとパネルが aria-controls / aria-labelledby で対応している", () => {
    renderTabs();
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(selectedTab()?.textContent).toBe("概要");
    const panels = visiblePanel();
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toContain("概要の中身");
    for (const t of screen.getAllByRole("tab")) {
      const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(t.id);
    }
    // 選択中のタブだけがTab移動の対象(roving tabindex)
    expect(tab("概要").tabIndex).toBe(0);
    expect(tab("業績・採算").tabIndex).toBe(-1);
  });

  it("開いていないタブの中身は描画しない(隠したままグラフを描かない)", () => {
    renderTabs();
    expect(screen.queryByText("業績の中身")).toBeNull();
    expect(mountCount.performance).toBe(0);
  });

  it("クリックで切り替わり、一度開いたタブは往復しても作り直さない", () => {
    renderTabs();
    fireEvent.click(tab("業績・採算"));
    expect(selectedTab()?.textContent).toBe("業績・採算");
    expect(visiblePanel()[0].textContent).toContain("業績の中身");
    fireEvent.click(tab("概要"));
    expect(visiblePanel()[0].textContent).toContain("概要の中身");
    fireEvent.click(tab("業績・採算"));
    expect(mountCount.performance).toBe(1);
  });

  it("←→・Home・End で隣のタブへ移動し、選択とフォーカスが一致する", () => {
    renderTabs();
    tab("概要").focus();
    fireEvent.keyDown(tab("概要"), { key: "ArrowRight" });
    expect(selectedTab()?.textContent).toBe("業績・採算");
    expect(document.activeElement).toBe(tab("業績・採算"));
    fireEvent.keyDown(tab("業績・採算"), { key: "End" });
    expect(selectedTab()?.textContent).toBe("入出金明細");
    fireEvent.keyDown(tab("入出金明細"), { key: "ArrowRight" });
    expect(selectedTab()?.textContent).toBe("概要");
    fireEvent.keyDown(tab("概要"), { key: "ArrowLeft" });
    expect(selectedTab()?.textContent).toBe("入出金明細");
    fireEvent.keyDown(tab("入出金明細"), { key: "Home" });
    expect(selectedTab()?.textContent).toBe("概要");
    expect(document.activeElement).toBe(tab("概要"));
  });

  it("概要の「〜を見る」で切り替えると、選択タブと表示中のパネルが一致する", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: /財務・資金繰りを見る/ }));
    expect(selectedTab()?.textContent).toBe("財務・資金繰り");
    const panels = visiblePanel();
    expect(panels).toHaveLength(1);
    expect(panels[0].getAttribute("aria-labelledby")).toBe(tab("財務・資金繰り").id);
    expect(panels[0].textContent).toContain("財務の中身");
    expect(document.activeElement).toBe(tab("財務・資金繰り"));
  });
});
