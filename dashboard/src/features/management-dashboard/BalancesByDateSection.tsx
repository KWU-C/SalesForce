import { formatDateTime } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { CashAccountLine } from "./fundReserve";
import type { LoanStatus } from "./loanStatus";

/**
 * 財務・資金繰りタブ「残高・借入（対象日別）」(2026-11-18、ユーザー指定)。
 * 旧: 資金収支・借入(当月末の帳簿)/現預金と借入(前月末実績)/借入状況(「現在残高」)/資金の備え の4つに分かれ、
 * 同じ残高・借入・差額が時点の表示なしに重複していた。対象日ごとの列にまとめ、「現在残高」という表記をやめる。
 * - 前月末(実績): 月末後にfreeeから取得した試算表の値。概要の資金サマリーの実績の行と同じ値
 * - 当月末の帳簿残高(登録済み分): 当月末日付の試算表で、取得時点までに登録された取引(先日付の登録済み取引を含む)。
 *   月末の予測ではない(予測は資金の参考予測)
 * 金額は円・3桁区切り、マイナスは▲。未取得は「未取得」と書き、0円と区別する。
 */

export interface BalanceDateColumn {
  title: string;
  /** 対象日の説明(例: 2026年10月31日、2026年11月30日付の帳簿・取得時点までの登録分) */
  asOf: string;
  fetchedAt: Date | null;
  cash: { checkingSavings: number; timeDeposit: number; cashOnHand: number; total: number } | null;
  accounts: CashAccountLine[] | null;
  loans: { shortTerm: number; longTerm: number; officer: number; total: number } | null;
  insurance: number | null;
}

export function loansOf(status: LoanStatus | null): BalanceDateColumn["loans"] {
  if (!status) return null;
  const bal = (key: string) => status.lines.find((l) => l.key === key)?.currentBalance ?? 0;
  return { shortTerm: bal("shortTerm"), longTerm: bal("longTerm"), officer: bal("officer"), total: status.totalCurrent };
}

const yen = (v: number) => (v < 0 ? `▲${Math.abs(Math.round(v)).toLocaleString("ja-JP")}` : Math.round(v).toLocaleString("ja-JP"));

const th = "px-3 py-2 text-right align-bottom font-medium whitespace-nowrap text-[var(--text-muted)]";
const tdLabel = "px-3 py-1.5 text-left whitespace-nowrap text-[var(--text-secondary)]";
const td = "px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-[var(--text-primary)]";

function Cell({ v, strong = false }: { v: number | null | undefined; strong?: boolean }) {
  return (
    <td className={`${td} ${strong ? "font-semibold" : ""}`}>
      {v === null || v === undefined ? <span className="text-[var(--text-muted)]">未取得</span> : yen(v)}
    </td>
  );
}

function Row({ label, values, strong = false, indent = false }: { label: string; values: (number | null | undefined)[]; strong?: boolean; indent?: boolean }) {
  return (
    <tr className="border-t border-[var(--gridline)]">
      <th scope="row" className={`${tdLabel} font-normal ${indent ? "pl-6" : ""} ${strong ? "font-medium text-[var(--text-primary)]" : ""}`}>
        {label}
      </th>
      {values.map((v, i) => (
        <Cell key={i} v={v} strong={strong} />
      ))}
    </tr>
  );
}

export function BalancesByDateSection({ columns, loanStatus }: { columns: BalanceDateColumn[]; loanStatus: LoanStatus | null }) {
  const pick = <T,>(f: (c: BalanceDateColumn) => T) => columns.map(f);
  const timeDepositAccounts = [...new Set(columns.flatMap((c) => (c.accounts ?? []).filter((a) => a.kind === "timeDeposit").map((a) => a.label)))];
  const otherAccounts = [...new Set(columns.flatMap((c) => (c.accounts ?? []).filter((a) => a.kind === null).map((a) => a.label)))];
  const accountBalance = (c: BalanceDateColumn, label: string) => (c.accounts ? (c.accounts.find((a) => a.label === label)?.balance ?? 0) : null);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="balances-by-date">
      <SectionBanner>
        <span id="balances-by-date">残高・借入（対象日別）</span>
      </SectionBanner>
      <ul className="flex flex-col gap-0.5 text-sm text-[var(--text-secondary)]">
        {columns.map((c) => (
          <li key={c.title}>{`${c.title}：${c.asOf}／データ取得日時（freee） ${c.fetchedAt ? formatDateTime(c.fetchedAt) : "未取得"}`}</li>
        ))}
      </ul>
      <p className="text-sm text-[var(--text-secondary)]">単位：円。▲はマイナス。</p>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th className={`${th} text-left`}>
                <span className="sr-only">項目</span>
              </th>
              {columns.map((c) => (
                <th key={c.title} className={th}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="当座・普通預金" values={pick((c) => c.cash?.checkingSavings)} />
            <Row label="定期預金（合計）" values={pick((c) => c.cash?.timeDeposit)} />
            {timeDepositAccounts.map((label) => (
              <Row key={label} label={label} values={pick((c) => accountBalance(c, label))} indent />
            ))}
            <Row label="預金合計（控除前）" values={pick((c) => (c.cash ? c.cash.checkingSavings + c.cash.timeDeposit : null))} strong />
            <Row label="現金" values={pick((c) => c.cash?.cashOnHand)} />
            {otherAccounts.map((label) => (
              <Row key={label} label={`${label}（種別を判定できない科目）`} values={pick((c) => accountBalance(c, label))} indent />
            ))}
            <Row label="現預金合計" values={pick((c) => c.cash?.total)} strong />
            <Row label="短期借入金" values={pick((c) => c.loans?.shortTerm)} />
            <Row label="長期借入金" values={pick((c) => c.loans?.longTerm)} />
            <Row label="役員借入金" values={pick((c) => c.loans?.officer)} />
            <Row label="借入合計" values={pick((c) => c.loans?.total)} strong />
            <Row label="現預金合計 − 借入合計" values={pick((c) => (c.cash && c.loans ? c.cash.total - c.loans.total : null))} strong />
            <Row label="保険積立金（参考、現預金に含めない）" values={pick((c) => c.insurance)} />
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-0.5 text-sm text-[var(--text-secondary)]">
        <p>※ 預金合計（控除前）＝当座・普通預金＋定期預金。概要の「預金総合計（差引）」は、ここから短期借入金を差し引いた額です。</p>
        <p>※ 現預金合計 − 借入合計は使える資金の額ではありません。当月末の帳簿残高は登録済みの取引までの値で、月末の予測ではありません（予測は資金の参考予測）。</p>
      </div>
      {loanStatus && (
        <details className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] text-sm text-[var(--text-secondary)]">
          <summary className="cursor-pointer px-4 py-2">今期の借入・返済（期首 → 当月末の帳簿）</summary>
          <div className="overflow-x-auto px-4 pb-3">
            <p className="py-1">単位：円。▲はマイナス。</p>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>科目</th>
                  <th className={th}>期首残高</th>
                  <th className={th}>新規借入</th>
                  <th className={th}>元本返済</th>
                  <th className={th}>当月末の帳簿残高</th>
                  <th className={th}>増減</th>
                </tr>
              </thead>
              <tbody>
                {loanStatus.lines.map((l) => (
                  <tr key={l.key} className="border-t border-[var(--gridline)]">
                    <th scope="row" className={`${tdLabel} font-normal`}>{l.label}</th>
                    <Cell v={l.openingBalance} />
                    <Cell v={l.newBorrowing} />
                    <Cell v={l.repayment} />
                    <Cell v={l.currentBalance} />
                    <Cell v={l.currentBalance - l.openingBalance} />
                  </tr>
                ))}
                <tr className="border-t border-[var(--gridline)]">
                  <th scope="row" className={`${tdLabel} font-medium text-[var(--text-primary)]`}>合計</th>
                  <Cell v={loanStatus.totalOpening} strong />
                  <Cell v={loanStatus.totalNewBorrowing} strong />
                  <Cell v={loanStatus.totalRepayment} strong />
                  <Cell v={loanStatus.totalCurrent} strong />
                  <Cell v={loanStatus.netChange} strong />
                </tr>
              </tbody>
            </table>
            <p className="pt-2">当座貸越の枠・空き枠は、枠の金額がfreeeに無いため表示していません（短期借入金を当座貸越と断定しない）。</p>
          </div>
        </details>
      )}
    </section>
  );
}
