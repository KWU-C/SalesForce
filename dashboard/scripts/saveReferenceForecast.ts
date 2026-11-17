/**
 * 参考予測の記録(scripts/reference-forecast/build_record.py の出力)を dev の Firestore に1件追加する。
 * 既存の記録は上書きしない(同じIDがあれば失敗する)。dashboard-dev 以外には書かない。
 *
 * 使い方:
 *   FIRESTORE_DATABASE_ID=dashboard-dev ALLOW_PRODUCTION_DATA_WRITES=true npx tsx scripts/saveReferenceForecast.ts <記録.json> [--via-gcloud-user]
 *
 * --via-gcloud-user: ローカルのADCがdashboard-devの権限を持たないサービスアカウントの借用になっている場合に、
 * gcloud のユーザー認証(gcloud auth print-access-token)で Firestore REST の作成(documentId指定=既存なら409)を使う。
 * 保存前の検査(接続先・書き込み許可・記録の形)は同じ addReferenceForecast を通す。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { addReferenceForecast, REFERENCE_FORECASTS, type ReferenceForecastStore } from "@/repositories/referenceForecastRepository";
import { resolveFirestoreDatabaseId } from "@/services/firestore/databaseId";
import type { ReferenceForecastRecord } from "@/features/management-dashboard/referenceForecast";

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

function toValue(v: unknown): FirestoreValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toValue(x)])) } };
}

function gcloudUserRestStore(): ReferenceForecastStore {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? "tcd-dashboard";
  const database = resolveFirestoreDatabaseId();
  return {
    async create(id, doc) {
      const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
      const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/${REFERENCE_FORECASTS}?documentId=${encodeURIComponent(id)}`;
      const fields = (toValue(JSON.parse(JSON.stringify(doc))) as { mapValue: { fields: Record<string, FirestoreValue> } }).mapValue.fields;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error(`Firestore REST の作成に失敗しました(${res.status})`);
    },
    async getLatest() {
      throw new Error("このスクリプトでは読みません");
    },
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("記録のJSONファイルを指定してください");
  const doc = JSON.parse(readFileSync(path, "utf8")) as ReferenceForecastRecord;
  const viaUser = process.argv.includes("--via-gcloud-user");
  await addReferenceForecast(doc, viaUser ? gcloudUserRestStore() : undefined);
  console.log(`保存しました: ${REFERENCE_FORECASTS}/${doc.id}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
