import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { isReferenceForecastEnabled } from "@/features/management-dashboard/referenceForecast";
import { buildReferenceForecastRecord } from "@/features/management-dashboard/referenceForecastEngine/buildRecord";
import { collectReferenceForecastInputs } from "@/features/management-dashboard/referenceForecastEngine/collectInputs";
import { addReferenceForecast, getLatestReferenceForecast } from "@/repositories/referenceForecastRepository";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";

export const dynamic = "force-dynamic";

/** 直前の記録からこの時間内は再計算しない(二重押し・同時実行の防止) */
const MIN_INTERVAL_MS = 2 * 60 * 1000;

/**
 * 資金・損益の参考予測の再計算(DEVのみ、2026-11-18)。経営タブの閲覧許可リストの人だけが使える。
 * freee・Salesforceの最新データで資金予測・入金照合・準備額・支払見込額を計算し、新しい記録として追加する
 * (既存の記録は上書きしない。月末後に予測と実績を照合できるよう過去の記録は残す)。本番のデータベースでは動かない。
 */
export async function POST(request: NextRequest) {
  if (!isReferenceForecastEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const verification = await verifyIapJwt(request.headers);
  if (!verification.ok || !isManagementDashboardAuthorized(verification.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const previous = await getLatestReferenceForecast();
    if (previous && Date.now() - new Date(previous.createdAt).getTime() < MIN_INTERVAL_MS) {
      return NextResponse.json({ error: "too_soon", message: "直前に計算した記録があります。2分ほどおいてから再計算してください" }, { status: 409 });
    }
    const inputs = await collectReferenceForecastInputs();
    const { record, warnings } = buildReferenceForecastRecord(inputs, {
      createdBy: `DEVの再計算(${verification.email})`,
      codeCommit: process.env.K_REVISION ?? "local",
      previous,
    });
    await addReferenceForecast(record);
    return NextResponse.json({ id: record.id, baseDate: record.baseDate, warnings });
  } catch (e) {
    // freee・Salesforceの応答本文は実データを含み得るため、種類と短い説明だけを返す
    const name = e instanceof Error ? e.name : "Error";
    const message = e instanceof Error ? e.message.slice(0, 200) : "unknown";
    console.error(`[reference-forecast recompute] ${name}: ${message}`);
    return NextResponse.json({ error: "failed", message: `${name}: ${message}` }, { status: 500 });
  }
}
