/**
 * 経理が管理上決めている準備額・当座貸越枠(freeeからは導出できないTCD独自の設定値)。
 * 経理報告「残高表銀行」の値をそのまま持つ。実額はFirestore(managementReserveSettings)にのみ置き、
 * コードには書かない(ユーザー確定、2026-10-05)。
 *
 * 1ドキュメント=1時点の設定。上書きせず基準日(asOf)ごとに追加していく。月額×経過月での自動
 * 積み上げはしない(納付・支給時の取崩が経理判断のため)。
 */
export interface OverdraftLimit {
  /** 金融機関名(表示用) */
  lender: string;
  limit: number;
}

export interface ManagementReserveSettings {
  /** 経理報告の基準日(YYYY-MM-DD) */
  asOf: string;
  /** 消費税準備。未入力はnull(0円と推測しない) */
  consumptionTaxReserve: number | null;
  /** 賞与準備。専用口座は無く、会計上の「賞与引当金」科目とも別の管理上の金額 */
  bonusReserve: number | null;
  /** 当座貸越枠(経理報告の「当座貸越担保分（枠）」)。未入力は空配列 */
  overdraftLimits: OverdraftLimit[];
  /** 出所(例: 経理報告の名称) */
  source: string | null;
}

const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Firestoreの生ドキュメントを検証して設定に変換する。基準日が読めないものはnull(その設定は
 * 使わない)。金額は数値でなければ未入力(null)として扱い、他の項目は生かす。
 */
export function parseReserveSettings(data: unknown): ManagementReserveSettings | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.asOf !== "string" || !AS_OF_PATTERN.test(raw.asOf)) return null;

  const overdraftLimits: OverdraftLimit[] = [];
  if (Array.isArray(raw.overdraftLimits)) {
    for (const entry of raw.overdraftLimits) {
      if (typeof entry !== "object" || entry === null) continue;
      const { lender, limit } = entry as Record<string, unknown>;
      const amount = toAmount(limit);
      if (typeof lender === "string" && amount !== null) overdraftLimits.push({ lender, limit: amount });
    }
  }

  return {
    asOf: raw.asOf,
    consumptionTaxReserve: toAmount(raw.consumptionTaxReserve),
    bonusReserve: toAmount(raw.bonusReserve),
    overdraftLimits,
    source: typeof raw.source === "string" ? raw.source : null,
  };
}

/** freeeのfiscal_year(期首の西暦年、9月始まり)と暦月から、その月の末日(YYYY-MM-DD)を返す */
function monthEndDate(fiscalYear: number, month: number): string {
  const year = month >= 9 ? fiscalYear : fiscalYear + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * 表示月に適用する設定 = 基準日がその月末以前のもののうち最も新しいもの。
 * 該当が無ければnull(「未設定」表示。後の時点の設定を過去月へ遡って当てはめない)。
 */
export function selectReserveSettings(
  all: readonly ManagementReserveSettings[],
  fiscalYear: number,
  month: number
): ManagementReserveSettings | null {
  const monthEnd = monthEndDate(fiscalYear, month);
  let selected: ManagementReserveSettings | null = null;
  for (const settings of all) {
    if (settings.asOf > monthEnd) continue;
    if (selected === null || settings.asOf > selected.asOf) selected = settings;
  }
  return selected;
}

/** 当座貸越枠の合計。1件も入力が無ければnull(0円の枠と区別する) */
export function overdraftLimitTotal(settings: ManagementReserveSettings | null): number | null {
  if (settings === null || settings.overdraftLimits.length === 0) return null;
  return settings.overdraftLimits.reduce((sum, l) => sum + l.limit, 0);
}
