import { createHash } from "node:crypto";
import { monthEndNext } from "./calendar";
import type { RfDeal, RfSfProcess } from "./types";

/**
 * Salesforce案件とfreee売上取引の照合(scripts/reference-forecast/match.py の移植、2026-11-18)。
 * 取引先名は照合にだけ使い、出力には匿名ID(ハッシュ)と集計だけを残す。
 */

export interface SfReceiptEvent {
  date: string;
  amount: number;
  kind: "SF予定" | "SF補完(空欄)" | "SF補完(異常日付)";
  billed: string;
  sfId: string;
  /** 同じ取引先(部分一致を含む)に、請求月以降の同額のfreee取引がある(移動先の月での二重計上の確認用) */
  freeeSameAmountLater: boolean;
}

export interface MatchingSummary {
  byClass: { label: string; count: number; amount: number }[];
  ambiguous: { class: string; reason: string; count: number; amount: number }[];
  freeeUnmatchedUnsettled: { count: number; amount: number };
}

const CORP_WORDS = ["株式会社", "(株)", "有限会社", "一般財団法人", "公益財団法人", "学校法人", "合同会社", " ", "　", "・"];

export function normalizeName(s: string | null | undefined): string {
  let t = (s ?? "").normalize("NFKC");
  for (const w of CORP_WORDS) t = t.split(w).join("");
  return t;
}

function partnerRel(a: string, b: string): "exact" | "partial" | null {
  if (!a || !b) return null;
  if (a === b) return "exact";
  if (a.includes(b) || b.includes(a)) return "partial";
  return null;
}

const anon = (prefix: string, x: string) => prefix + createHash("sha1").update(x).digest("hex").slice(0, 8);

function* combinations<T>(arr: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < arr.length; i++) yield* combinations(arr, k, i + 1, [...acc, arr[i]]);
}

const OK_PHASES = new Set(["受注", "納品", "請求", "入金"]);

interface SfRow {
  id: string;
  s: string;
  ny: string | null;
  amt: number;
  p: string;
}

interface FrRow {
  id: number;
  issue: string;
  due: string;
  amt: number;
  dueAmt: number;
  status: "settled" | "unsettled";
  p: string;
}

export function matchSales(
  processes: RfSfProcess[],
  incomeDeals: RfDeal[],
  partners: Map<number, string>,
  baseDate: string,
  /** 照合の対象: Salesforceは請求日がこの日以降、freeeは発生日がこの日の1か月前以降 */
  sinceBilled: string,
  sinceIssued: string
): { events: SfReceiptEvent[]; summary: MatchingSummary } {
  const statusAsOf = (d: RfDeal): ["settled" | "unsettled", number] => {
    const later = d.payments.filter((p) => p.date > baseDate).reduce((s, p) => s + p.amount, 0);
    const due = d.dueAmount + later;
    return [due > 0 ? "unsettled" : "settled", due];
  };
  const allPartners = new Set([...partners.values()].map(normalizeName).filter(Boolean));
  const S: SfRow[] = processes
    .filter((r) => OK_PHASES.has(r.phase) && r.probability.startsWith("A") && r.billedDate && r.billedDate >= sinceBilled)
    .map((r) => ({ id: r.id, s: r.billedDate as string, ny: r.plannedReceiptDate, amt: Math.round(r.amountTaxIncluded), p: normalizeName(r.billToName) }));
  const Fd: FrRow[] = incomeDeals
    .filter((d) => d.issueDate >= sinceIssued && d.issueDate <= baseDate)
    .map((d) => {
      const [status, due] = statusAsOf(d);
      return { id: d.id, issue: d.issueDate, due: d.dueDate ?? "", amt: d.amount, dueAmt: due, status, p: normalizeName(partners.get(d.partnerId ?? -1) ?? "") };
    });

  type Flag = string | { otherMonthCheck: true; p: string; m: string };
  const result: { x: SfRow; fs: FrRow[]; how: string; flags: Flag[] }[] = [];
  const fused = new Set<number>();
  const groups = new Map<string, SfRow[]>();
  for (const x of S) {
    const key = `${x.p}\u0000${x.s.slice(0, 7)}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  for (const [key, xs] of groups) {
    const [p, m] = key.split("\u0000");
    const cand = Fd.filter((f) => !fused.has(f.id) && partnerRel(p, f.p) && f.issue.slice(0, 7) === m);
    const rels = new Set(cand.map((f) => partnerRel(p, f.p)));
    const names = new Set(cand.map((f) => f.p));
    const flagsG: string[] = [];
    if (rels.has("partial")) flagsG.push("名称の部分一致");
    if (names.size > 1) flagsG.push("複数の取引先名に一致");
    const cntSf = new Map<number, number>();
    for (const x of xs) cntSf.set(x.amt, (cntSf.get(x.amt) ?? 0) + 1);
    const cntFr = new Map<number, number>();
    for (const f of cand) cntFr.set(f.amt, (cntFr.get(f.amt) ?? 0) + 1);
    for (const x of [...xs].sort((a, b) => a.amt - b.amt)) {
      const f = cand.find((f) => !fused.has(f.id) && Math.abs(f.amt - x.amt) <= 1);
      if (f) {
        fused.add(f.id);
        const fl: Flag[] = [...flagsG];
        if ((cntSf.get(x.amt) ?? 0) > 1 || (cntFr.get(f.amt) ?? 0) > 1) fl.push("同額が複数(件数で割当)");
        result.push({ x, fs: [f], how: "1対1", flags: fl });
      }
    }
    let rest = xs.filter((x) => !result.some((r) => r.x === x));
    for (const x of [...rest]) {
      const pool = cand.filter((f) => !fused.has(f.id));
      let hit: FrRow[] | null = null;
      for (const k of [2, 3, 4]) {
        for (const comb of combinations(pool, k)) {
          if (Math.abs(comb.reduce((s, f) => s + f.amt, 0) - x.amt) <= k) {
            hit = comb;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) {
        for (const f of hit) fused.add(f.id);
        result.push({ x, fs: hit, how: "分割(SF1件=freee複数)", flags: [...flagsG, "金額の組合せで照合"] });
        rest = rest.filter((r) => r !== x);
      }
    }
    for (const f of cand.filter((f) => !fused.has(f.id))) {
      for (const k of [2, 3, 4]) {
        let hit: SfRow[] | null = null;
        for (const comb of combinations(rest, k)) {
          if (Math.abs(comb.reduce((s, x) => s + x.amt, 0) - f.amt) <= k) {
            hit = comb;
            break;
          }
        }
        if (hit) {
          fused.add(f.id);
          for (const x of hit) {
            result.push({ x, fs: [f], how: "まとめ(SF複数=freee1件)", flags: [...flagsG, "金額の組合せで照合"] });
            rest = rest.filter((r) => r !== x);
          }
          break;
        }
      }
    }
    const hasPartnerDeals = Fd.some((f) => partnerRel(p, f.p) && f.issue.slice(0, 7) === m);
    for (const x of rest) {
      const fl: Flag[] = [...flagsG, { otherMonthCheck: true, p, m }];
      if (!hasPartnerDeals && !allPartners.has(p) && [...allPartners].some((q) => partnerRel(p, q) === "partial")) {
        fl.push("取引先名が部分一致でしか見つからない");
      }
      result.push({ x, fs: [], how: hasPartnerDeals ? "判定保留(同じ取引先のfreee取引と金額が合わない)" : "freee未登録", flags: fl });
    }
  }

  const resolved = result.map((r) => {
    const flags: string[] = [];
    for (const item of r.flags) {
      if (typeof item === "string") flags.push(item);
      else if (
        Fd.some(
          (f) =>
            !fused.has(f.id) && f.issue >= sinceBilled && partnerRel(item.p, f.p) && f.issue.slice(0, 7) !== item.m && Math.abs(f.amt - r.x.amt) <= 1
        )
      ) {
        flags.push("請求月の違う同額のfreee取引(未照合)あり");
      }
    }
    return { ...r, flags };
  });

  const events: SfReceiptEvent[] = [];
  const classes: { cls: string; amt: number; flags: string[] }[] = [];
  const currentMonthStart = `${baseDate.slice(0, 7)}-01`;
  for (const { x, fs, how, flags } of resolved) {
    let cls: string;
    if (fs.length > 0) cls = fs.every((f) => f.status === "settled") ? "入金済み除外" : "freee採用";
    else if (how === "freee未登録") {
      if (x.s < currentMonthStart) cls = "判定保留(前月以前の請求でfreee未登録)";
      else if (flags.length > 0) cls = "判定保留(曖昧)";
      else cls = "Salesforce追加";
    } else cls = "判定保留";
    let ny = x.ny;
    let kind: SfReceiptEvent["kind"] = "SF予定";
    if (!ny) {
      ny = monthEndNext(x.s);
      kind = "SF補完(空欄)";
    } else if (ny < x.s) {
      ny = monthEndNext(x.s);
      kind = "SF補完(異常日付)";
    }
    if (cls === "Salesforce追加") {
      const laterSame = Fd.some((f) => partnerRel(x.p, f.p) && Math.abs(f.amt - x.amt) <= 1 && f.issue >= `${x.s.slice(0, 7)}-01`);
      events.push({ date: ny, amount: x.amt, kind, billed: x.s, sfId: anon("SF-", x.id), freeeSameAmountLater: laterSame });
    }
    classes.push({ cls, amt: x.amt, flags });
  }

  const byClass = new Map<string, { count: number; amount: number }>();
  const amb = new Map<string, { count: number; amount: number }>();
  for (const c of classes) {
    const b = byClass.get(c.cls) ?? { count: 0, amount: 0 };
    byClass.set(c.cls, { count: b.count + 1, amount: b.amount + c.amt });
    for (const reason of new Set(c.flags)) {
      const key = `${c.cls}\u0000${reason}`;
      const a = amb.get(key) ?? { count: 0, amount: 0 };
      amb.set(key, { count: a.count + 1, amount: a.amount + c.amt });
    }
  }
  const fun = Fd.filter((f) => !fused.has(f.id) && f.status === "unsettled");
  return {
    events,
    summary: {
      byClass: [...byClass.entries()].map(([label, v]) => ({ label, ...v })),
      ambiguous: [...amb.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => {
          const [cls, reason] = k.split("\u0000");
          return { class: cls, reason, ...v };
        }),
      freeeUnmatchedUnsettled: { count: fun.length, amount: fun.reduce((s, f) => s + f.dueAmt, 0) },
    },
  };
}
