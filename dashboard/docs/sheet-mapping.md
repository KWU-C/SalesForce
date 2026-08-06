# Google Sheets マッピング仕様書

CR1〜CR3の実シート（「●CR別_月次営業まとめ」相当）は**帳票形式**であり、1行目がヘッダー行の正規化テーブルではないことが判明した（2026-08-06ユーザー指摘）。これを受けてParser構成を全面的に見直した。

**実際のスプレッドシートID・シート名・ラベル文言はまだ確認していない。** 実接続（Google Sheets API疎通、サービスアカウント作成、Cloud Run、IAP、Secret Manager）はまだ行っていない（[[feedback_tcd_dashboard_constraints]]）。認証はJSONキーファイルを発行せず、Application Default Credentials＋サービスアカウント偽装を用いる方針（4.5節、ユーザー指定2026-08-06）。

## 0. 実シートの構造（ユーザー確認済みの特徴）

- 月が横方向（列）に並ぶ
- 受注と完了が左右のブロックに分かれる
- 売上・粗利・粗利達成率が縦方向（行）に並ぶ
- 9〜11月・12〜2月・3〜5月・6〜8月でブロック（四半期）が分かれる（`config/fiscalPeriods.ts`の9月始まり四半期定義と一致）
- 四半期・上半期・通期の集計列が存在する
- CRごとのシートと全社推移シートで構造が異なる（詳細未確認）
- CR1〜CR3はそれぞれ**1シートに受注・完了の両方を含む**（受注表・完了表が別シートではない）

## 1. セル座標ではなくラベル探索方式（ユーザー指定）

セル座標（A3、C5等）は一切ハードコードしない。次の手順でシート全体からラベル文字列を探索し、その相対位置を基準に値を取得する（`repositories/parsers/`）。

1. 「受注」「完了」ラベルの位置をシート全体から探索し、列範囲でブロックを2分割する（`splitColumnsByTwoLabels()`）。間隔が変わっても、左右が入れ替わっても対応する
2. 各ブロックの列範囲内で「売上」「粗利」「目標粗利」「粗利達成率」の行、「1月」〜「12月」の列を探索する（`extractMonthlyProgressFromBlock()`）。**同じラベルが他方のブロックにもあっても、列範囲で区別されるため混同しない**
3. 四半期・上半期・通期のラベルは検算にのみ使う（2節参照）。存在しなくてもエラーにならない
4. 必須ラベル（受注/完了/売上/粗利/目標粗利/月が1つも無い）が見つからない場合、どのラベルが・どのブロックで見つからないかを明示した`SheetParseError`を投げる
5. 同じラベルが同一ブロック内で複数見つかった場合（一意に特定できない）も明確なエラーにする

## 1.5 空欄は0ではなく未入力（null）として扱う（ユーザー指定、2026-08-06）

シート上の売上・粗利セルが空欄の場合、`0`ではなく`null`（未入力）としてDomainモデルへ渡す。0円という実績と、まだ入力されていないことを区別するため。

- `services/google-sheets/cellValueParsing.ts`の`parseNumberOrNull()`が空欄・数値化できない値を`null`として返す（`parseNumber()`は正規化テーブル用に0を返す挙動のまま維持）
- `MonthlyProgress.sales` / `grossProfit` / `achievementRate`は`number | null`（目標粗利`targetGrossProfit`は非null。目標は常に設定されている前提）
- 月別テーブル・カード・グラフはnullを「—」として表示する（0円とは見た目上も区別する）
- 期間集計（四半期・上半期・通期）は、範囲内で入力済みの月だけを合算する。範囲内が全て未入力ならその期間もnull（`features/sales-progress/aggregate.ts`）
- 全社(ALL)合算も同様に、CRごとに未入力のものは無視して合算する（全CR未入力の月のみnull、`repositories/sumMonthlyProgressAcrossCr.ts`）
- 四半期・上半期・通期の検算（シート側集計値との比較）も、対象期間が全て未入力の場合はスキップする（`repositories/parsers/reportBlockParser.ts`）

## 2. 月別データのみを正データとする（ユーザー指定）

- `MonthlyProgress[]`（Domainの正データ）は**月別セルから組み立てる**。四半期・上半期・通期はシート側に集計列があっても取り込まない
- 画面側の四半期・上半期・通期表示は、従来通りアプリ側`summarizePeriod()`が月別データから再集計する（このロジックは今回変更していない）
- シート側に四半期・上半期・通期の集計列がある場合は**検算にのみ使う**。月別データからの再集計値との差が許容範囲（`AMOUNT_TOLERANCE_YEN`、現在1円）を超えたら警告ログを出す（`console.warn`、例外は投げない）
- 粗利達成率も同様に`粗利 ÷ 目標粗利 × 100`で必ず再計算する。シート側に達成率列がある場合は検算にのみ使い、差が許容範囲（`ACHIEVEMENT_RATE_TOLERANCE_POINTS`、現在0.5ポイント）を超えたら警告する
- 許容差は`repositories/parsers/reportLabels.ts`の`ACHIEVEMENT_RATE_TOLERANCE_POINTS` / `AMOUNT_TOLERANCE_YEN`で一元管理

## 3. 未確定のためプレースホルダーとしている項目

| # | 項目 | 状態 |
|---|---|---|
| 1 | GoogleスプレッドシートID | 未確認（環境変数`GOOGLE_SHEETS_SPREADSHEET_ID`） |
| 2 | CR1〜CR3のシート名（3シート、受注・完了は同一シート内） | 未確認（環境変数`GOOGLE_SHEETS_{CR1\|CR2\|CR3}_SHEET_NAME`） |
| 3 | 全社推移シートのシート名 | 未確認（環境変数`GOOGLE_SHEETS_COMPANY_SHEET_NAME`）。初期フェーズはCR1〜3合算を使うため未接続 |
| 4 | 「受注」「完了」「売上」「粗利」「粗利達成率」の実際のラベル文言 | 未確認。`repositories/parsers/reportLabels.ts`の`REPORT_LABELS`に集約、ここだけ直せばよい |
| 5 | **「目標粗利」に相当するラベル文言** | **未確認・要注意**: ユーザー提示のラベル一覧（受注/完了/売上/粗利/粗利達成率/月/四半期等）に「目標粗利」は含まれていなかったが、粗利達成率の再計算に必須のため仮ラベルとして追加した。実シートでの正式な文言を確認すること |
| 6 | 全社推移シートの実際の構造 | 未確認。「CRごとのシートと構造が異なる」とのみ判明。`companyProgressReportParser.ts`はCRシートと同じ受注/完了ブロック構造を試み、無ければ単一ブロックとして解析するフォールバックを実装済みだが未検証 |
| 7 | 金額単位（円／千円） | 未確認。現状は円のまま数値化 |
| 8 | 許容差の妥当性（達成率0.5pt、金額1円） | 未確認。運用開始後に調整が必要な可能性あり |

## 4. 環境変数一覧（プレースホルダー、値は未設定）

| 環境変数 | 用途 |
|---|---|
| `SALES_DATA_SOURCE` | `mock`（デフォルト）または`google-sheets` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | 対象スプレッドシートID |
| `GOOGLE_SHEETS_CR1_SHEET_NAME` | CR1の月次営業まとめシート名（受注・完了の両方を含む） |
| `GOOGLE_SHEETS_CR2_SHEET_NAME` | CR2の同上 |
| `GOOGLE_SHEETS_CR3_SHEET_NAME` | CR3の同上 |
| `GOOGLE_SHEETS_COMPANY_SHEET_NAME` | 全社推移シート名（現状未接続、将来用） |

**シート名は事前に分からなくてよい**: `GOOGLE_SHEETS_SPREADSHEET_ID`だけ設定した状態で`npm run inspect:sheets`を実行すると、まずスプレッドシート内の全シート（タブ）名一覧を表示する（`GoogleApiSheetsValuesReader.listSheetNames()`）。CR1〜CR3・全社推移がどのシート名に対応するかを確認してから、上記の`_SHEET_NAME`系環境変数を設定すればよい。

サービスアカウントの秘密鍵や認証JSONは`.env`にもリポジトリにも保存しない。認証方法は4.5節参照。

## 4.5 認証方式: Application Default Credentials + サービスアカウント偽装（ユーザー指定、2026-08-06）

**原則としてJSONキーファイルは発行しない。** ローカル開発・本番のいずれも、JSONキーをコード・env・リポジトリのどこにも置かない構成とする。

### Google Cloud側の準備（ユーザー側で実施）

1. 対象Google Cloudプロジェクトを決定
2. そのプロジェクトでGoogle Sheets APIを有効化
3. 読み取り専用サービスアカウントを作成する。**プロジェクト全体のEditor等のIAMロールは付与しない**
4. 対象スプレッドシート「●CR別_月次営業まとめ」を、そのサービスアカウントのメールアドレスへ**閲覧者権限のみ**で共有する（IAMロールではなく、スプレッドシート単位の共有設定で完結する）

### ローカル認証（原則の方式）

JSONキーを使わず、サービスアカウント偽装によるADCを使う。

```bash
gcloud auth application-default login \
  --impersonate-service-account=<SERVICE_ACCOUNT_EMAIL>
```

実行するユーザー（開発者本人のGoogleアカウント）には、対象サービスアカウントを偽装するために必要な最小限の権限（`roles/iam.serviceAccountTokenCreator`など、対象SAへの範囲限定）のみを付与する。このコマンドを実行すると、ローカルの標準ADC置き場（`~/.config/gcloud/application_default_credentials.json`、これはgcloudが管理する認証情報でありJSONキーファイルではない）に偽装用の認証情報が保存され、`google-auth-library`（`googleapis`パッケージが内部で使用）が自動的にこれを検出する。**アプリケーション側はGOOGLE_APPLICATION_CREDENTIALS環境変数の設定を必須としない**（`src/services/google-sheets/sheetsClient.ts`は`credentials`や`keyFilename`を一切指定せず`new google.auth.GoogleAuth({ scopes })`のみを呼ぶため、ADCの標準解決順序がそのまま適用される）。

### 本番（Cloud Run、将来フェーズ）

Cloud Runサービスに実行用サービスアカウントを直接割り当てる。JSONキーは不要（メタデータサーバー経由で自動的に認証情報が取得される）。アプリケーションコードの変更は不要（ローカルと同じ`GoogleAuth()`呼び出しがそのままCloud Run上のSAを使う）。

### 例外: JSONキー方式（サービスアカウント偽装が使えない場合のみ）

以下の場合に限り、JSONキー方式へ切り替える。

- 偽装に必要なIAM権限を付与できない組織ポリシー上の制約がある
- ローカル環境で`gcloud` CLIの利用そのものができない

切り替える場合は、**先に利用できない理由を報告してから**変更する。JSONキーを使う場合も、
- キーはGit管理外の専用ディレクトリ（例: `dashboard/.secrets/`、`.gitignore`で除外）に置く
- ファイル権限を所有者限定（`chmod 600`）にする
- `GOOGLE_APPLICATION_CREDENTIALS`でファイルパスを指定する

JSONキー方式をデフォルト手順にはしない。

## 5. Parser構成（ReportRegistry経由、2026-08-06更新）

「Google Sheetsを読む」処理と「取得したグリッドがどの帳票かを判定してParserを
選ぶ」処理を分離した。`GoogleSheetsSalesProgressDataSource`は特定の帳票形式を
知らず、取得したグリッドを`ReportRegistry`に渡すだけ。Parserは「Google Sheets
だから」ではなく「この帳票の形だから」選ばれる（`repositories/reportRegistry.ts`
参照）。

| ファイル | 役割 |
|---|---|
| `repositories/reportRegistry.ts` | `ReportRegistry`本体。帳票定義（帳票名・必須ラベル・Parser・DomainMapper）を登録し、グリッドの必須ラベル充足度から帳票を判定して該当のParser→DomainMapperへ委ねる |
| `repositories/reportDefinitions.ts` | 具体的な帳票定義（`CR_PROGRESS_REPORT`, `COMPANY_PROGRESS_REPORT`, `NORMALIZED_TABLE_REPORT`）と`createDefaultReportRegistry()` |
| `repositories/parsers/sheetGrid.ts` | グリッド探索の低レベルAPI（`findCellsInRegion`, `findSingleCell`, `SheetParseError`等）。セル座標を直接扱わない |
| `repositories/parsers/reportLabels.ts` | 探索対象ラベル文言・許容差の一元管理 |
| `repositories/parsers/reportBlockParser.ts` | ブロック分割（`splitColumnsByTwoLabels`）／生データ抽出（`extractRawBlockData`＝Parser段）／Domain変換＋検算（`mapRawBlockToMonthlyProgress`＝DomainMapper段）の共通エンジン |
| `repositories/parsers/crProgressReportParser.ts` | CR別シート（受注/完了ブロック）専用。`parseCrProgressReportRaw`(Parser)＋`mapCrProgressReportToDomain`(DomainMapper)。**実装済み** |
| `repositories/parsers/companyProgressReportParser.ts` | 全社推移シート専用。`parseCompanyProgressReportRaw`＋`mapCompanyProgressReportToDomain`。**構造未確認のため要検証** |
| `repositories/parsers/normalizedTableParser.ts` | 1行目がヘッダー行の正規化テーブル用。`parseNormalizedTableRaw`＋`mapNormalizedTableToDomain`。**削除せず維持**（将来の正規化入力シート・BigQuery等のため）。現状どのDataSourceからも未使用（Registryには登録済みで判定候補には入っている） |

各帳票定義は「帳票名／必須ラベル／Parser（生データ抽出）／DomainMapper（業務ルール適用）」の4点セットで`ReportDefinition<TRaw>`として表現する。Registryは各定義の`requiredLabels`が**全て**グリッド上に存在するかで候補を絞り込み、複数候補があれば`requiredLabels`が最も多い（＝最も具体的な）定義を採用する。同数で並んだ場合は一意に決められないため`SheetParseError`を投げる。

例: CR別シートは「受注/完了/売上/粗利/目標粗利」の5ラベルを持つため`CR_PROGRESS_REPORT`(5ラベル)にも`COMPANY_PROGRESS_REPORT`(3ラベル、受注/完了を必須にしていない)にも該当しうるが、ラベル数の多い`CR_PROGRESS_REPORT`が優先されるため誤判定しない。

## 6. 実帳票からDomainモデルへの変換フロー

```
Google Sheets（帳票形式、セル座標不問）
      │  GoogleApiSheetsValuesReader.getValues()
      │  ('シート名'!A:Z で列全体を取得。セル番地は指定しない)
      ▼
ReportRegistry.parse(grid, { crId })   … reportRegistry.ts
      │  1) 登録済み帳票定義（reportDefinitions.ts）のrequiredLabelsを
      │     全て満たすか判定し、最も具体的な帳票を1つ選ぶ（5節参照）
      │  2) 選ばれた帳票定義の Parser を実行
      ▼
  【Parser段（帳票形式に依存）】例: parseCrProgressReportRaw
      │  splitColumnsByTwoLabels(grid, "受注", "完了") で列範囲を2ブロックに分割
      │  （間隔・左右の入れ替わりに依存しない）
      │  各ブロックで extractRawBlockData() が「売上」「粗利」「目標粗利」
      │  「粗利達成率」の行、「1月」〜「12月」の列をラベル探索し、
      │  生の値（RawMonthlyCells/RawPeriodSubtotal）を取り出す
      │  （業務ルール・再計算は一切行わない）
      ▼
  【DomainMapper段（帳票形式に依存しない）】例: mapCrProgressReportToDomain
      │  mapRawBlockToMonthlyProgress() が
      │  → achievementRate を grossProfit÷targetGrossProfit×100 で必ず再計算
      │  → シート側に粗利達成率があれば差異を検算し、許容超過なら警告文字列を追加
      │  → 四半期/上半期/通期の生値があれば月別データの再集計と比較し、
      │    許容超過なら警告文字列を追加（Domainには取り込まない）
      │  → MonthlyProgress[] を構築
      ▼
      { order: MonthlyProgress[] | null, completed: MonthlyProgress[] | null, warnings: string[] }
      ▼
GoogleSheetsSalesProgressDataSource.getCrProgress()
      │  CR1〜CR3を並行取得、それぞれRegistryへ委譲、warningsをconsole.warnで出力
      │  sumMonthlyProgressAcrossCr()で全社(ALL)を合算（月の値でグルーピング）
      │  Promise<CrProgress[]>  ※ SalesProgressDataSource インターフェースの契約
      ▼
src/repositories/salesProgressRepository.ts
      │  SALES_DATA_SOURCE環境変数でMock/Google Sheetsを切り替え
      ▼
src/app/page.tsx → DashboardClient以下のUI層
      │  summarizePeriod()で四半期・上半期・通期を集計（月別データから。シート集計値は使わない）
      ▼
画面表示（売上・粗利・粗利達成率）
```

## 7. 実シート構造の調査用診断スクリプト

```
npm run inspect:sheets
```

`scripts/inspectSheets.ts`。まずスプレッドシート内の全シート名一覧を表示し、続けて対象シート（CR1〜CR3・全社推移、環境変数が設定されているもののみ）について以下を表示する。**実データの金額等の数値セルの中身は一切ログに出力しない**（表示するのはラベル文字列とそのセル位置・件数のみ）。Google Sheets API自体が返すエラー（接続失敗・権限不足等）も生のメッセージは出さず、固定カテゴリに分類してから表示する（`repositories/salesDataSourceError.ts`の`classifySheetsError()`）。

- スプレッドシート内の全シート名一覧
- 各シートへの接続可否
- 行数・列数
- 「受注」「完了」の検出位置
- 各月（1月〜12月）の検出位置
- 「売上」「粗利」「目標粗利」「粗利達成率」の検出位置
- **ReportRegistryによる帳票判定結果**（「CR別月次営業まとめ」「全社推移」「正規化テーブル」のどれと判定されたか）
- 判定された帳票のParser／DomainMapper実行結果（成功／失敗）と警告一覧

環境変数（4節）が未設定のため、**現時点ではまだ実行していない**（未設定の場合はエラーメッセージのみを表示してスキップする設計になっており、確認済み）。

## 8. 未実施・次のステップ

1. Google Cloud側の準備（4.5節）: プロジェクト決定、Sheets API有効化、読み取り専用サービスアカウント作成、対象スプレッドシートの共有
2. ローカルで`gcloud auth application-default login --impersonate-service-account=<SA_EMAIL>`を実行（開発者本人が偽装に必要な最小権限を持つこと）
3. `GOOGLE_SHEETS_SPREADSHEET_ID`を設定し`npm run inspect:sheets`を実行、シート名一覧・接続可否を確認
4. シート名が判明したら`GOOGLE_SHEETS_{CR1|CR2|CR3|COMPANY}_SHEET_NAME`を設定し、再度`npm run inspect:sheets`でラベル検出位置・Registry判定結果を確認（金額は出力されない）
5. 実ラベルを`repositories/parsers/reportLabels.ts`の`REPORT_LABELS`へ反映（特に「目標粗利」相当のラベル文言）
6. 診断結果を踏まえてParserの前提（現状の左右ブロック・行ラベル方式）が実際と合っているか検証し、必要なら`reportBlockParser.ts`を調整
7. 問題なければ`SALES_DATA_SOURCE=google-sheets`でローカル疎通確認
8. Cloud Run／IAP／Secret Manager本番設定は別途ユーザーの明示的なGOを待つ（Cloud Run移行時もJSONキーではなくアタッチされたサービスアカウントを使う、4.5節参照）
