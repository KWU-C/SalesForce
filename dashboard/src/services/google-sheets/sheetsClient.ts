import { google, sheets_v4 } from "googleapis";

/**
 * シートの生データ取得のみを担う薄いインターフェース。
 * 範囲は列全体（例: 'シート名'!A:Z）で取得し、行数・列順に依存しない。
 * ヘッダー名での列解決は services/google-sheets/readTableByHeader.ts が担う。
 */
export interface SheetsValuesReader {
  getValues(spreadsheetId: string, sheetName: string): Promise<string[][]>;
}

/**
 * 認証は Application Default Credentials (ADC) に委ねる。JSONキーファイルの
 * パスをコードにもenvにもハードコードしない（ユーザー指定、2026-08-06）。
 * `new google.auth.GoogleAuth({ scopes })` はcredentials/keyFilenameを
 * 指定しない限り、以下の優先順で自動的に認証情報を解決する
 * （google-auth-libraryの標準動作。このクラスは一切関与しない）。
 *
 *   1. GOOGLE_APPLICATION_CREDENTIALS環境変数（JSON鍵ファイルパス）
 *      ※ 例外的にJSONキー方式を使う場合のみ設定する（原則は使わない）
 *   2. ローカル: `gcloud auth application-default login
 *      --impersonate-service-account=<SA_EMAIL>` で生成されたADC
 *      （サービスアカウント偽装。これが原則の方式）
 *   3. Cloud Run/GCE等: メタデータサーバー経由でアタッチされたサービスアカウント
 *      （本番はこれ。Cloud RunにJSONキーを配置する必要はない）
 *
 * テスト時はこのクラスを直接使わず、SheetsValuesReaderインターフェースを
 * 実装したフェイクを注入する（googleSheetsSalesProgressDataSource.test.ts参照）。
 * 認証クライアント自体をモックする必要がない設計になっている。
 */
export class GoogleApiSheetsValuesReader implements SheetsValuesReader {
  private client: Promise<sheets_v4.Sheets> | undefined;

  private getClient(): Promise<sheets_v4.Sheets> {
    if (!this.client) {
      this.client = (async () => {
        const auth = new google.auth.GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
        return google.sheets({ version: "v4", auth });
      })();
    }
    return this.client;
  }

  async getValues(spreadsheetId: string, sheetName: string): Promise<string[][]> {
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:Z`,
    });
    return (res.data.values ?? []) as string[][];
  }

  /**
   * スプレッドシート内の全シート（タブ）名を取得する。
   * CR1〜CR3・全社推移がそれぞれどのシート名に対応するか、事前に分かって
   * いなくても一覧を確認できるようにするための診断用メソッド
   * （scripts/inspectSheets.ts参照）。
   */
  async listSheetNames(spreadsheetId: string): Promise<string[]> {
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    return (res.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title));
  }
}
