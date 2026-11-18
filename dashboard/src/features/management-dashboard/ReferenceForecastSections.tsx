import { ReferenceForecastRecomputeButton } from "./ReferenceForecastRecomputeButton";
import { SectionBanner } from "./SectionBanner";
import { forecastComputedAt } from "./fundSummary";
import {
  formatManYenDelta,
  formatManYenInt,
  formatMonthDay,
  MAIN_CASH_CASE_IDS,
  type ReferenceCashCase,
  type ReferenceForecastRecord,
} from "./referenceForecast";

/** 開閉欄(初期は閉じる)。業績・採算の範囲の説明と同じ見た目 */
export function DetailsBox({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] text-xs text-[var(--text-secondary)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 font-medium text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span aria-hidden="true" className="shrink-0 text-base leading-none text-[var(--text-muted)] transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-[var(--gridline)] px-4 pt-3 pb-4">{children}</div>
    </details>
  );
}

export function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="font-medium text-[var(--text-primary)]">{children}</p>;
}

export function NoteList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 leading-relaxed">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export const th = "px-2 py-1.5 text-right font-medium whitespace-nowrap text-[var(--text-muted)]";
export const thLeft = "px-2 py-1.5 text-left font-medium whitespace-nowrap text-[var(--text-muted)]";
export const td = "px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-[var(--text-primary)]";
export const tdLeft = "px-2 py-1.5 text-left whitespace-nowrap text-[var(--text-secondary)]";

function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}月`;
}

export function Badge() {
  return (
    <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-medium text-white">DEV・参考</span>
  );
}

/** 予測の記録の日時(2026-11-18、ユーザー指定で3つを分けて出す): 銀行明細の最終同期日・予測の計算日時・準備額(推計)の計算日時 */
export function recordTimes(record: ReferenceForecastRecord) {
  return {
    bankSyncedThrough: record.bankSyncedThrough ?? record.baseDate,
    cashComputedAt: forecastComputedAt(record),
    reserveComputedAt: record.reserveComputedAt ?? record.monthEndReserve?.fetchedAt ?? null,
    mode: record.computeMode === "devRecompute" ? "DEVの再計算" : "手動計算（ローカル）",
  };
}

function RecordCaption({ record }: { record: ReferenceForecastRecord }) {
  const t = recordTimes(record);
  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      <ul className="flex flex-col gap-0.5">
        <li>{`銀行明細の最終同期日：${t.bankSyncedThrough}（予測の基準日）`}</li>
        <li>{`予測の計算日時：${formatIsoMinute(t.cashComputedAt)}（${t.mode}、記録 ${record.derivedFrom ?? record.id}）`}</li>
        <li>{`準備額（推計）の計算日時：${t.reserveComputedAt ? formatIsoMinute(t.reserveComputedAt) : "—"}`}</li>
      </ul>
      <p>自動更新はしません。再計算すると新しい記録を追加し、過去の記録は残します（月末後に予測と実績を照合するため）。</p>
      <ReferenceForecastRecomputeButton />
    </div>
  );
}

/** "2026-11-17T09:14:06+09:00" → "2026-11-17 09:14" */
export function formatIsoMinute(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/** データを取得できず含められていない支出(慎重ケースの未登録外注など)。0円と区別して表示する */
function MissingOutflows({ c }: { c: ReferenceCashCase }) {
  if (!c.missingOutflows?.length) return null;
  return (
    <span className="block text-xs font-normal text-[var(--status-serious)]">
      {`必要な支出を含められていません（金額は実際より多い可能性）：${c.missingOutflows.join("／")}`}
    </span>
  );
}

const missingMark = (c: ReferenceCashCase) => (c.missingOutflows?.length ? "（未取得の支出あり）" : "");

function CaseBreakdown({ c }: { c: ReferenceCashCase }) {
  return (
    <div className="flex flex-col gap-1">
      <SubHeading>{c.label}</SubHeading>
      <MissingOutflows c={c} />
      {c.months.map((m) => (
        <div key={m.month} className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <caption className="py-1 text-left text-[var(--text-muted)]">
              {`${monthLabel(m.month)}：${formatManYenInt(m.start)} → ${formatManYenInt(m.end)}（増減 ${formatManYenDelta(m.end - m.start)}）`}
            </caption>
            <tbody>
              {Object.entries(m.byBasis).map(([k, v]) => (
                <tr key={`b-${k}`} className="border-t border-[var(--gridline)]">
                  <td className={tdLeft}>{`根拠：${k}`}</td>
                  <td className={td}>{formatManYenDelta(v)}</td>
                </tr>
              ))}
              {Object.entries(m.byCategory).map(([k, v]) => (
                <tr key={`c-${k}`} className="border-t border-[var(--gridline)]">
                  <td className={`${tdLeft} text-[var(--text-muted)]`}>{`分類：${k}`}</td>
                  <td className={td}>{formatManYenDelta(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** 財務・資金繰りタブ: 資金の参考予測(当座・普通預金、基準日の月と翌月) */
export function ReferenceCashForecastSection({ record }: { record: ReferenceForecastRecord }) {
  const mainCases = MAIN_CASH_CASE_IDS.map((id) => record.cash.cases.find((c) => c.id === id)).filter(
    (c): c is ReferenceCashCase => c !== undefined
  );
  const otherCases = record.cash.cases.filter((c) => !(MAIN_CASH_CASE_IDS as readonly string[]).includes(c.id));
  const months = mainCases[0]?.months.map((m) => m.month) ?? [];
  const chk = record.cash.checks;
  const pay = chk.payrollDecember;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="reference-cash-forecast">
      <SectionBanner right={<Badge />}>
        <span id="reference-cash-forecast">資金の参考予測（当座・普通預金）</span>
      </SectionBanner>
      <RecordCaption record={record} />
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              <th className={thLeft}>ケース</th>
              {months.map((m) => (
                <th key={`e-${m}`} className={th}>{`${monthLabel(m)}末`}</th>
              ))}
              {months.map((m) => (
                <th key={`l-${m}`} className={th}>{`${monthLabel(m)}の日末最低`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mainCases.map((c) => (
              <tr key={c.id} className="border-b border-[var(--gridline)]">
                <td className={`${tdLeft.replace("whitespace-nowrap", "whitespace-normal")} font-medium text-[var(--text-primary)]`}>
                  {c.label}
                  <MissingOutflows c={c} />
                </td>
                {c.months.map((m) => (
                  <td key={`e-${m.month}`} className={`${td} font-semibold`}>
                    {formatManYenInt(m.end)}
                    {c.missingOutflows?.length ? <span className="text-[var(--status-serious)]">※</span> : null}
                  </td>
                ))}
                {c.months.map((m) => (
                  <td key={`l-${m.month}`} className={td}>
                    {`${formatManYenInt(m.minEndOfDay.amount)}（${formatMonthDay(m.minEndOfDay.date)}）`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {`起点 ${formatManYenInt(record.cash.startBalance)}（${record.baseDate}）。ケースの違いは条件を置き換えた比較で、予測の幅（上限・下限）ではありません。定期預金・現金は含みません。`}
      </p>

      <DetailsBox summary="根拠・推計・限界">
        <SubHeading>根拠</SubHeading>
        <NoteList items={record.notes.basis} />
        <SubHeading>推計・仮定</SubHeading>
        <NoteList items={record.notes.estimates} />
        <SubHeading>限界</SubHeading>
        <NoteList items={record.notes.limits} />
      </DetailsBox>

      <DetailsBox summary="確認した数値（自社振替・一括振込・給与明細・年末・同日内の最低）">
        <NoteList
          items={[
            `自社振替（基準日の月の1日〜基準日の出金）：振替記録で確認 ${chk.ownTransfers.confirmed ?? 0}件／保留 ${chk.ownTransfers.pending ?? 0}件`,
            ...chk.bulkReference.map(
              (r) =>
                `${formatMonthDay(r.date)}の月末一括振込 ${formatManYenInt(r.bulk)}：同日の外注・一般経費の支払 ${formatManYenInt(r.bulkClassesTotal)}`
            ),
            chk.excludedFromBulk.length === 0
              ? "一括振込の推計で、分類が違うため差し引かなかった登録済み支払：なし"
              : `一括振込の推計で、分類が違うため差し引かなかった登録済み支払：${chk.excludedFromBulk
                  .map((x) => `${x.case} ${x.month} ${x.class} ${formatManYenInt(x.amount)}`)
                  .join("、")}`,
            pay
              ? `${months[1] ? monthLabel(months[1]) : "翌月"}の給与明細：${pay.count}件（確定 ${pay.fixed}件、勤怠0日 ${pay.workedZero}件、${pay.calculatedAt}計算）、振込額 ${formatManYenInt(pay.transfer)}、経費精算 ${formatManYenInt(pay.expense)}`
              : `${months[1] ? monthLabel(months[1]) : "翌月"}の給与明細：未作成`,
            `12/31予定の入金：Salesforce追加 ${formatManYenInt(record.cash.dec31Receipts.sfAdded)}（標準で採用する種類 ${formatManYenInt(record.cash.dec31Receipts.sfAddedStandardKinds)}）／freee未決済 ${formatManYenInt(record.cash.dec31Receipts.freeeUnsettled)}`,
            ...otherCases.map(
              (c) =>
                `${c.label}${missingMark(c)}：${c.months.map((m) => `${monthLabel(m.month)}末 ${formatManYenInt(m.end)}・日末最低 ${formatManYenInt(m.minEndOfDay.amount)}（${formatMonthDay(m.minEndOfDay.date)}）`).join("／")}`
            ),
            ...mainCases.map(
              (c) => `${c.label}：同じ日に出金が入金より先に起きた場合の最低 ${c.months.map((m) => `${monthLabel(m.month)} ${formatManYenInt(m.minIntraday)}`).join("／")}`
            ),
          ]}
        />
      </DetailsBox>

      <DetailsBox summary="入金照合（Salesforce案件とfreee売上取引）">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-hairline)]">
                <th className={thLeft}>判定</th>
                <th className={th}>件数</th>
                <th className={th}>税込</th>
              </tr>
            </thead>
            <tbody>
              {record.matching.byClass.map((x) => (
                <tr key={x.label} className="border-t border-[var(--gridline)]">
                  <td className={tdLeft}>{x.label}</td>
                  <td className={td}>{x.count}</td>
                  <td className={td}>{formatManYenInt(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SubHeading>曖昧なもの（理由別、1件が複数の理由に入ることがあります）</SubHeading>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-hairline)]">
                <th className={thLeft}>判定</th>
                <th className={thLeft}>理由</th>
                <th className={th}>件数</th>
                <th className={th}>税込</th>
              </tr>
            </thead>
            <tbody>
              {record.matching.ambiguous.map((x) => (
                <tr key={`${x.class}-${x.reason}`} className="border-t border-[var(--gridline)]">
                  <td className={tdLeft}>{x.class}</td>
                  <td className={tdLeft}>{x.reason}</td>
                  <td className={td}>{x.count}</td>
                  <td className={td}>{formatManYenInt(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          {`「freee採用」の曖昧なものは、freeeの未決済額をそのまま使うため予測額には影響しません。「判定保留（曖昧）」は予測に加えていません。freeeの未決済でSalesforceと照合されなかったもの ${record.matching.freeeUnmatchedUnsettled.count}件・${formatManYenInt(record.matching.freeeUnmatchedUnsettled.amount)} はfreeeの値を使っています。`}
        </p>
      </DetailsBox>

      <DetailsBox summary="ケース・月ごとの内訳（根拠別・分類別）">
        {record.cash.cases.map((c) => (
          <CaseBreakdown key={c.id} c={c} />
        ))}
      </DetailsBox>
    </section>
  );
}

/** 業績・採算タブ: 損益の仮定別の参考試算(A〜C)。予測の上限・下限ではない */
export function ReferencePlSection({ record }: { record: ReferenceForecastRecord }) {
  const scenarios = record.pl.scenarios;
  const months = scenarios[0]?.months.map((m) => m.month) ?? [];
  const plLimits = record.notes.limits.filter((t) => t.includes("損益") || t.includes("PDF"));
  return (
    <section className="flex flex-col gap-3" aria-labelledby="reference-pl">
      <SectionBanner right={<Badge />}>
        <span id="reference-pl">損益の参考試算（仮定別、9〜12月の経常利益）</span>
      </SectionBanner>
      <RecordCaption record={record} />
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              <th className={thLeft}>仮定</th>
              {months.map((m) => (
                <th key={m} className={th}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className={th}>累計</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id} className="border-b border-[var(--gridline)]">
                <td className={`${tdLeft} font-medium text-[var(--text-primary)]`}>{`${s.id}：${s.label}`}</td>
                {s.months.map((m) => (
                  <td key={m.month} className={td}>
                    {formatManYenInt(m.ordinaryProfit)}
                  </td>
                ))}
                <td className={`${td} font-semibold`}>{formatManYenInt(s.cumulative.ordinaryProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        仮定を変えた参考試算です。予測の上限・下限ではありません。9月は実績、10月は帳簿の実績に未計上の月末処理の仮定を加えたものです。
      </p>
      <DetailsBox summary="根拠・推計・限界（損益）">
        <SubHeading>限界</SubHeading>
        <NoteList items={plLimits} />
        <SubHeading>月ごとの根拠</SubHeading>
        {scenarios.map((s) => (
          <div key={s.id} className="flex flex-col gap-1">
            <p className="text-[var(--text-primary)]">{`${s.id}：${s.label}（9〜12月の売上高 ${formatManYenInt(s.cumulative.revenue)}）`}</p>
            <ul className="list-disc space-y-1 pl-5 leading-relaxed">
              {s.months.map((m) => (
                <li key={m.month}>
                  {`${monthLabel(m.month)}：売上高 ${formatManYenInt(m.revenue)}・粗利 ${formatManYenInt(m.grossProfit)}${
                    m.wipChange !== null ? `・仕掛品増減 ${formatManYenDelta(m.wipChange)}` : ""
                  }。${m.basis}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </DetailsBox>
    </section>
  );
}
