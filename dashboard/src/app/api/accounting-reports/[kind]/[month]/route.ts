import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { isTargetMonth, parseReportValues } from "@/features/management-dashboard/accountingReports";
import type { AccountingReportKind, ChangeType } from "@/features/management-dashboard/accountingReports";
import { ChangeTypeRequiredError, saveAccountingReport } from "@/repositories/accountingReportRepository";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";

const KINDS: readonly AccountingReportKind[] = ["monthly-report", "cash-plan"];
const OVERWRITE_TYPES: readonly ChangeType[] = ["correction", "forecastUpdate"];

/**
 * 経理月次報告・資金繰り予定の登録・訂正API(ユーザー確定、2026-10-15)。
 * 経営タブの閲覧許可リスト(managementDashboardAccess)の人だけが使える。IAPのJWTをサーバー側で
 * 検証し、検証済みのemailで許可リストを照合して更新者に記録する(クライアントのemailは使わない)。
 * 本文: { values: {...}, changeType?: "correction" | "forecastUpdate" }。既存の値がある月への保存は
 * changeTypeが必須(無ければ409)。
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ kind: string; month: string }> }) {
  const { kind, month } = await params;
  if (!(KINDS as readonly string[]).includes(kind) || !isTargetMonth(month)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const verification = await verifyIapJwt(request.headers);
  if (!verification.ok || !isManagementDashboardAuthorized(verification.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { values: rawValues, changeType } = body as Record<string, unknown>;
  const reportKind = kind as AccountingReportKind;
  const values = parseReportValues(reportKind, rawValues);
  if (!values || (changeType !== undefined && !(OVERWRITE_TYPES as readonly unknown[]).includes(changeType))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const saved = await saveAccountingReport({
      kind: reportKind,
      targetMonth: month,
      values,
      changeType: changeType as ChangeType | undefined,
      updatedBy: verification.email,
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ChangeTypeRequiredError) {
      return NextResponse.json({ error: "change_type_required" }, { status: 409 });
    }
    console.error("[accounting-reports PUT] Firestoreへの保存に失敗しました");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
