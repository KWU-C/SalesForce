import { formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { LoanKey, LoanStatus, OverdraftStatus } from "./loanStatus";

interface LoanStatusTableProps {
  loanStatus: LoanStatus;
  overdraft: OverdraftStatus;
}

/** 表示用の短縮ラベル。loanStatus.tsのlabel(短期借入金など)はfreeeの科目名検索に
 * そのまま使う実データなので変更できない(ユーザー確定)。表示だけここで短くする */
const SHORT_LABEL: Record<LoanKey, string> = {
  shortTerm: "短期",
  longTerm: "長期",
  officer: "役員",
};

/**
 * 借入状況(ストック)。月次資金収支(フロー)とは別枠で表示する(ユーザー確定、2026-09-15)。
 * 目的は「借入がいくらあるか」ではなく「今期、借金をどれだけ減らせているか」を把握すること。
 *
 * 「借入残高」(短期/長期/役員/合計の期首・現在残高)と「今期の借入・返済」(新規借入・
 * 元本返済・借入純増減の今期累計)の2ブロックに分ける(ユーザー確定、2026-09-21)。
 *
 * 「元本返済」は事業年度の期首(9月)から選択月までの累計値(trial_bsのdebit_amount)。
 * 月次資金収支の「当月元本返済」は選択月単月のフロー値であり、両者は意味が異なる
 * (期首月を選択している場合のみ一致する、ユーザー確定、2026-09-15)。
 *
 * 「借入残高」「今期の借入・返済」の見出しは、資金の備え(FundReserveSection)の
 * SegmentHeadingと同じ帯色(--surface-sunken)+左右上下3px相当の余白に揃える
 * (ユーザー確定、2026-09-22)。
 *
 * 借入残高の表に最小幅は付けない。以前のmin-w-[360px]は390px幅の画面(カード内側は約324px)で
 * 横スクロールになり「現在残高」列が切れていた。3列とも9桁の金額まで324pxに収まる(2026-10-05)。
 *
 * 「当座貸越」は枠(設定値)・利用額(短期借入金の残高)・空き枠の3行。借入残高そのものと
 * 借入枠を混同しないよう別ブロックにする(ユーザー確定、2026-10-05)。枠が未設定の間は
 * 枠・空き枠を「データ未設定」と表示する。
 */
export function LoanStatusTable({ loanStatus, overdraft }: LoanStatusTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>借入状況</SectionBanner>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <p className="bg-[var(--surface-sunken)] py-[3px] pl-[3px] text-xs font-medium text-[var(--text-muted)]">
          借入残高
        </p>
        <table className="mt-1 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="py-1 font-normal">科目</th>
              <th className="py-1 text-right font-normal">期首残高</th>
              <th className="py-1 text-right font-normal">現在残高</th>
            </tr>
          </thead>
          <tbody>
            {loanStatus.lines.map((line) => (
              <tr key={line.key} className="border-t border-[var(--gridline)]">
                <td className="py-1.5 text-[var(--text-secondary)]">{SHORT_LABEL[line.key]}</td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                  {formatYen(line.openingBalance)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                  {formatYen(line.currentBalance)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--baseline)] font-semibold">
              <td className="py-1.5 text-[var(--text-primary)]">合計</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                {formatYen(loanStatus.totalOpening)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                {formatYen(loanStatus.totalCurrent)}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 bg-[var(--surface-sunken)] py-[3px] pl-[3px] text-xs font-medium text-[var(--text-muted)]">
          今期の借入・返済
        </p>
        <div className="mt-1 flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[var(--text-secondary)]">新規借入</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(loanStatus.totalNewBorrowing)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--gridline)] py-1.5">
            <span className="text-[var(--text-secondary)]">元本返済</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(loanStatus.totalRepayment)}</span>
          </div>
          <div className="flex items-center justify-between border-t-2 border-[var(--baseline)] py-1.5 font-semibold">
            <span className="text-[var(--text-primary)]">借入純増減</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(loanStatus.netChange)}</span>
          </div>
        </div>

        <p className="mt-4 bg-[var(--surface-sunken)] py-[3px] pl-[3px] text-xs font-medium text-[var(--text-muted)]">
          当座貸越
        </p>
        <div className="mt-1 flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[var(--text-secondary)]">枠</span>
            <span className="tabular-nums text-[var(--text-primary)]">
              {overdraft.limitTotal === null ? "データ未設定" : formatYen(overdraft.limitTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--gridline)] py-1.5">
            <span className="text-[var(--text-secondary)]">利用額（短期借入金の残高）</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(overdraft.used)}</span>
          </div>
          <div className="flex items-center justify-between border-t-2 border-[var(--baseline)] py-1.5 font-semibold">
            <span className="text-[var(--text-primary)]">空き枠</span>
            <span className="tabular-nums text-[var(--text-primary)]">
              {overdraft.available === null ? "データ未設定" : formatYen(overdraft.available)}
            </span>
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          短期借入金の全額が当座貸越である前提の数字です。枠は経理の管理値です。
        </p>
      </div>
    </div>
  );
}
