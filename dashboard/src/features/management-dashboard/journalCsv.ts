/**
 * freee `/api/1/journals`(download_type=csv)の仕訳帳CSVを、伝票単位(JournalGroup)へ読み替える。
 *
 * このCSVの形式は実データで確認済み(2026-09-19、49期10,295行/5,963伝票):
 * - ヘッダー行なし、Shift_JIS、25列固定。列番号:
 *   0=伝票種別(2000=単一行 / 2110=複合仕訳の先頭 / 2100=複合仕訳の中間 / 2101=複合仕訳の末尾)
 *   3=発生日(yyyy/mm/dd)
 *   4=借方勘定科目(決算書表示名) 5=借方補助科目(現金・預金では口座名) 8=借方金額
 *   10=貸方勘定科目 11=貸方補助科目 14=貸方金額
 *   16=摘要(取引先・品目・部門・備考・銀行摘要を連結したもの)
 * - 複合仕訳は 2110 で始まり 2101 で終わる。この単位でまとめないと、片側が空欄の行を誤読する。
 * - 一方の側が空欄の行(借方のみ/貸方のみ)がある。空欄側は金額0・科目空文字。
 */

export interface JournalLine {
  /** 決算書表示名の勘定科目(例: 売掛金・現金及び預金)。空欄側は含めない */
  account: string;
  /** 補助科目。現金及び預金では口座(walletable)名 */
  subAccount: string;
  amount: number;
  /** 摘要(行単位)。銀行明細由来の伝票では末尾に銀行摘要が付く */
  memo: string;
}

export interface JournalGroup {
  /** yyyy-mm-dd(伝票の先頭行の発生日) */
  date: string;
  debits: JournalLine[];
  credits: JournalLine[];
}

const COL = {
  code: 0,
  date: 3,
  debitAccount: 4,
  debitSub: 5,
  debitAmount: 8,
  creditAccount: 10,
  creditSub: 11,
  creditAmount: 14,
  memo: 16,
} as const;
const COLUMN_COUNT = 25;

/** RFC4180準拠の最小CSVパーサ(ダブルクォート・引用符内の改行/カンマ・"" エスケープ対応) */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toDate(slashDate: string): string {
  return slashDate.replaceAll("/", "-");
}

function toAmount(raw: string): number {
  const n = Number(raw === "" ? "0" : raw);
  if (!Number.isFinite(n)) throw new Error("journal_csv_invalid_amount");
  return n;
}

/**
 * CSV全文を伝票単位へ読み替える。列数・伝票種別の並びが想定と違う場合はfail-closedで例外にする
 * (freee側のCSV形式変更に気付かず誤った入金分類をしないため)。
 */
export function parseJournalCsv(text: string): JournalGroup[] {
  const groups: JournalGroup[] = [];
  let compound: JournalGroup | null = null;

  const toGroupFrom = (row: string[]): JournalGroup => {
    const group: JournalGroup = { date: toDate(row[COL.date]), debits: [], credits: [] };
    addRow(group, row);
    return group;
  };
  const addRow = (group: JournalGroup, row: string[]) => {
    const memo = row[COL.memo] ?? "";
    if (row[COL.debitAccount] !== "") {
      group.debits.push({
        account: row[COL.debitAccount],
        subAccount: row[COL.debitSub],
        amount: toAmount(row[COL.debitAmount]),
        memo,
      });
    }
    if (row[COL.creditAccount] !== "") {
      group.credits.push({
        account: row[COL.creditAccount],
        subAccount: row[COL.creditSub],
        amount: toAmount(row[COL.creditAmount]),
        memo,
      });
    }
  };

  for (const row of parseCsvRows(text)) {
    if (row.length !== COLUMN_COUNT) throw new Error("journal_csv_unexpected_columns");
    const code = row[COL.code];
    if (code === "2000") {
      if (compound !== null) throw new Error("journal_csv_unexpected_sequence");
      groups.push(toGroupFrom(row));
    } else if (code === "2110") {
      if (compound !== null) throw new Error("journal_csv_unexpected_sequence");
      compound = toGroupFrom(row);
    } else if (code === "2100" || code === "2101") {
      if (compound === null) throw new Error("journal_csv_unexpected_sequence");
      addRow(compound, row);
      if (code === "2101") {
        groups.push(compound);
        compound = null;
      }
    } else {
      throw new Error("journal_csv_unknown_record_code");
    }
  }
  if (compound !== null) throw new Error("journal_csv_unexpected_sequence");
  return groups;
}
