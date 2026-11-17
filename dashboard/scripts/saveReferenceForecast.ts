/**
 * 参考予測の記録(scripts/reference-forecast/build_record.py の出力)を dev の Firestore に1件追加する。
 * 既存の記録は上書きしない(同じIDがあれば失敗する)。dashboard-dev 以外には書かない。
 *
 * 使い方:
 *   FIRESTORE_DATABASE_ID=dashboard-dev ALLOW_PRODUCTION_DATA_WRITES=true npx tsx scripts/saveReferenceForecast.ts <記録.json>
 */
import { readFileSync } from "node:fs";
import { addReferenceForecast } from "@/repositories/referenceForecastRepository";
import type { ReferenceForecastRecord } from "@/features/management-dashboard/referenceForecast";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("記録のJSONファイルを指定してください");
  const doc = JSON.parse(readFileSync(path, "utf8")) as ReferenceForecastRecord;
  await addReferenceForecast(doc);
  console.log(`保存しました: referenceForecasts/${doc.id}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
