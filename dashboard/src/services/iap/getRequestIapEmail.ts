import { headers } from "next/headers";
import { verifyIapJwt } from "./verifyIapJwt";

/**
 * Server Component用: 現在のリクエストのIAP検証済みメールアドレスを取得する。
 * 検証に失敗した場合はnullを返す(呼び出し側でfail-closedに扱うこと)。
 */
export async function getRequestIapEmail(): Promise<string | null> {
  const result = await verifyIapJwt(await headers());
  return result.ok ? result.email : null;
}
