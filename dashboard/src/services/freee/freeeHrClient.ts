/**
 * freee人事労務APIへの薄いクライアント(会計API=freeeAccountingClient.tsとはベースURLが
 * 異なる別プロダクト、`https://api.freee.co.jp/hr`)。
 *
 * 既存の会計用トークン(freeeAuthRepository.getValidFreeeAccessToken)で人事労務APIにも
 * 疎通できることを実地確認済み(company_idも会計と同じ値を共用、2026-09-18、
 * `freee-finance-cli`のoverwriteコマンドで検証)。そのため認可・トークン管理は一切
 * 増やさず、既存のfreee連携をそのまま流用する。
 */

import { getValidFreeeAccessToken } from "@/repositories/freeeAuthRepository";

const HR_BASE_URL = "https://api.freee.co.jp/hr";

export interface FreeeHrEmployee {
  id: number;
  display_name: string;
  retire_date: string | null;
}

/** 勤怠情報月次サマリ(work_record_summaries)。公式スキーマ(freee/freee-api-schema)で
 * 確認済みのフィールドのうち、今回使う3つのみ抜粋する */
export interface FreeeWorkRecordSummary {
  /** 労働日数 */
  work_days: number;
  /** 総勤務時間(分) */
  total_work_mins: number;
  /** 所定内労働時間(分) */
  total_normal_work_mins: number;
}

async function freeeHrGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const token = await getValidFreeeAccessToken();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const res = await fetch(`${HR_BASE_URL}${path}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // レスポンス本文に従業員の実データが含まれ得るため、ステータスのみログに出す
    console.error(`[freeeHrClient] ${path} がエラーを返しました(status=${res.status})`);
    throw new Error("freee_hr_api_error");
  }
  return (await res.json()) as T;
}

const EMPLOYEES_PAGE_SIZE = 100;

/** 事業所の全従業員一覧(ページングを内部で解決して1本の配列として返す) */
export async function getHrEmployees(companyId: number): Promise<FreeeHrEmployee[]> {
  const employees: FreeeHrEmployee[] = [];
  let offset = 0;
  for (;;) {
    const batch = await freeeHrGet<FreeeHrEmployee[]>(`/api/v1/companies/${companyId}/employees`, {
      company_id: companyId,
      limit: EMPLOYEES_PAGE_SIZE,
      offset,
    });
    employees.push(...batch);
    if (batch.length < EMPLOYEES_PAGE_SIZE) break;
    offset += EMPLOYEES_PAGE_SIZE;
  }
  return employees;
}

/**
 * 指定した従業員・年月の勤怠情報サマリ。該当データが無い場合(在籍期間外等)は
 * freee側が400/404を返すことがあるため、呼び出し側でtry/catchしてnull扱いする想定
 * (このクライアント自体はthrowするのみで、欠測を推測で埋めない)。
 */
export async function getWorkRecordSummary(
  employeeId: number,
  companyId: number,
  year: number,
  month: number
): Promise<FreeeWorkRecordSummary> {
  return freeeHrGet<FreeeWorkRecordSummary>(`/api/v1/employees/${employeeId}/work_record_summaries/${year}/${month}`, {
    company_id: companyId,
  });
}
