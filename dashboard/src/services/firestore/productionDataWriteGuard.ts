/**
 * 本番データ(本番画面に出るFirestoreのコレクション)への書き込みを、本番の実行環境だけに限る。
 *
 * 【背景、2026-10-21】本番(tcd-dashboard-prod)とdev(tcd-dashboard-dev2)は同じFirestore
 * データベース(dashboard)を共有している。分かれているのはfreeeトークンのドキュメントだけで、
 * devで「更新」や遅延取得が走ると、本番の月次資金収支などのスナップショットがdevのコードの結果で
 * 上書きされる。そこで本番データの書き込み口で実行環境を確かめ、本番以外では書き込まずに止める
 * (ユーザー確定、2026-10-21)。
 *
 * 書き込みは「実行環境」と「接続先データベース」の組み合わせで判定する(ユーザー確定、2026-10-21)。
 * 許可するのは次の組み合わせだけで、それ以外はすべて拒否する:
 * - 本番のサービス(K_SERVICE=tcd-dashboard-prod)・本番の定時更新Job → dashboard
 * - dev2のサービス(K_SERVICE=tcd-dashboard-dev2)・dev2の定時更新Job → dashboard-dev
 * - ローカル(K_SERVICE・CLOUD_RUN_JOBとも無し)で ALLOW_PRODUCTION_DATA_WRITES=true を明示した場合
 *   (従来どおりのローカル試験用の許可)
 * dev2 → dashboard、本番 → dashboard-dev、名前の違うサービス・Jobは拒否する。
 * dev2専用サービスアカウントには、IAMでもdashboardへの権限が無い(二重の防御)。
 *
 * 例外はfreeeトークン(freeeAuth)だけで、各環境は自分のドキュメント(FREEE_TOKEN_DOC_ID=サービス名)
 * にだけ書ける(assertOwnFreeeTokenDocument)。他環境のトークンには書けない(ユーザー確定、2026-10-21)。
 */

import { PRODUCTION_DATABASE_ID, resolveFirestoreDatabaseId } from "./databaseId";

export const PRODUCTION_SERVICE_NAME = "tcd-dashboard-prod";
export const PRODUCTION_JOB_NAME = "tcd-dashboard-prod-finance-refresh";
export const DEV_SERVICE_NAME = "tcd-dashboard-dev2";
export const DEV_JOB_NAME = "tcd-dashboard-dev2-finance-refresh";
export const DEV_DATABASE_ID = "dashboard-dev";

export interface RuntimeEnvironment {
  /** Cloud Runサービス名(K_SERVICE) */
  service: string | undefined;
  /** Cloud Run Job名(CLOUD_RUN_JOB) */
  job: string | undefined;
  /** ローカルでの明示許可(ALLOW_PRODUCTION_DATA_WRITES) */
  localOverride: string | undefined;
  /** 接続先のFirestoreデータベース名(未指定は本番のdashboard) */
  databaseId?: string;
}

function currentEnvironment(): RuntimeEnvironment {
  return {
    service: process.env.K_SERVICE,
    job: process.env.CLOUD_RUN_JOB,
    localOverride: process.env.ALLOW_PRODUCTION_DATA_WRITES,
    databaseId: resolveFirestoreDatabaseId(),
  };
}

/**
 * 書き込みを許可する「実行環境 → 接続先データベース」の組み合わせ。
 * キーは `service:サービス名` または `job:Job名`。ここに無い実行環境・データベースは拒否する。
 */
export const ALLOWED_WRITE_TARGETS: Readonly<Record<string, string>> = {
  [`service:${PRODUCTION_SERVICE_NAME}`]: PRODUCTION_DATABASE_ID,
  [`job:${PRODUCTION_JOB_NAME}`]: PRODUCTION_DATABASE_ID,
  [`service:${DEV_SERVICE_NAME}`]: DEV_DATABASE_ID,
  [`job:${DEV_JOB_NAME}`]: DEV_DATABASE_ID,
};

/** 実行環境と接続先データベースの組み合わせが、書き込みを許可されたものか */
export function canWriteProductionData(env: RuntimeEnvironment = currentEnvironment()): boolean {
  const databaseId = env.databaseId ?? PRODUCTION_DATABASE_ID;
  if (env.service !== undefined) return ALLOWED_WRITE_TARGETS[`service:${env.service}`] === databaseId;
  if (env.job !== undefined) return ALLOWED_WRITE_TARGETS[`job:${env.job}`] === databaseId;
  return env.localOverride === "true";
}

export class ProductionDataWriteBlockedError extends Error {
  constructor(collection: string) {
    // 環境名・コレクション名だけを出す(データの中身は含めない)
    super(`本番のデータベース(${collection})への書き込みは本番環境でのみ行えます`);
    this.name = "ProductionDataWriteBlockedError";
  }
}

/** 本番データの書き込み直前に呼ぶ。本番以外の環境ではFirestoreに触れる前に止める */
export function assertProductionDataWritable(collection: string, env: RuntimeEnvironment = currentEnvironment()): void {
  if (!canWriteProductionData(env)) throw new ProductionDataWriteBlockedError(collection);
}

/** 定時更新Jobの名前は「サービス名-finance-refresh」(cloudbuild.yamlのjobs deploy) */
const JOB_SUFFIX = "-finance-refresh";

/**
 * freeeトークンのドキュメントに書けるか。実行環境自身のドキュメントだけ許可する
 * (サービスはK_SERVICE、JobはCLOUD_RUN_JOBから「-finance-refresh」を除いた名前と一致すること)。
 * 接続先データベースとの組み合わせも、他の書き込みと同じ条件で確かめる。
 * ローカルは ALLOW_PRODUCTION_DATA_WRITES=true のときだけ。
 */
export function canWriteFreeeTokenDocument(docId: string, env: RuntimeEnvironment = currentEnvironment()): boolean {
  if (env.service !== undefined) return env.service === docId && canWriteProductionData(env);
  if (env.job !== undefined) return env.job.endsWith(JOB_SUFFIX) && env.job.slice(0, -JOB_SUFFIX.length) === docId && canWriteProductionData(env);
  return env.localOverride === "true";
}

export function assertOwnFreeeTokenDocument(docId: string, env: RuntimeEnvironment = currentEnvironment()): void {
  if (!canWriteFreeeTokenDocument(docId, env)) throw new ProductionDataWriteBlockedError(`freeeAuth/${docId}`);
}

export interface RuntimeEnvironmentDescription {
  kind: "service" | "job" | "local";
  /** サービス名またはJob名(ローカルはnull)。機密情報ではないのでログに出してよい */
  name: string | null;
  /** 接続先のFirestoreデータベース名 */
  databaseId: string;
  /** 接続先のデータベースへ書き込めるか */
  writable: boolean;
}

/** 実行環境の種類・名前・接続先データベースと、書き込み可否(ジョブ開始時のログ用) */
export function describeRuntimeEnvironment(env: RuntimeEnvironment = currentEnvironment()): RuntimeEnvironmentDescription {
  const writable = canWriteProductionData(env);
  const databaseId = env.databaseId ?? PRODUCTION_DATABASE_ID;
  if (env.service !== undefined) return { kind: "service", name: env.service, databaseId, writable };
  if (env.job !== undefined) return { kind: "job", name: env.job, databaseId, writable };
  return { kind: "local", name: null, databaseId, writable };
}
