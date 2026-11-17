import { formatDateTime } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { DetailsBox, formatIsoMinute, NoteList, SubHeading, td, tdLeft, th, thLeft } from "./ReferenceForecastSections";
import {
  isReflectedBy,
  forecastComputedAt,
  reserveDeductions,
  type FundActualRow,
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

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function KindTag({ children, tone }: { children: React.ReactNode; tone: "actual" | "forecast" }) {
  const cls =
    tone === "actual"
      ? "border-[var(--border-hairline)] text-[var(--text-secondary)]"
      : "border-[var(--series-1)] text-[var(--series-1)]";
  return <span className={`rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

/**
 * 概要「資金サマリー」(2026-11-17、「資金サマリー」「資金残高」を統合)。実績2か月＋当月末の予測(標準)を1つの表にする。
 * 借入・資金収支・現預金と借入の差額は財務・資金繰り／入出金明細タブに置き、ここには出さない。
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
  const row = forecast.status === "available" ? forecast.row : null;
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
            ? `予測：資金の参考予測の標準ケース（基準日 ${forecast.baseDate}／計算 ${formatIsoMinute(forecast.computedAt)}）。手動計算のため自動更新なし`
            : `予測：${forecast.reason}`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              <th className={thLeft}>月末</th>
              <th className={thLeft}>区分</th>
              <th className={th}>当座・普通預金合計</th>
              <th className={th}>預金総合計（当座・普通・定期）</th>
            </tr>
          </thead>
          <tbody>
            {actualRows.map((r) => (
              <tr key={r.target.key} className="border-b border-[var(--gridline)]">
                <td className={`${tdLeft} font-medium text-[var(--text-primary)]`}>{monthEndLabel(r.target.month)}</td>
                <td className={tdLeft}>
                  <KindTag tone="actual">実績</KindTag>
                </td>
                {r.status === "fetched" ? (
                  <>
                    <td className={`${td} text-base font-semibold`}>{formatManYenInt(r.checkingSavings)}</td>
                    <td className={`${td} text-base font-semibold`}>{formatManYenInt(r.depositTotal)}</td>
                  </>
                ) : (
                  <td colSpan={2} className={`${td} text-[var(--text-muted)]`}>
                    月末後にfreeeから取得した値が無いため表示していません
                  </td>
                )}
              </tr>
            ))}
            <tr>
              <td className={`${tdLeft} font-medium text-[var(--text-primary)]`}>{monthEndLabel(forecast.status === "available" ? forecast.row.target.month : forecast.target.month)}</td>
              <td className={tdLeft}>
                <KindTag tone="forecast">予測（標準）</KindTag>
              </td>
              {row ? (
                <>
                  <td className={`${td} text-base font-semibold`}>{formatManYenInt(row.checkingSavings)}</td>
                  <td className={`${td} text-base font-semibold`}>{formatManYenInt(row.depositTotal)}</td>
                </>
              ) : (
                <td colSpan={2} className={`${td} text-[var(--text-muted)]`}>
                  予測なし
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {row && (
        <ul className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
          {row.cautious && (
            <li>
              {`慎重ケースの${monthEndLabel(row.target.month)}：当座・普通 ${formatManYenInt(row.cautious.checkingSavings)}／預金総合計 ${formatManYenInt(row.cautious.depositTotal)}`}
            </li>
          )}
          <li>
            {`${row.target.month}月中の最低残高（日末・当座・普通）：標準 ${formatManYenInt(row.standardMin.amount)}（${formatMonthDay(row.standardMin.date)}）`}
            {row.cautiousMin ? `／慎重 ${formatManYenInt(row.cautiousMin.amount)}（${formatMonthDay(row.cautiousMin.date)}）` : ""}
          </li>
        </ul>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        ※ 預金総合計は現金を含まず、担保・引当の控除前の金額です。予測はケースの比較で、予測の上限・下限ではありません。
      </p>

      <DetailsBox summary="資金サマリーの根拠・推計・限界">
        <div className="flex flex-col gap-1">
          <SubHeading>根拠</SubHeading>
          <NoteList
            items={[
              "実績：freeeの月次資金収支（月末後に取得したもの）の口座種類別の月末残高。当座・普通預金合計＝当座預金・普通預金、預金総合計＝当座・普通＋定期預金（小口現金・保険積立金を含まない）",
              "予測：保存済みの資金の参考予測（財務・資金繰りタブ「資金の参考予測」と同じ記録）の標準ケースの月末残高。慎重ケースと月中の日末最低残高は補足として示す",
              row
                ? `予測の定期預金：起点（${forecast.status === "available" ? forecast.baseDate : ""}）の定期預金${formatManYenInt(record?.cash.startTimeDeposit ?? 0)}＋予測期間中の定期積立＝${formatManYenInt(row.timeDeposit)}`
                : "予測の定期預金：予測が無いため算出していません",
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <SubHeading>推計・限界</SubHeading>
          <NoteList
            items={[
              "予測は手動で計算・保存したもので、自動更新しません。実績（freeeの定時更新）とは取得日時が違います",
              "借入残高・当月の資金収支・現預金と借入の差額は、財務・資金繰り／入出金明細タブに置いています",
              ...(record?.notes.limits.slice(0, 1) ?? []),
            ]}
          />
        </div>
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
 * 「納税・賞与の支払準備（参考）」(2026-11-17)。資金サマリーの主表の下に置く。
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
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">納税・賞与の支払準備（参考）</h3>
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
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">納税・賞与の支払準備（参考）</h3>
        <p className="text-[var(--text-secondary)]">
          将来の支払見込額（freeeの実績・予定から集計）。会計上の引当金残高や、経理報告の資金留保のための準備額ではありません。
        </p>
        <p className="text-[var(--text-muted)]">
          {`予測：基準日 ${record.baseDate}／計算 ${formatIsoMinute(forecastComputedAt(record))}`}
          {record.derivedFrom
            ? `／支払準備の追加：${formatIsoMinute(record.createdAt)}（freee取得 ${formatIsoMinute(reserve.fetchedAt)}）。予測は再計算していません`
            : `／freee取得 ${formatIsoMinute(reserve.fetchedAt)}`}
          。手動計算のため自動更新なし
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
