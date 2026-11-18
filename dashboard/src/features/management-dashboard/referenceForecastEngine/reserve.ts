import type { ReferenceMonthEndReserve, ReferenceMonthEndReserveMonth, ReferencePaymentReserve } from "../referenceForecast";
import { addMonths, fiscalYearOf, lastDayOfMonth, monthsBetween } from "./calendar";
import type { RfInputs, RfTrialBsRow } from "./types";

/**
 * 納税・賞与の準備額(資金サマリー)と支払見込額(財務・資金繰りタブ)。
 * scripts/reference-forecast/month_end_reserve.py・payment_reserve.py の移植(2026-11-18)。計算方法は変えない(ユーザー指定)。
 * 準備額は「推計」: 月末時点で手元に残しておく額の目安で、支払見込額(次に支払う額)・会計上の引当金残高とは別。
 */

const yen = (v: number) => `${v.toLocaleString("ja-JP")}円`;

export interface BonusPlan {
  /** 次回の賞与支給月(YYYY-MM)。8〜12月の基準日は当年12月、1〜7月は当年7月 */
  nextMonth: string;
  /** 前年の同じ時期(見込額の元) */
  prevSameMonth: string;
  /** 前回の支給月 */
  lastMonth: string;
}

export function bonusPlan(baseMonth: string): BonusPlan {
  const y = Number(baseMonth.slice(0, 4));
  const m = Number(baseMonth.slice(5, 7));
  if (m >= 8) return { nextMonth: `${y}-12`, prevSameMonth: `${y - 1}-12`, lastMonth: `${y}-07` };
  return { nextMonth: `${y}-07`, prevSameMonth: `${y - 1}-07`, lastMonth: `${y - 1}-12` };
}

interface TaxHistory {
  interim: { date: string; amount: number }[];
  final: { date: string; amount: number; description: string }[];
}

function consumptionTaxHistory(inp: RfInputs): TaxHistory {
  const r = inp.reserve;
  const interim = r.provisionalTaxDeals
    .flatMap((d) => d.details.filter((x) => x.accountName === "仮払税金" && x.description.includes("消費税")).map((x) => ({ date: d.issueDate, amount: x.amount })))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const final = [
    ...r.consumptionTaxPayableDeals.flatMap((d) =>
      d.details.filter((x) => x.accountName === "未払消費税等").map((x) => ({ date: d.issueDate, amount: x.amount, description: x.description }))
    ),
    ...r.consumptionTaxPayableJournals.flatMap((j) =>
      j.details
        .filter((x) => x.accountName === "未払消費税等" && x.entrySide === "debit" && j.details.some((y) => y !== x && y.accountName.includes("預金")))
        .map((x) => ({ date: j.issueDate, amount: x.amount, description: x.description }))
    ),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { interim, final };
}

function bsValues(rows: RfTrialBsRow[] | undefined) {
  const v = (name: string) => rows?.find((b) => b.accountName === name)?.closing ?? 0;
  const stb = rows?.find((b) => b.accountName === "短期借入金");
  const stbItems = (stb?.items ?? []).filter((i) => i.closing).map((i) => ({ label: i.name, amount: i.closing }));
  const byBank = new Map<string, number>();
  for (const i of stbItems) {
    const bank = i.label.split("】").at(-1)?.split("/")[0] || "その他";
    byBank.set(bank, (byBank.get(bank) ?? 0) + i.amount);
  }
  return {
    payable: v("未払消費税等"),
    received: v("仮受消費税"),
    paid: v("仮払消費税"),
    bonusProvision: v("賞与引当金"),
    shortTermBorrowing: v("短期借入金"),
    byBank: [...byBank.entries()].map(([bank, amount]) => ({ bank, amount })),
    overdraftOnly: stbItems.length > 0 && stbItems.every((i) => i.label.includes("当座貸越") || i.label.includes("当貸")),
  };
}

export function computeReserves(inp: RfInputs): { monthEndReserve: ReferenceMonthEndReserve; paymentReserve: ReferencePaymentReserve; warnings: string[] } {
  const warnings: string[] = [];
  const M = inp.bankSyncedThrough.slice(0, 7);
  const actualMonths = [addMonths(M, -2), addMonths(M, -1)];
  const lastClosed = actualMonths[1];
  const fy = fiscalYearOf(M);
  const fyTerm = fy - 1976;
  const since = `${fy - 1}-09-01`;
  const prevEnd = `${fy}-08-31`;
  const tax = consumptionTaxHistory(inp);
  const prevInterims = tax.interim.filter((x) => x.date >= since && x.date <= prevEnd);
  const prevFinal = tax.final.filter((x) => x.date >= `${fy}-09-01` && x.date <= `${fy}-12-31`);
  const sumInterim = prevInterims.reduce((s, x) => s + x.amount, 0);
  const sumFinal = prevFinal.reduce((s, x) => s + x.amount, 0);
  const closing = { interim: 0, final: 0 };
  for (const j of inp.reserve.closingJournals) {
    for (const x of j.details) {
      if (x.entrySide === "credit" && x.accountName === "仮払税金" && x.description.includes("消費税予定申告")) closing.interim += x.amount;
      if (x.entrySide === "credit" && x.accountName === "未払消費税等" && x.description.includes("消費税確定分")) closing.final += x.amount;
    }
  }
  const taxChecked = closing.interim === sumInterim && closing.final === sumFinal && prevInterims.length > 0 && prevFinal.length === 1;
  if (!taxChecked) warnings.push(`消費税の前期の納付額が決算振替と一致しません(中間 ${yen(sumInterim)}/${yen(closing.interim)}・確定 ${yen(sumFinal)}/${yen(closing.final)})。準備額・支払見込額の消費税は要確認`);
  const annualTax = sumInterim + sumFinal;
  const monthlyTax = Math.floor(annualTax / 12);
  const interimPaidThisTerm = tax.interim.filter((x) => x.date >= `${fy}-09-01`);

  const plan = bonusPlan(M);
  const prevBonus = inp.bonusHistory[plan.prevSameMonth] ?? { payDate: null, gross: 0, deductions: 0, net: 0 };
  const lastBonus = inp.bonusHistory[plan.lastMonth] ?? { payDate: null, gross: 0, deductions: 0, net: 0 };
  if (prevBonus.net === 0) warnings.push(`前年の賞与(${plan.prevSameMonth})の支給実績が見つかりません。賞与の準備額は0円`);
  const bonusEstimate = prevBonus.net + prevBonus.deductions;
  const accrualFrom = addMonths((lastBonus.payDate ?? `${plan.lastMonth}-01`).slice(0, 7), 1);
  const accrualTo = addMonths(plan.nextMonth, -1);
  const span = monthsBetween(accrualFrom, accrualTo);
  const bonusPart = (month: string) => {
    const elapsed = month >= plan.nextMonth || month < accrualFrom ? 0 : monthsBetween(accrualFrom, month);
    return { estimate: bonusEstimate, elapsedMonths: elapsed, spanMonths: span, amount: span > 0 ? Math.floor((bonusEstimate * elapsed) / span) : 0 };
  };

  const months: ReferenceMonthEndReserveMonth[] = actualMonths.map((month) => {
    const b = bsValues(inp.reserve.trialBsByMonth[month]);
    const end = lastDayOfMonth(month);
    const interimPaid = interimPaidThisTerm.filter((x) => x.date <= end).reduce((s, x) => s + x.amount, 0);
    const t = { payable: b.payable, received: b.received, paid: b.paid, interimPaid, assumedMonths: 0, assumedMonthly: 0, amount: 0 };
    t.amount = Math.max(0, t.payable + t.received - t.paid - t.interimPaid);
    const bonus = bonusPart(month);
    return { month, kind: "実績", shortTermBorrowing: b.shortTermBorrowing, shortTermBorrowingByBank: b.byBank, overdraftOnly: b.overdraftOnly, consumptionTax: t, bonus, reserveTotal: t.amount + bonus.amount };
  });
  const cur = bsValues(inp.reserve.trialBsByMonth[M]);
  const lc = months[1].consumptionTax;
  const nAhead = monthsBetween(lastClosed, M) - 1;
  const paidAhead = interimPaidThisTerm.filter((x) => x.date > lastDayOfMonth(lastClosed) && x.date <= lastDayOfMonth(M)).reduce((s, x) => s + x.amount, 0);
  if (lc.payable !== 0) warnings.push(`${Number(lastClosed.slice(5, 7))}月末に未払消費税等が残っています。予測月中の納付の有無を確認すること`);
  const ft = { payable: lc.payable, received: lc.received, paid: lc.paid, interimPaid: lc.interimPaid + paidAhead, assumedMonths: nAhead, assumedMonthly: monthlyTax, amount: 0 };
  ft.amount = Math.max(0, lc.payable + lc.received - lc.paid - ft.interimPaid + monthlyTax * nAhead);
  const fbonus = bonusPart(M);
  months.push({ month: M, kind: "予測", shortTermBorrowing: cur.shortTermBorrowing, shortTermBorrowingByBank: cur.byBank, overdraftOnly: cur.overdraftOnly, consumptionTax: ft, bonus: fbonus, reserveTotal: ft.amount + fbonus.amount });

  const nextLabel = `${Number(plan.nextMonth.slice(5, 7))}月`;
  const monthEndReserve: ReferenceMonthEndReserve = {
    fetchedAt: inp.computedAt,
    months,
    assumptions: [
      "準備額は推計：月末時点で手元に残しておく額の目安。支払見込額（次に支払う額）・会計上の引当金残高とは別の計算",
      `消費税：月末までに発生し、まだ納付していない額（未払消費税等＋仮受消費税−仮払消費税−当期の中間納付済み額）を全額留保する。${Number(M.slice(5, 7))}月末（予測）は${Number(lastClosed.slice(5, 7))}月末の値に、${fyTerm - 1}期の年税額${yen(annualTax)}÷12＝${yen(monthlyTax)}を1か月分の発生額として加える（仮定）`,
      `賞与：次回（${nextLabel}）の支給見込額${yen(bonusEstimate)}（前年${nextLabel}の振込${yen(prevBonus.net)}＋預り分${yen(prevBonus.deductions)}。会社負担の社会保険料は含めない）を、前回支給（${lastBonus.payDate ?? "不明"}）の翌月から支給月の前月まで（${Number(accrualFrom.slice(5, 7))}〜${Number(accrualTo.slice(5, 7))}月の${span}か月）均等に積み立てる（仮定）`,
      "賞与引当金（会計上の残高）は準備額に使わない。経理資料（PDF）の引当・準備の額は転記しない",
      ...warnings,
    ],
    deductionCheck: [
      "控除額はfreeeの短期借入金の月末残高（予測の月末は取得時点の残高。参考予測に当座貸越の借入・返済は含まない）",
      months.every((m) => m.overdraftOnly) ? "freeeの短期借入金の品目はすべて当座貸越" : "freeeの短期借入金に当座貸越以外の品目がある",
      "経理資料（資金繰り表）は、定期預金の欄の「担保」として同額・同じ銀行別内訳を差し引いている。当座貸越の利用残高・極度額・担保設定額のどれを指すかは確認できていないため、同じ意味とはしていない",
    ],
  };

  // ---------- 支払見込額 ----------
  const acct = bsValues(inp.reserve.trialBsByMonth[lastClosed]);
  const interimEst = Math.floor((annualTax * 3) / 12);
  const items: ReferencePaymentReserve["items"] = [];
  const registeredInterim = interimPaidThisTerm[0];
  if (registeredInterim) {
    items.push({ id: "consumptionTaxInterim", label: `消費税 中間納付（${fyTerm}期 第1回）`, targetMonth: registeredInterim.date.slice(0, 7), amount: registeredInterim.amount, kind: "予定", reflectedInForecastFrom: null, basis: `freeeに登録済みの仮払税金の支払（${registeredInterim.date}）` });
  } else {
    items.push({
      id: "consumptionTaxInterim",
      label: `消費税 中間納付（${fyTerm}期 第1回、9〜11月分）`,
      targetMonth: `${fy + 1}-01`,
      amount: interimEst,
      kind: "推計",
      reflectedInForecastFrom: null,
      basis: `${fyTerm - 1}期の消費税（国・地方の計）${yen(annualTax)}＝中間納付${prevInterims.length}回 ${prevInterims.map((x) => yen(x.amount)).join("＋")}＋確定納付 ${prevFinal.map((x) => yen(x.amount)).join("＋")}（${prevFinal.map((x) => x.date).join("・")}）。中間納付1回分＝年税額×3/12＝${yen(interimEst)}。freeeに当期の中間納付は未登録。過去の納付実績からの概算。通知額は未確認`,
    });
  }
  const thisBonus = inp.bonus[plan.nextMonth] ?? null;
  const bonusFixed = !!thisBonus && thisBonus.fixed === thisBonus.count;
  const net = bonusFixed ? (thisBonus as NonNullable<typeof thisBonus>).net : prevBonus.net;
  const ded = bonusFixed ? (thisBonus as NonNullable<typeof thisBonus>).deductions : prevBonus.deductions;
  const src = bonusFixed
    ? `freee人事労務の${plan.nextMonth}賞与明細（確定${thisBonus?.count}件）`
    : `${plan.nextMonth}の賞与明細は${thisBonus ? "未確定" : "未作成"}のため、前年${nextLabel}の支給実績（${prevBonus.payDate ?? "不明"}、総支給${yen(prevBonus.gross)}・預り${yen(prevBonus.deductions)}・振込${yen(prevBonus.net)}）を使う`;
  const inHorizon = plan.nextMonth === M || plan.nextMonth === addMonths(M, 1);
  const season = plan.nextMonth.endsWith("-12") ? "冬季" : "夏季";
  items.push({ id: "bonusNet", label: `${season}賞与 振込（手取り）`, targetMonth: plan.nextMonth, amount: net, kind: bonusFixed ? "予定" : "推計", reflectedInForecastFrom: inHorizon ? plan.nextMonth : null, basis: src + (inHorizon ? "。資金予測にも同額を出金として計上" : "") });
  items.push({ id: "bonusDeductions", label: `${season}賞与の預り分（源泉所得税・社会保険料の本人負担）の納付`, targetMonth: addMonths(plan.nextMonth, 1), amount: ded, kind: "推計", reflectedInForecastFrom: null, basis: src + "。預り分は翌月に納付。会社負担の社会保険料は金額を算定できないため含めない" });

  const paymentReserve: ReferencePaymentReserve = {
    fetchedAt: inp.computedAt,
    accounting: { asOf: lastDayOfMonth(lastClosed), bonusProvision: acct.bonusProvision, consumptionTaxPayable: acct.payable, consumptionTaxReceived: acct.received, consumptionTaxPaid: acct.paid },
    items,
    history: {
      consumptionTax: [...tax.interim.map((x) => ({ date: x.date, amount: x.amount, kind: "中間納付" })), ...tax.final.map((x) => ({ date: x.date, amount: x.amount, kind: "確定納付" }))],
      bonus: [
        { label: `前年${nextLabel}`, payDate: prevBonus.payDate, gross: prevBonus.gross, deductions: prevBonus.deductions, net: prevBonus.net },
        { label: `前回（${plan.lastMonth}）`, payDate: lastBonus.payDate, gross: lastBonus.gross, deductions: lastBonus.deductions, net: lastBonus.net },
      ],
    },
    verification: {
      consumptionTax: [
        `年度：${fyTerm - 1}期（${since}〜${prevEnd}）の中間納付と、その確定納付（${prevFinal.map((x) => x.date).join("・") || "見つからない"}）`,
        "税目：仮払税金のうち摘要に「消費税」を含む支払だけを集計（同じ科目の中国税・海外分所得税は除外）",
        "範囲：国税と地方消費税の計（未払消費税等・仮払税金の計上単位）",
        taxChecked
          ? `照合：${prevEnd}の決算振替の「消費税予定申告」${yen(sumInterim)}・「消費税確定分」${yen(sumFinal)}と一致`
          : `照合：${prevEnd}の決算振替と一致しない（中間 ${yen(sumInterim)}/${yen(closing.interim)}・確定 ${yen(sumFinal)}/${yen(closing.final)}）。要確認`,
      ],
    },
    notIncluded: [
      `${season}賞与の会社負担の社会保険料（金額を算定していない）`,
      `消費税の第2回・第3回の中間納付と${fyTerm}期の確定納付`,
      "法人税・住民税等の納付",
      "資金予測の期間より後の通常の入出金（給与・社会保険料・借入返済・外注費・売掛金の入金など）",
      "当月末の参考残高は、翌月の通常の入出金（賞与以外）を含まない",
    ],
    limits: [
      "会計上の残高（賞与引当金・未払消費税等・仮受／仮払消費税）は帳簿の残高で、支払見込額・準備額ではない",
      "管理上の準備額（経理報告PDFの引当・準備の額）は転記していない",
      "消費税の中間納付額は過去の納付実績からの概算。通知額は未確認",
    ],
  };
  return { monthEndReserve, paymentReserve, warnings };
}
