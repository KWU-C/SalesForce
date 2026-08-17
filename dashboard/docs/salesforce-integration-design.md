# Salesforce連携 設計案

本ドキュメントはSalesforce API接続の**実装着手前**の設計案。ここに記載した項目名・型はすべて`sf sobject describe --sobject Process__c --target-org tcd-company`（メタデータ取得のみ、レコードデータは一切取得していない）で実際に確認したものであり、推測は含まない。未確認・要判断の項目は明示している。

**2026-08-06追記**: 業務定義（完了の定義、売上・粗利の項目、単位）はSalesforce集計値とGoogle Sheets実データとの突き合わせで検証済み。結果は`docs/salesforce-reconciliation-2025-09-11.md`参照。本文中の該当箇所にも反映済み。

## 0. 調査方法と前提

- 認証済みの`sf` CLI（`tcd-company`組織、`kawauchi@tcd.jp`、Status: Connected）を使い、`sf sobject describe`でオブジェクト定義（項目名・ラベル・型・必須可否・ピックリスト値）のみを取得した
- 業務定義の検算（`docs/salesforce-reconciliation-2025-09-11.md`）では、`sf data query`で**集計値（SUM/COUNT）のみ**を取得し、Google Sheetsの実セル値と突き合わせた。個々のレコード（案件明細）は取得・閲覧していない
- 既存のこのリポジトリ内Pythonプロジェクト（`/Users/kwu/Documents/SalesForce/src/`, `README.md`）に、TCD社内で既に運用されているSOQL・集計ロジックが文書化されており、これを一次情報として最大限活用した

## 1. Salesforce連携の設計案（全体構成）

```
Salesforce (Process__c)
      │  SOQL (読み取り専用)
      ▼
services/salesforce/salesforceClient.ts   … 認証・API呼び出しの薄いクライアント
services/salesforce/salesforceQueries.ts  … SOQL組み立て
services/salesforce/salesforceRecordMapper.ts … レコード→Domain型変換
      ▼
repositories/salesforceSalesProgressDataSource.ts … SalesProgressDataSource実装
      ▼
repositories/salesProgressRepository.ts … SALES_DATA_SOURCE=salesforceで選択
      ▼
UI層（無改修）
```

Google Sheets関連実装（`repositories/googleSheets*`, `repositories/parsers/`, `repositories/reportRegistry.ts`等）は**削除せず、本番データパスから切り離す**。位置づけの変更は8節参照。

## 2. 必要なSalesforceオブジェクト・項目一覧

### オブジェクト: `Process__c`（案件、標準レポート「リーダー別月別完了」等が参照する中心オブジェクト）

会社全体の案件を横断的に管理するオブジェクトで、CR1〜3以外の部門（パッケージ＆プロダクト、ブランディング等）のレコードも同じオブジェクトに混在している。**`bumonna__c`（部門名）での絞り込みが必須**。

| 表示名 | API参照名 | 型 | 必須/任意 | 集計での用途 | null時の扱い |
|---|---|---|---|---|---|
| 部門名 | `bumonna__c` | picklist | 任意（nillable） | **CR区分**。値に`CR1`/`CR2`/`CR3`が存在することを確認済み（他に`パッケージ＆プロダクト`等、CR以外の部門値も同居） | null＝CR1〜3以外の部門の可能性が高い。`WHERE bumonna__c IN ('CR1','CR2','CR3')`で除外 |
| 受注日 | `juchuubi__c` | date | 任意 | 受注進捗の月別集計キー | null＝未受注（提案・見積段階）。集計対象から除外 |
| 請求日 | `seikyuubi__c` | date | 任意 | 完了進捗の月別集計キー候補（後述4節） | null＝未請求。除外 |
| 納品予定日 | `nouhinyoteibi__c` | date | 任意 | 完了（見込み）判定に使用（既存Pythonコードの定義） | null＝納品日未定 |
| フェーズ | `phase__c` | picklist | 任意（デフォルト値`提案`） | 受注確定・完了・失注の判定 | 値: `提案,見積,受注,納品,請求,入金,失注`（確認済み、全7種） |
| 進捗 | `shinchoku__c` | picklist | 任意 | **phase__cとは別の状態遷移。用途は未確認（4節参照）** | 値: `受承,売完,売確,失完,引承,引未,請済`（確認済み、意味は要確認） |
| 受注確度 | `juchukakudo__c` | picklist | 任意 | 予測/確定の区分候補（4節参照） | 値: `A (80～100%), B (50～80%未満), C (新規問い合わせ), D (引き合い)` |
| 売上合計金額 | `uriagegoukei__c` | currency | 任意（非計算式） | 月別売上集計 | null＝金額未確定。合算時は0扱いではなく除外（SOQLのSUMはnullを自動的に無視する） |
| 原価合計 | `genka_goukei__c` | currency | 任意（**計算式**） | — | 粗利算出の内訳。直接は使わない想定 |
| 粗利 | `arari__c` | currency | 任意（**計算式**、`売上合計金額 − 原価合計`と推定されるが式の中身は未確認） | 月別粗利集計 | null＝入力元が未確定の場合nullになりうる |
| リーダー | `rida__c` | reference（`User`） | 任意 | 担当者。CR区分は`bumonna__c`で取れるため、リーダー→CRの手動マッピング（後述）は不要になる可能性が高い | null＝担当未定 |
| 案件名 | `Name` | string | 任意 | 表示用（今回の集計には不使用） | — |
| 所有者ID | `OwnerId` | reference | 必須 | 未使用予定 | — |
| 失注理由 | `shicchu_riyu__c` | textarea | 任意 | 失注理由の参考情報（集計には不使用） | — |

### 見つからなかった項目（推測で埋めていない）

| ユーザー依頼の項目 | 調査結果 |
|---|---|
| **完了日** | `Process__c`に該当する単独の日付項目は存在しない。「完了」はフェーズ・請求日・納品予定日の組み合わせで判定する運用（4節） |
| **月間粗利目標** | `Process__c`にも、82項目中どこにも該当項目なし。会社全体のカスタムオブジェクト一覧（27件、CreatedTask__c, Cost__c, Profit__c, Project__c, SalesStrategy__c等）にも目標・予算らしきオブジェクトは見当たらなかった。**Salesforce内には存在しないと判断**（6節） |
| **予測値と確定値の区分** | 単独のブール値・ピックリストは存在しない。既存コードの慣行では「フェーズが請求/入金＝実績」「納品予定日で見込み」、または「受注確度A」を確定寄りの判定に使っている（4節、要ユーザー確認） |
| **失注・キャンセル判定** | `phase__c = '失注'`のみ確認。「キャンセル」を失注と区別する項目は見当たらない。`shinchoku__c`の`失完`が関係する可能性があるが用途未確認 |

### 参考: 関連するが今回は使わない/使えないオブジェクト

- `Profit__c`（売上明細）: READMEに「2023年以降データ更新が止まっている」と明記。**主データソースにしない**
- `Opportunity`（標準商談）: READMEに「このプロジェクトの分析ではほぼ使われていない」と明記。**使わない**

## 3. CR区分についての重要な発見

既存Pythonコード（`leader_arari.py`）は`bumonna__c`を使わず、**リーダー名（`rida__r.Name`）をコード内にハードコードした辞書（`KNOWN_LEADERS`）でCR1〜4にマッピングする**という別の方式を採っていた。

一方、`bumonna__c`ピックリストには`CR1`/`CR2`/`CR3`の値が直接存在する。**`bumonna__c`で直接絞り込む方が正確でメンテナンスも不要**と考えられるが、以下の食い違いがあり要確認。

- `KNOWN_LEADERS`辞書には`CR4`と`(チーム未定)`のチームが存在するが、`bumonna__c`のピックリスト値には`CR4`が存在しない
- これは (a) CR4が新設され`bumonna__c`のピックリストがまだ更新されていない、(b) `KNOWN_LEADERS`が「次期チーム編成表(2026-07時点)」という将来時点の組織図であり現在のSalesforceデータとはまだ一致していない、(c) CR4案件が別の`bumonna__c`値で記録されている、のいずれかの可能性がある

**ユーザー確定（2026-08-06）**: 初期フェーズはCR1〜CR3のみを表示対象とし、CR4は集計対象外とする。`bumonna__c`ピックリストにCR4が正式登録された場合に追加できる構造（CR一覧を配列で持ちハードコードしない設計）を維持する。

## 4. 「完了」の定義（ユーザー確定・検算済み）

`README.md`に明記されている通り、TCD社内には元々**互いに矛盾する2つの「完了」定義**（定義A: 受注日ベース`kanryo_arari.py`／定義B: 請求日ベース+受注確度A、README記載の標準レポート準拠）が存在していたが、**ユーザーが定義Bをベースにした以下の定義に確定した**。

- 集計キー: 請求日 `seikyuubi__c`
- 条件: `juchukakudo__c = 'A (80～100%)'` かつ `phase__c != '失注'`（キャンセル・無効案件の除外は、Salesforce上に「キャンセル」を失注と区別する項目が見当たらなかったため、失注除外で代替）

**検算済み**: 2025年9〜11月・CR1〜3の9パターン全てでGoogle Sheetsの「完了」実績（売上・粗利）と千円未満の誤差で一致することを確認した（`docs/salesforce-reconciliation-2025-09-11.md`1節）。受注進捗（受注日ベース、`phase__c != '失注'`）も同様に検算し、9件中6件が完全一致、3件はシート固定タイミング由来の運用上の差異と判断した（同2〜3節）。

## 5. 集計ロジック（案、4節の判断待ち）

### 受注進捗（月別、CRごと）— ユーザー確定（2026-08-17）

```sql
SELECT bumonna__c crId,
       CALENDAR_YEAR(juchuubi__c) yr, CALENDAR_MONTH(juchuubi__c) mo,
       SUM(uriagegoukei__c) sales, SUM(arari__c) grossProfit, COUNT(Id) cnt
FROM Process__c
WHERE bumonna__c IN ('CR1','CR2','CR3')
  AND juchuubi__c != null
  AND juchukakudo__c = 'A (80～100%)'
  AND phase__c != '失注'
  AND juchuubi__c >= {期首} AND juchuubi__c <= {期末}
GROUP BY bumonna__c, CALENDAR_YEAR(juchuubi__c), CALENDAR_MONTH(juchuubi__c)
ORDER BY bumonna__c, CALENDAR_YEAR(juchuubi__c), CALENDAR_MONTH(juchuubi__c)
```

「受注確定分＝受注・納品・請求・入金を全て含む、確度A（80〜100%）のみ」というユーザー定義に基づき、
受注進捗にも完了進捗と同じ`juchukakudo__c = 'A (80～100%)'`条件を追加（2026-08-17確定）。

### 完了進捗（月別、CRごと）— ユーザー確定・検算済み（4節）

```sql
SELECT bumonna__c crId,
       CALENDAR_YEAR(seikyuubi__c) yr, CALENDAR_MONTH(seikyuubi__c) mo,
       SUM(uriagegoukei__c) sales, SUM(arari__c) grossProfit, COUNT(Id) cnt
FROM Process__c
WHERE bumonna__c IN ('CR1','CR2','CR3')
  AND juchukakudo__c = 'A (80～100%)'
  AND phase__c != '失注'
  AND seikyuubi__c >= {期首} AND seikyuubi__c <= {期末}
GROUP BY bumonna__c, CALENDAR_YEAR(seikyuubi__c), CALENDAR_MONTH(seikyuubi__c)
```

2025年9〜11月・CR1〜3で検算済み（`docs/salesforce-reconciliation-2025-09-11.md`1節、全9件が千円未満の誤差で一致）。

### リーダー単位の詳細集計（ユーザー確定、2026-08-06追加要件）

画面の基本はCR1〜3単位だが、**詳細としてリーダー単位の内訳も見たい**という要件が確定した。CR・リーダーとも同じ`Process__c`から取れるため、追加のオブジェクト調査は不要。`GROUP BY`に`rida__r.Name`を足すだけでよい（README.mdのリーダー別SOQL例に`bumonna__c`を組み合わせた形）。

```sql
-- 受注進捗、CR×リーダー×月
SELECT bumonna__c crId, rida__r.Name leaderName,
       CALENDAR_YEAR(juchuubi__c) yr, CALENDAR_MONTH(juchuubi__c) mo,
       SUM(uriagegoukei__c) sales, SUM(arari__c) grossProfit, COUNT(Id) cnt
FROM Process__c
WHERE bumonna__c IN ('CR1','CR2','CR3')
  AND juchukakudo__c = 'A (80～100%)'
  AND phase__c != '失注'
  AND juchuubi__c >= {期首} AND juchuubi__c <= {期末}
GROUP BY bumonna__c, rida__r.Name, CALENDAR_YEAR(juchuubi__c), CALENDAR_MONTH(juchuubi__c)

-- 完了進捗、CR×リーダー×月
SELECT bumonna__c crId, rida__r.Name leaderName,
       CALENDAR_YEAR(seikyuubi__c) yr, CALENDAR_MONTH(seikyuubi__c) mo,
       SUM(uriagegoukei__c) sales, SUM(arari__c) grossProfit, COUNT(Id) cnt
FROM Process__c
WHERE bumonna__c IN ('CR1','CR2','CR3')
  AND juchukakudo__c = 'A (80～100%)'
  AND phase__c != '失注'
  AND seikyuubi__c >= {期首} AND seikyuubi__c <= {期末}
GROUP BY bumonna__c, rida__r.Name, CALENDAR_YEAR(seikyuubi__c), CALENDAR_MONTH(seikyuubi__c)
```

**Domain層への影響**: 現行の`MonthlyProgress`型はCR単位（`crId`のみ）でリーダー内訳を持たない。CR単位の画面（現行UI）は無改修のまま、リーダー内訳は別途のドリルダウン用データ構造が必要になる。案（実装時に確定）:

- `MonthlyProgress`に`leaderName?: string`のような任意項目を足して同じ型で表現する、または
- 別型（例: `LeaderMonthlyProgress`）を新設し、CR単位画面から「詳細を見る」的な導線で別途取得する

いずれも既存のCR単位UIには影響しない設計にできる。Google Sheetsの「49期CR1推移」シートにも、CR1シートの下部（B29〜B31セル付近）に「所チーム」「福田チーム」「安田チーム」というチーム（リーダー）別の内訳・個別目標（5,000/月/チーム）が既に存在することを検算時に確認済み（`docs/salesforce-reconciliation-2025-09-11.md`6節）。目標値をリーダー単位でも持つかは別途確認が必要。

### 粗利達成率の計算方法

既存のGoogle Sheets実装（`repositories/parsers/reportBlockParser.ts`）と同じ方針を踏襲する。

```
粗利達成率 = 粗利(Salesforceから集計) ÷ 目標粗利(6節の別ソース) × 100
```

シート側の値をそのまま使わず**アプリ側で必ず再計算**する方針は、Salesforce移行後も変えない。SOQLの`SUM()`はnullを自動的に無視するため、「空欄は0ではなく未入力」という既存のnull方針（`MonthlyProgress.sales/grossProfit: number | null`）ともそのまま整合する。

### 事業年度・期間の定義

会社の会計年度定義（9月始まり〜翌8月終わり）は、既存Pythonコード（`kanryo_arari.py`の`FISCAL_YEAR_START_MONTH = 9`）と、ダッシュボード側の`config/fiscalPeriods.ts`の`FISCAL_MONTH_ORDER`で**既に一致している**。四半期・上半期の区切り方も要件と一致（9-11月・12-2月・3-5月・6-8月）。

## 6. 目標値の保持方法（ユーザー確定: Google Sheets）

2節の通り、月間粗利目標に相当する項目・オブジェクトはSalesforce内に見つからなかった。**ユーザーが「初期フェーズは既存のGoogle Sheetsまたは専用の目標管理用Google Sheetsを参照する」構成に確定した**（実績=Salesforce、目標値=Google Sheets、Domain層で統合）。

検算の過程で、現行の「49期CR1〜3推移」シートに実際に目標値が存在することを確認した（`docs/salesforce-reconciliation-2025-09-11.md`5節）。

- 各シートのF1セルに「月間粗利目標」ラベル、F2セルに値（CR1=15,000, CR2=15,000, CR3=15,000、いずれも千円単位＝月1,500万円）
- シートの粗利達成率（例: 115.98%）が`粗利 ÷ 月間粗利目標 × 100`の再計算値と一致することも確認済み

**将来の移行先**（ユーザー指定）: Salesforceカスタムオブジェクトまたは BigQuery。当面はGoogle Sheetsの当該セルを読む小さなアダプタ（既存の`services/google-sheets/sheetsClient.ts`のうち`getValues()`のみ再利用可能）をDomain層の外側に置き、Salesforce実績とマージする設計とする。

| 候補（参考: 検討時に挙げた案） | 状態 |
|---|---|
| **Google Sheets（採用）** | ユーザー確定。既存シートのF1/F2セルに実在することを確認済み |
| アプリ設定（コード内のJSON/TS設定ファイル） | 不採用（目標値の変更にコードデプロイが必要なため） |
| Salesforceカスタムオブジェクト（新規作成） | 将来の移行先候補 |
| Salesforceカスタムメタデータ型 | 将来の移行先候補 |
| BigQuery | 将来の移行先候補 |

## 7. Google Sheets実装の位置付け

本番表示のデータパスからは切り離すが、コードは削除しない。

| 用途 | 内容 |
|---|---|
| 画面仕様の参照 | 「●CR別_月次営業まとめ」は現行の営業進捗表のレイアウト・集計項目・見せ方のサンプルとして参照する（今回のUI設計の元になった） |
| Salesforce集計結果との検算 | Salesforceから集計した値と、Google Sheets上の値（人手で運用されている現行表）を比較し、差異があれば警告する用途に転用できる |
| 移行時の検算 | Salesforce連携の実装後、一定期間は並行運用し数値を突き合わせる |
| テストフィクスチャ | `repositories/parsers/`のテスト（40件超）は既にGoogle Sheets形式の合成データで書かれており、そのまま維持できる |

`SALES_DATA_SOURCE`環境変数に`salesforce`を追加する際も、`mock` / `google-sheets`は残す（`google-sheets`は本番選択肢ではなく検証用として位置づけを変更する）。

## 8. OAuth認証方式

`sf` CLIによる対話的ログイン（現在`kawauchi@tcd.jp`個人アカウントで接続済み）は、開発時のSOQL調査には使えるが、**Cloud Run上で動く本番アプリの認証方式としては使わない**（対話的ログイン・個人アカウント依存のため）。Google Sheets連携で採用した「ADC＋サービスアカウント偽装、JSONキー不発行」という方針と考え方を揃え、Salesforce側でも人手の対話的ログインに依存しない・専用の最小権限アカウントを使う方式を推奨する。

| 方式 | 概要 | 推奨度 |
|---|---|---|
| **JWT Bearer Flow（推奨）** | Salesforce Setupで「接続アプリケーション」を作成し、デジタル証明書（秘密鍵はSecret Manager等で管理）と専用の統合ユーザーを使う。パスワード不要、対話的ログイン不要 | ◎ Google Sheets側のSA偽装と同様に「機械同士の認証」として一貫性がある |
| **OAuth 2.0 Client Credentials Flow** | 接続アプリケーションでClient Credentials Flowを有効化し、client_id/client_secretで認証。証明書管理が不要な分JWTより設定は簡単 | ○ 組織のAPIバージョン・設定次第で利用可否が変わる（要確認） |
| 対話的Webログイン（`sf org login web`等） | 人間がブラウザでログインするフロー | ✕ 本番の自動化には不向き。開発時のSOQL調査専用 |

いずれの方式でも、**専用の統合ユーザー**（`kawauchi@tcd.jp`個人アカウントではなく）を作成し、9節の権限のみを付与することを推奨する。証明書・client_secret等の秘密情報は、Google Sheets同様Gitにもコードにも含めず、本番ではSecret Manager、ローカルでは`.gitignore`済みの専用ディレクトリで管理する。

## 9. 必要なSalesforce権限

- 対象オブジェクト: `Process__c` の**読み取り専用**アクセス
- 対象項目: 2節で列挙した項目（`bumonna__c`, `juchuubi__c`, `seikyuubi__c`, `nouhinyoteibi__c`, `phase__c`, `shinchoku__c`, `juchukakudo__c`, `uriagegoukei__c`, `genka_goukei__c`, `arari__c`）の**参照権限**のみ
- システム管理者権限・「全データ参照」等の広い権限は不要
- 実装方法: 専用のプロファイルまたは権限セットを作成し、統合ユーザーに割り当てる（項目レベルセキュリティで上記項目のみ許可）
- API有効化: 統合ユーザーに「API有効化」権限が必要（JWT Bearer Flow・Client Credentials Flowいずれも）

## 10. 不足情報（まとめ）

これまでの節に分散している「要確認」事項を集約する。

| # | 項目 | 状態 |
|---|---|---|
| 1 | 「完了」の定義 | ✅ **解決**（4節）。請求日＋受注確度A＋失注除外に確定、検算済み |
| 2 | CR4の扱い | ✅ **解決**（3節）。初期フェーズはCR1〜3のみ、CR4は対象外。追加できる構造は維持 |
| 3 | 目標値の保存先 | ✅ **解決**（6節）。Google Sheets（既存シートのF1/F2セル）に確定、実在確認済み |
| 4 | `shinchoku__c`（進捗）の用途 | 未解決。ただし4節の完了定義検算が完全一致したため、`shinchoku__c`を使わなくても正しい集計ができることが判明。**当面は不使用のまま進めてよい** |
| 5 | 予測値/確定値の厳密な定義 | 未解決だが優先度低下。今回確定した「完了」定義に予測/確定の区別は含まれないため、初期フェーズでは不要 |
| 6 | キャンセル判定 | 一部解決。「完了」定義では失注除外のみで検算が完全一致したため、**別途のキャンセル項目は無い（失注のみで十分）と判断してよい** |
| 7 | `uriagegoukei__c`が税込か税抜きか | ✅ **解決**（`docs/salesforce-reconciliation-2025-09-11.md`4節）。`uriagegoukei__c`をそのまま使えばGoogle Sheetsと一致するため、税込/税抜き変換は不要と判明 |
| 8 | `arari__c`の計算式の中身 | 式の中身自体は未確認だが、`docs/salesforce-reconciliation-2025-09-11.md`1節の検算でGoogle Sheetsと一致することを確認済みのため、**中身を知らなくてもそのまま使ってよい** |
| 9 | OAuth認証方式の最終決定 | 未解決。8節の2方式のいずれか、組織のSalesforce Editionで利用可能な方を確認 |
| 10 | 統合ユーザー・接続アプリケーションの作成 | 未解決。Salesforce Setup側の作業のため、TCD社内のSalesforce管理者への依頼が必要 |
| 11 | 受注進捗の一部差異（3/9件） | ✅ **原因分類済み**（`docs/salesforce-reconciliation-2025-09-11.md`3節）。シート固定タイミングとSalesforce更新タイミングのズレによる運用上の差異と判断。実装上の対応は不要 |

## 11. Google Sheets実装をどこまで残すか

7節の通り、**コードは全て残す**。変更するのは「本番データパスに組み込まない」という位置づけのみ。

- 残す: `repositories/parsers/`（`crProgressReportParser.ts`等）、`repositories/reportRegistry.ts`、`repositories/reportDefinitions.ts`、`repositories/googleSheetsSalesProgressDataSource.ts`、`services/google-sheets/`、`scripts/inspectSheets.ts`、関連テスト一式
- 変更する: `repositories/salesProgressRepository.ts`の`SALES_DATA_SOURCE`の位置づけ説明（`google-sheets`は「検証・比較用」であり本番選択肢ではない旨をコメントに明記）。実際の切り替えロジック自体は変更不要（Salesforceを追加する際に`case "salesforce"`を1行足すだけ）
- 削除しない理由: 7節の4用途（仕様参照・検算・移行時検算・テストフィクスチャ）で今後も使うため

## 12. Salesforce移行後も既存UIを無改修で使えるか

**使える設計になっている。** 理由は以下の通り。

- UI層（`DashboardClient`以下）は`CrProgress[]` / `MonthlyProgress` / `PeriodSummary`というDomain型にしか依存しておらず、データの取得元（Mock/Google Sheets/Salesforce）を一切意識しない（既存のGoogle Sheets実装時に確立した設計方針）
- `SalesProgressDataSource`インターフェース（`getCrProgress(): Promise<CrProgress[]>`）を`SalesforceSalesProgressDataSource`が実装すれば、`salesProgressRepository.ts`の`switch`文に1ケース追加するだけで切り替えられる
- 唯一の注意点: 現在の`MonthlyProgress.targetGrossProfit`は非null（`number`）。目標値をSalesforce以外のソース（6節）から取得する場合、`SalesforceSalesProgressDataSource`の実装内で実績（Salesforce）と目標（別ソース）をマージしてから`MonthlyProgress`を組み立てる必要があるが、これもDataSource内で完結し、UI・Domain型の変更は不要
- **リーダー単位の詳細（5節に追加）はCR単位UIの無改修とは別の話**。既存のCR単位画面（`DashboardClient`以下）はそのまま無改修で使えるが、リーダー別ドリルダウンを画面に追加する場合はUI層にも新しいコンポーネント・型が必要になる（5節参照）。これは「Salesforce移行に伴うUI改修」ではなく「新機能追加」であり、範囲を混同しないよう注意する

## 13. 実装完了（2026-08-07）

1〜4はすべて完了した。

1. ✅ OAuth認証方式: JWT Bearer Flowに確定。組織が「外部クライアントアプリ」方式(新UI)だったため作成手順は本ドキュメント執筆時の想定と異なったが、機能的には同じ
2. ✅ 統合ユーザー(`sf-dashboard-integration@tcd.jp`)・外部クライアントアプリ(`TCD Dashboard Integration`)・専用権限セット(`SF Dashboard API Read Access`)を作成済み
3. ✅ 目標値は**Google Sheetsではなく`SalesTarget__c`（Salesforce上の新規カスタムオブジェクト）に変更**（ユーザー方針転換、2026-08-07）。会社全体の年間目標(売上・粗利)のみ保持し、CR3等分・月12等分はアプリ側で計算する。詳細は`[[project_tcd_dashboard]]`メモリ参照
4. ✅ `SalesforceSalesProgressDataSource`実装完了。構成:
   - `src/config/salesforce.ts`: JWT設定の環境変数解決
   - `src/services/salesforce/salesforceClient.ts`: JWT署名(Node標準crypto、外部ライブラリ不使用)＋SOQL実行の薄いクライアント
   - `src/services/salesforce/salesforceQueries.ts`: 受注/完了/目標のSOQL組み立て（5節のクエリをそのまま実装）
   - `src/repositories/salesforceRecordMapper.ts`: 集計結果→`MonthlyProgress[]`変換、年間目標の月次按分
   - `src/repositories/salesforceSalesProgressDataSource.ts`: `SalesProgressDataSource`実装本体
   - `salesProgressRepository.ts`に`case "salesforce"`追加
   - テスト16件追加（クエリ組み立て・レコードマッピング・DataSource全体、いずれもフェイク注入で実ネットワーク不使用）、全パス
   - 実際の`tcd-company`組織に対する疎通確認済み（JWT認証・受注/完了集計クエリ・目標クエリいずれも成功）

**未実施（本番反映には別途ユーザーのGOが必要）**: Secret Manager登録（コンシューマーキー・JWT秘密鍵）、`dashboard/cloudbuild.yaml`の`--set-env-vars`変更（`SALES_DATA_SOURCE=salesforce`への切替）。現在の本番(`tcd-dashboard-prod`)は引き続き`SALES_DATA_SOURCE=mock`のまま
