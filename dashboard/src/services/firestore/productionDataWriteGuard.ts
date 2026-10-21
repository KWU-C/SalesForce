/**
 * 本番データ(本番画面に出るFirestoreのコレクション)への書き込みを、本番の実行環境だけに限る。
 *
 * 【背景、2026-10-21】本番(tcd-dashboard-prod)とdev(tcd-dashboard-dev2)は同じFirestore
 * データベース(dashboard)を共有している。分かれているのはfreeeトークンのドキュメントだけで、
 * devで「更新」や遅延取得が走ると、本番の月次資金収支などのスナップショットがdevのコードの結果で
 * 上書きされる。そこで本番データの書き込み口で実行環境を確かめ、本番以外では書き込まずに止める
 * (ユーザー確定、2026-10-21)。
 *
 * 書き込める環境:
 * - 本番のCloud Runサービス(K_SERVICE=tcd-dashboard-prod)
 * - 本番の定時更新Job(CLOUD_RUN_JOB=tcd-dashboard-prod-finance-refresh)
 * - ローカル(K_SERVICE・CLOUD_RUN_JOBとも無し)で、ALLOW_PRODUCTION_DATA_WRITES=trueを明示した場合だけ
 *
 * 例外はfreeeトークン(freeeAuth)だけで、各環境は自分のドキュメント(FREEE_TOKEN_DOC_ID=サービス名)
 * にだけ書ける(assertOwnFreeeTokenDocument)。他環境のトークンには書けない(ユーザー確定、2026-10-21)。
 */

export const PRODUCTION_SERVICE_NAME = "tcd-dashboard-prod";
export const PRODUCTION_JOB_NAME = "tcd-dashboard-prod-finance-refresh";

export interface RuntimeEnvironment {
  /** Cloud Runサービス名(K_SERVICE) */
  service: string | undefined;
  /** Cloud Run Job名(CLOUD_RUN_JOB) */
  job: string | undefined;
  /** ローカルでの明示許可(ALLOW_PRODUCTION_DATA_WRITES) */
  localOverride: string | undefined;
}

function currentEnvironment(): RuntimeEnvironment {
  return {
    service: process.env.K_SERVICE,
    job: process.env.CLOUD_RUN_JOB,
    localOverride: process.env.ALLOW_PRODUCTION_DATA_WRITES,
  };
}

export function canWriteProductionData(env: RuntimeEnvironment = currentEnvironment()): boolean {
  if (env.service !== undefined) return env.service === PRODUCTION_SERVICE_NAME;
  if (env.job !== undefined) return env.job === PRODUCTION_JOB_NAME;
  return env.localOverride === "true";
}

export class ProductionDataWriteBlockedError extends Error {
  constructor(collection: string) {
    // 環境名・コレクション名だけを出す(データの中身は含めない)
    super(`本番データ(${collection})への書き込みは本番環境でのみ行えます`);
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
 * ローカルは ALLOW_PRODUCTION_DATA_WRITES=true のときだけ。
 */
export function canWriteFreeeTokenDocument(docId: string, env: RuntimeEnvironment = currentEnvironment()): boolean {
  if (env.service !== undefined) return env.service === docId;
  if (env.job !== undefined) return env.job.endsWith(JOB_SUFFIX) && env.job.slice(0, -JOB_SUFFIX.length) === docId;
  return env.localOverride === "true";
}

export function assertOwnFreeeTokenDocument(docId: string, env: RuntimeEnvironment = currentEnvironment()): void {
  if (!canWriteFreeeTokenDocument(docId, env)) throw new ProductionDataWriteBlockedError(`freeeAuth/${docId}`);
}
