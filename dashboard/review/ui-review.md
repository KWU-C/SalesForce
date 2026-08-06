# モック画面 仕様書

対象: `dashboard/` Step3実装（モックデータ版）
関連コード: `src/app/page.tsx`, `src/features/dashboard/DashboardClient.tsx`, `src/repositories/mockSalesProgressRepository.ts`, `src/config/fiscalPeriods.ts`

## 1. 各画面の構成

1ページ構成（`src/app/page.tsx`）。上から順に以下を縦に並べている。

1. **ヘッダー**（`components/Header.tsx`）: タイトル「月次営業進捗ダッシュボード」、対象期・対象月、「モックデータ」バッジ
2. **CRタブ**（`components/CrTabs.tsx`）: 全社／CR1／CR2／CR3 の切り替え（クライアント側state、`useState<CrId>("ALL")`が初期値）
3. **受注／完了カード**（`components/StatCard.tsx`）: 選択中CRの通期実績・目標・達成率を2枚並べて表示
4. **グラフ2種**（`features/dashboard/charts/`）
   - `AchievementRateChart.tsx`: 月別粗利達成率（受注・完了の折れ線）＋100%基準線
   - `MonthlyComparisonChart.tsx`: 月別粗利（受注・完了の棒グラフ＋目標の破線）
5. **期間集計カード**（`components/PeriodSummarySection.tsx`）: 受注・完了それぞれの四半期累計、上半期・下半期累計
6. **月別テーブル**（`components/MonthlyTable.tsx`）: 受注・完了それぞれの月別実績／目標／達成率
7. フッター注記（表示中の対象月＋モックデータである旨）

## 2. 表示しているKPI

- 受注／完了それぞれの「当月時点累計実績額」「目標額」「達成率」
- 月別の粗利達成率（%、受注・完了）
- 月別の粗利額（受注・完了・目標の比較）
- 四半期・上半期・下半期・通期の累計実績額と達成率

いずれも**粗利額ベース**。売上額は現状データモデルに存在しない（詳細は8節）。

## 3. 全社集計の計算方法

`repositories/mockSalesProgressRepository.ts` の `sumAllCr()` で、CR1・CR2・CR3の**同一月の実績額／目標額を単純合算**している（アプリ側合算）。スプレッドシート側に「全社」列が既にあるかは未確認（[[project_tcd_dashboard]]の不足情報を参照）。実データ接続時にどちらの方式を採るか要確認。

## 4. 対象月の判定方法

`config/fiscalPeriods.ts` の `MOCK_FISCAL_PERIOD.currentMonth`（現在値 `11`、指示書の例をそのまま仮置き）を固定値として全コンポーネントに渡している。日付から自動算出はしていない。

`currentMonth` より後の月（このモックでは12月）は「未到来」として実績額を `0` にし、月別テーブルでは `—` 表示、グラフでは折れ線・棒を欠損として描画しない（`connectNulls`／`null`データ）。

実運用でこの判定をどう行うか（システム日付から自動算出／スプレッドシート上の値を参照、等）は未確認。

## 5. 受注と完了の表示上の違い

- データ構造上は同じ`MonthlyProgress`型（`kind: "order" | "completed"`のみが違う）
- 色分け: 受注＝青（`--series-1`）、完了＝オレンジ（`--series-2`）で全グラフ・凡例共通
- カード・テーブルは受注／完了で別々に並べて表示するのみで、計算ロジックの違いはモック上ない
- 実データでは「受注表」「完了表」がスプレッドシート上で別セル範囲になる想定（指示書より）だが、セル範囲・集計方法の違いは未確認のため、モックでは同一の乱数生成ロジックで代用している

## 6. 四半期・上半期・通期の集計範囲

`config/fiscalPeriods.ts`に固定定義。**暦年ベースの仮置き**（1月始まり）。

| 区分 | 月 |
|---|---|
| 第1四半期 | 1, 2, 3月 |
| 第2四半期 | 4, 5, 6月 |
| 第3四半期 | 7, 8, 9月 |
| 第4四半期 | 10, 11, 12月 |
| 上半期 | 1〜6月 |
| 下半期 | 7〜12月 |
| 通期 | 1〜12月 |

TCDの実際の決算期・期首月が暦年と一致するかは未確認。ズレがある場合はこの月区分の組み替えが必要（[[feedback_tcd_dashboard_constraints]]の「不明な計算ルールを推測で補完しない」に該当するため、要確認事項としてここに明記）。

## 7. 達成率の色分けルール

`components/StatCard.tsx` の `statusColor()`:

| 達成率 | 色 | トークン |
|---|---|---|
| 100%以上 | 緑（good） | `--status-good` |
| 80%以上100%未満 | 黄（warning） | `--status-warning` |
| 80%未満 | 赤（critical） | `--status-critical` |

この閾値（100 / 80）は指示書に明記がなく、実装時の仮の目安。妥当な閾値かユーザー確認が必要。
※ 月別テーブル・期間集計カードでは色分けは行わず、数値のみを表示（意図的に受注／完了カードのみ強調）。

## 8. モバイル表示時のレイアウト変更

Tailwindのレスポンシブユーティリティで対応（`sm`ブレークポイント=640px）。

- ヘッダー: タイトルと対象期表示が `flex-wrap` で縦積みに変化
- CRタブ: `flex-wrap`で折り返し（現状4つなので390px幅でも折り返しは基本発生しない）
- 受注／完了カード: `grid-cols-1` → `sm:grid-cols-2`（モバイルは縦積み）
- グラフ: `grid-cols-1` → `lg:grid-cols-2`（モバイル・タブレットは縦積み、`ResponsiveContainer`で幅に追従）
- 期間集計カード: `grid-cols-2` → `sm:grid-cols-4`（モバイルでも2列は維持）
- 月別テーブル: `overflow-x-auto`のコンテナで横スクロール可能にし、テーブル自体は`min-w-[480px]`を確保（列が潰れない）

## 9. 現在モック値として固定している項目

- 対象事業期・対象月: 「50期・11月」（`MOCK_FISCAL_PERIOD`）
- CR数・CR名: CR1／CR2／CR3の3つ固定（`CR_LIST`）
- 月間粗利目標額: `3,000,000 + CR番号×500,000 + 月×20,000` という仮の式で自動生成（実際の目標値ではない）
- 月別実績額: シード付き疑似乱数で目標の70%〜130%の範囲に生成（`seededRandom()`、再現性のため決定的）
- 四半期・上半期・通期の月区分: 暦年ベース（6節参照）
- 達成率の色分け閾値: 100% / 80%（7節参照）

## 10. Google Sheets接続時に置き換える箇所

| モックの実装 | 接続時の対応 |
|---|---|
| `repositories/mockSalesProgressRepository.ts` | 同じ`CrProgress[]`を返す実装に差し替え。呼び出し側（`page.tsx`）のインターフェースは変更不要な設計 |
| （未実装）`src/services/google-sheets/` | Google Sheets APIクライアント・認証実装をここに追加（`googleapis`想定） |
| `config/fiscalPeriods.ts` の `MOCK_FISCAL_PERIOD` | 実際の事業期・対象月の算出ロジック、またはシート参照に置き換え |
| `config/fiscalPeriods.ts` の `QUARTERS`/`HALVES` | TCDの実際の決算期に合わせて月区分を修正（要確認） |
| 目標粗利額の生成式 | シート上の実際の目標セルを参照する形に置き換え |
| 全社集計（`sumAllCr`） | シート上に全社集計が既にあればそちらを参照する方式に変更の可能性あり（3節参照） |

以上の置き換えは、[[feedback_tcd_dashboard_constraints]]により**モック画面のユーザー確認が完了するまで着手しない**。
