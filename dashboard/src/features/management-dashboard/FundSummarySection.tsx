import { formatDateTime } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { DetailsBox, formatIsoMinute, NoteList, recordTimes, SubHeading, td, tdLeft, th, thLeft } from "./ReferenceForecastSections";
import {
  buildComparisonRows,
  isReflectedBy,
  forecastComputedAt,
  reserveDeductions,
  type FundActualRow,
  type FundComparisonRow,
  type FundForecastState,
  type ReserveDeduction,
} from "./fundSummary";
import { formatManYenInt, formatMonthDay, type ReferenceForecastRecord } from "./referenceForecast";

function monthEndLabel(month: number): string {
  return `${month}月末`;
}

function ymLabel(ym: string): string {
  return `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
}

/** 資金サマリーの主表の数値セル・見出し(中央揃え、2026-11-18 ユーザー指定)。共通の td/th は右揃えのため置き換える */
const tdCenter = td.replace("text-right", "text-center");
const thCenter = th.replace("text-right", "text-center");

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

/** 資金サマリーの金額(円、経理資料の資金繰り表と同じ表記)。key=控除後の預金総合計(強調・大)、highlight=当座・普通の月末残高 */
function yenCell(v: number | null, emphasis: "key" | "highlight" | "strong" | null = null) {
  const cls =
    emphasis === "key"
      ? "bg-[var(--surface-highlight)] text-base font-bold"
      : emphasis === "highlight"
        ? "bg-[var(--surface-highlight)] font-semibold"
        : emphasis === "strong"
          ? "font-semibold"
          : "";
  return (
    <td className={`${tdCenter} ${cls}`}>
      {v === null ? <span className="text-[var(--text-muted)]">—</span> : v.toLocaleString("ja-JP")}
    </td>
  );
}

/**
 * 概要「資金サマリー」(2026-11-17)。経理資料(資金繰り表)と比べられる計算構成の主表と短い注記だけを置く。
 * 表の形は経理資料の資金繰り表に倣う(ユーザー指定 data/sample.png、2026-11-17)。単位は円。
 * 月(締まった直近2か月＝実績、当月＝予測・標準ケース)ごとに 月末残高 / 納税・賞与の準備額 / 準備額控除後 の3行。
 * 準備額は預金総合計と当座・普通預金の2列にまたがる1セルで1つだけ出す(2026-11-18 ユーザー指定)。
 * 列: 預金総合計(差引。2026-11-18 見出しを「短期借入控除後」から変更) / 当座・普通預金 / 短期借入控除 / 定期預金
 * 計算式・根拠・未算入の支払・ケース比較は財務・資金繰りタブ(FundSummaryDetailSection)へ。
 */
export function FundSummarySection({
  actualRows,
  forecast,
  record,
}: {
  actualRows: FundActualRow[];
  forecast: FundForecastState;
  record: ReferenceForecastRecord | null;
}) {
  const fetchedActuals = actualRows.filter((r): r is Extract<FundActualRow, { status: "fetched" }> => r.status === "fetched");
  const rows = buildComparisonRows(actualRows, forecast, record);
  const reserve = record?.monthEndReserve ?? null;
  const times = record ? recordTimes(record) : null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="fund-summary">
      <SectionBanner>
        <span id="fund-summary">資金サマリー</span>
      </SectionBanner>
      <div className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
        <p>
          {"実績：freeeの月末残高"}
          {fetchedActuals.length > 0 &&
            `（freee取得 ${fetchedActuals.map((r) => `${monthEndLabel(r.target.month)} ${formatDateTime(r.fetchedAt)}`).join("／")}）`}
        </p>
        <p>
          {forecast.status === "available"
            ? `予測：資金の参考予測の標準ケース（銀行明細の最終同期日 ${times?.bankSyncedThrough ?? forecast.baseDate}／予測の計算 ${formatIsoMinute(forecast.computedAt)}）`
            : `予測：${forecast.reason}`}
        </p>
        <p>
          {reserve
            ? `準備額（推計）・控除額：計算 ${formatIsoMinute(times?.reserveComputedAt ?? reserve.fetchedAt)}（freeeの値から算出し記録に保存）。自動更新はせず、財務・資金繰りタブの再計算で更新`
            : "準備額（推計）・控除額：保存済みの記録に無いため表示していません"}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              <th className={thLeft} colSpan={2}>
                <span className="sr-only">月・項目</span>
              </th>
              <th className={thCenter}>預金総合計（差引）</th>
              <th className={thCenter}>当座・普通預金</th>
              <th className={thCenter}>短期借入控除</th>
              <th className={thCenter}>定期預金</th>
            </tr>
          </thead>
          {rows.map((r) => (
            <tbody key={`${r.kind}-${r.target.key}`} className="border-b border-[var(--border-hairline)] last:border-b-0">
              <tr className="border-b border-[var(--gridline)]">
                <th
                  scope="rowgroup"
                  rowSpan={r.missingReason !== null ? 1 : 3}
                  className="border-r border-[var(--gridline)] px-3 py-1.5 text-center align-middle font-semibold whitespace-nowrap text-[var(--text-primary)]"
                >
                  {`${r.target.month}月`}
                </th>
                <td className={`${tdLeft} border-r border-[var(--gridline)]`}>
                  {`月末残高（${r.kind === "actual" ? "実績" : "予測"}）`}
                </td>
                {r.missingReason !== null ? (
                  <td colSpan={4} className={`${td} text-[var(--text-muted)]`}>
                    {r.missingReason}
                  </td>
                ) : (
                  <>
                    {yenCell(r.afterDeduction, "key")}
                    {yenCell(r.checkingSavings, "highlight")}
                    {yenCell(r.deduction === null ? null : -r.deduction, "strong")}
                    {yenCell(r.timeDeposit, "strong")}
                  </>
                )}
              </tr>
              {r.missingReason === null && (
                <>
                  <tr className="border-b border-dashed border-[var(--baseline)]">
                    <td className={`${tdLeft} border-r border-[var(--gridline)]`}>納税・賞与の準備額（推計）</td>
                    {/* 準備額は両列に共通の1つの額なので、預金総合計と当座・普通預金の2列にまたがって1つだけ出す */}
                    <td colSpan={2} className={tdCenter}>
                      {r.reserve === null ? <span className="text-[var(--text-muted)]">—</span> : r.reserve.toLocaleString("ja-JP")}
                    </td>
                    <td className={td} />
                    <td className={td} />
                  </tr>
                  <tr>
                    <td className={`${tdLeft} border-r border-[var(--gridline)]`}>準備額控除後</td>
                    {yenCell(r.afterReserve)}
                    {yenCell(r.checkingAfterReserve)}
                    <td className={td} />
                    <td className={td} />
                  </tr>
                </>
              )}
            </tbody>
          ))}
        </table>
      </div>
      <NoteList
        items={[
          "単位：円。預金総合計は現金を含みません。短期借入控除はfreeeの短期借入金（当座貸越）の月末残高で、経理資料の「担保」と同じ意味かは確認していません。",
          "準備額は推計です。発生済みで未納付の消費税と、次回賞与の見込額の積立分です（支払見込額とは別の計算）。計算式・根拠・算入していない支払・ケース比較は財務・資金繰りタブにあります。",
        ]}
      />
    </section>
  );
}

function yenOrNone(v: number): string {
  return v === 0 ? "0円" : yen(v);
}

function ReserveMonthFormula({ row }: { row: FundComparisonRow }) {
  const m = row.target.month;
  const rm = row.reserveMonth;
  if (row.missingReason !== null || !rm || row.depositTotal === null || row.afterDeduction === null || row.afterReserve === null) {
    return <li>{`${m}月末：${row.missingReason ?? "控除額・準備額が記録に無いため算出していません"}`}</li>;
  }
  const t = rm.consumptionTax;
  const b = rm.bonus;
  const taxTerms = [
    t.payable > 0 ? `未払消費税等 ${yen(t.payable)}` : null,
    `${t.payable > 0 ? "＋ " : ""}仮受消費税 ${yen(t.received)}`,
    `− 仮払消費税 ${yen(t.paid)}`,
    t.interimPaid > 0 ? `− 当期の中間納付済み ${yen(t.interimPaid)}` : null,
    t.assumedMonths > 0 ? `＋ 仮定の発生額 ${yen(t.assumedMonthly)} × ${t.assumedMonths}か月` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-0.5">
      <span className="font-medium text-[var(--text-primary)]">{`${m}月末（${rm.kind}）`}</span>
      <span>{`短期借入控除後 ${yen(row.afterDeduction)} ＝ 預金総合計 ${yen(row.depositTotal)} − 短期借入 ${yen(rm.shortTermBorrowing)}`}</span>
      <span>{`消費税の準備額 ${yenOrNone(t.amount)} ＝ ${taxTerms.join(" ")}`}</span>
      <span>{`賞与の準備額 ${yenOrNone(b.amount)} ＝ 見込額 ${yen(b.estimate)} × ${b.elapsedMonths}/${b.spanMonths}か月`}</span>
      <span>{`準備額控除後の参考残高 ${yen(row.afterReserve)} ＝ ${yen(row.afterDeduction)} − 準備額 ${yen(rm.reserveTotal)}`}</span>
    </li>
  );
}

/**
 * 財務・資金繰りタブ「資金サマリーの計算」(2026-11-17)。概要の主表の計算式・控除額の確認・準備額の仮定・ケース比較・限界。
 */
export function FundSummaryDetailSection({
  actualRows,
  forecast,
  record,
}: {
  actualRows: FundActualRow[];
  forecast: FundForecastState;
  record: ReferenceForecastRecord | null;
}) {
  const rows = buildComparisonRows(actualRows, forecast, record);
  const reserve = record?.monthEndReserve ?? null;
  const row = forecast.status === "available" ? forecast.row : null;
  const forecastRm = rows.find((r) => r.kind === "forecast")?.reserveMonth ?? null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="fund-summary-detail">
      <SectionBanner>
        <span id="fund-summary-detail">資金サマリーの計算（控除額・準備額）</span>
      </SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        概要の資金サマリーの計算式と根拠です。経理資料（資金繰り表）と比べられるよう、預金総合計 → 控除 → 準備額の順に並べています。経理資料の数値は計算に使っていません。
      </p>
      <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 text-xs text-[var(--text-secondary)]">
        <SubHeading>月末ごとの計算式</SubHeading>
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <ReserveMonthFormula key={`${r.kind}-${r.target.key}`} row={r} />
          ))}
        </ul>
      </div>

      <DetailsBox summary="控除額（短期借入）の確認">
        <NoteList
          items={[
            ...(reserve?.deductionCheck ?? ["控除額が記録に無いため表示していません"]),
            ...(forecastRm
              ? [`銀行別（${forecastRm.month}、freee）：${forecastRm.shortTermBorrowingByBank.map((x) => `${x.bank} ${formatManYenInt(x.amount)}`).join("／")}`]
              : []),
          ]}
        />
      </DetailsBox>
      <DetailsBox summary="納税・賞与の準備額（推計）の計算方法と仮定">
        <NoteList items={reserve?.assumptions ?? ["準備額が記録に無いため表示していません"]} />
      </DetailsBox>
      <DetailsBox summary="予測のケース比較・月中の最低残高">
        <NoteList
          items={
            row
              ? [
                  `標準ケースの${monthEndLabel(row.target.month)}：当座・普通 ${formatManYenInt(row.checkingSavings)}／預金総合計 ${formatManYenInt(row.depositTotal)}（定期 ${formatManYenInt(row.timeDeposit)}＝起点の定期＋予測期間中の定期積立）`,
                  ...(row.cautious
                    ? [`慎重ケースの${monthEndLabel(row.target.month)}：当座・普通 ${formatManYenInt(row.cautious.checkingSavings)}／預金総合計 ${formatManYenInt(row.cautious.depositTotal)}`]
                    : []),
                  `${row.target.month}月中の最低残高（日末・当座・普通）：標準 ${formatManYenInt(row.standardMin.amount)}（${formatMonthDay(row.standardMin.date)}）` +
                    (row.cautiousMin ? `／慎重 ${formatManYenInt(row.cautiousMin.amount)}（${formatMonthDay(row.cautiousMin.date)}）` : ""),
                  "ケースは確認した条件を置き換えた比較で、予測の上限・下限ではありません",
                ]
              : ["予測が無いため表示していません"]
          }
        />
      </DetailsBox>
      <DetailsBox summary="根拠・限界（資金サマリー）">
        <NoteList
          items={[
            "実績：freeeの月次資金収支（月末後に取得したもの）の口座種類別の月末残高。当座・普通預金合計＝当座預金・普通預金、預金総合計＝当座・普通＋定期預金（小口現金・保険積立金を含まない）",
            "予測：保存済みの資金の参考予測（このタブの「資金の参考予測」と同じ記録）の標準ケースの月末残高",
            "予測・控除額・準備額は手動で計算・保存したもので、自動更新しません。実績（freeeの定時更新）とは取得日時が違います",
            "準備額控除後の参考残高は、自由に使える額（資金余力）ではありません。算入していない支払は下の「支払見込額」を参照",
          ]}
        />
      </DetailsBox>
    </section>
  );
}

function DeductionFormula({ d }: { d: ReserveDeduction }) {
  const m = Number(d.month.slice(5, 7));
  const minus = d.deducted.map((i) => `${i.label} ${formatManYenInt(i.amount)}`).join(" ＋ ");
  return (
    <li>
      <span className="font-medium text-[var(--text-primary)]">{`${m}月末：${formatManYenInt(d.balanceAfter)}`}</span>
      {`（＝ ${m}月末予測 ${formatManYenInt(d.forecastBalance)} − （${minus}））`}
      {d.included.length > 0 && (
        <span className="text-[var(--text-muted)]">{`。${d.included.map((i) => i.label).join("・")}は${m}月末予測に出金として含まれるため差し引かない`}</span>
      )}
    </li>
  );
}

/**
 * 「納税・賞与の支払見込額（参考）」(2026-11-17)。財務・資金繰りタブの資金サマリーの計算の下に置く。
 * - 将来の支払見込額(対象月・金額・根拠): freeeの実績・予定から。不足は仮定を明示した推計
 * - 予測への反映は予測の月末ごと(11月末予測・12月末予測)に示す。含まれる支払は控除しない
 * - 控除後の残高は「把握済みの将来支払を控除した参考残高」で、資金余力ではない。未算入の項目をすぐ下に出す
 * - 会計上の残高(賞与引当金など)は支払見込額・準備額ではないので、別枠で参考として出す。PDFの準備額は転記しない
 * - 予測は再計算していない。予測の基準日・計算日時と、支払準備の追加日時を分けて出す
 */
export function PaymentReserveSection({ record }: { record: ReferenceForecastRecord }) {
  const reserve = record.paymentReserve;
  if (!reserve) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">納税・賞与の支払見込額（参考）</h3>
        <p className="text-xs text-[var(--text-muted)]">保存済みの参考予測に支払準備の集計がありません。</p>
      </div>
    );
  }
  const deductions = reserveDeductions(record);
  const forecastMonths = deductions.map((d) => d.month);
  const a = reserve.accounting;
  const taxNet = a.consumptionTaxReceived - a.consumptionTaxPaid;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 text-xs">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">納税・賞与の支払見込額（参考）</h3>
        <p className="text-[var(--text-secondary)]">
          次に支払う額と時期（freeeの実績・予定から集計）。資金サマリーの「準備額」（月末に手元に残しておく額の目安）とは別の計算で、会計上の引当金残高でもありません。
        </p>
        <p className="text-[var(--text-muted)]">
          {`予測：基準日 ${record.baseDate}／計算 ${formatIsoMinute(forecastComputedAt(record))}`}
          {record.derivedFrom
            ? `／支払見込・準備額の追加：${formatIsoMinute(record.createdAt)}（freee取得 ${formatIsoMinute(reserve.fetchedAt)}）。予測は再計算していません`
            : `／freee取得 ${formatIsoMinute(reserve.fetchedAt)}`}
          {record.computeMode === "devRecompute" ? "。DEVの再計算で更新（自動更新なし）" : "。手動計算のため自動更新なし"}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              <th className={thLeft}>項目</th>
              <th className={thLeft}>対象月</th>
              <th className={th}>支払見込額</th>
              <th className={thLeft}>区分</th>
              {forecastMonths.map((m) => (
                <th key={m} className={thLeft}>{`${Number(m.slice(5, 7))}月末予測`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reserve.items.map((item) => (
              <tr key={item.id} className="border-b border-[var(--gridline)] align-top last:border-b-0">
                <td className={`${tdLeft} whitespace-normal`}>
                  <span className="font-medium text-[var(--text-primary)]">{item.label}</span>
                  <span className="mt-0.5 block max-w-xl text-xs leading-relaxed text-[var(--text-muted)]">{`根拠：${item.basis}`}</span>
                </td>
                <td className={tdLeft}>{ymLabel(item.targetMonth)}</td>
                <td className={`${td} font-semibold`}>{formatManYenInt(item.amount)}</td>
                <td className={tdLeft}>{item.kind}</td>
                {forecastMonths.map((m) =>
                  isReflectedBy(item, m) ? (
                    <td key={m} className={tdLeft}>
                      含む（控除しない）
                    </td>
                  ) : (
                    <td key={m} className={`${tdLeft} font-medium text-[var(--text-primary)]`}>
                      含まない → 控除
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deductions.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 text-xs text-[var(--text-secondary)]">
          <p className="text-sm font-medium text-[var(--text-primary)]">把握済みの将来支払を控除した参考残高（当座・普通預金、標準ケース）</p>
          <p className="text-[var(--text-muted)]">
            月末予測 − その予測に含まれない上表の支払見込額。資金余力（自由に使える額）ではありません。
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {deductions.map((d) => (
              <DeductionFormula key={d.month} d={d} />
            ))}
          </ul>
          <div className="mt-2 border-t border-[var(--gridline)] pt-2">
            <p className="font-medium text-[var(--text-primary)]">この参考残高に算入していない支払</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {(reserve.notIncluded ?? ["冬季賞与の会社負担の社会保険料", "法人税・住民税等の納付", "予測期間より後の通常の入出金"]).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <DetailsBox summary="会計上の残高・支払実績・集計の確認・限界（支払準備）">
        <div className="flex flex-col gap-1">
          <SubHeading>{`会計上の残高（freee試算表、${a.asOf}時点）— 支払見込額・準備額ではありません`}</SubHeading>
          <NoteList
            items={[
              `賞与引当金 ${yen(a.bonusProvision)}：期間按分の費用計上の残高。支払見込額（冬季賞与の総支給は前年実績で${yen(
                reserve.history.bonus[0]?.gross ?? 0
              )}）とは一致しないため、準備額としては使っていません`,
              `未払消費税等 ${yen(a.consumptionTaxPayable)}（前期分の確定納付は済み）`,
              `仮受消費税 ${yen(a.consumptionTaxReceived)} − 仮払消費税 ${yen(a.consumptionTaxPaid)} ＝ ${yen(taxNet)}：当期の期首からの差額。期末の確定納付は中間納付を差し引いた額になるため、この額も準備額ではありません`,
            ]}
          />
        </div>
        {reserve.verification && (
          <div className="flex flex-col gap-1">
            <SubHeading>消費税の集計の確認（年度・税目・範囲）</SubHeading>
            <NoteList items={reserve.verification.consumptionTax} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <SubHeading>支払実績（freee）</SubHeading>
          <NoteList
            items={[
              ...reserve.history.consumptionTax.map((h) => `消費税 ${h.kind}：${h.date} ${yen(h.amount)}`),
              ...reserve.history.bonus.map(
                (b) => `賞与（${b.label}）：${b.payDate ?? "—"} 総支給 ${yen(b.gross)}／預り ${yen(b.deductions)}／振込 ${yen(b.net)}`
              ),
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <SubHeading>限界</SubHeading>
          <NoteList items={reserve.limits} />
        </div>
      </DetailsBox>
    </div>
  );
}
