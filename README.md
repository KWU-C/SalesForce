# TCD Salesforce 営業分析

TCDのSalesforce組織（`tcd-company`）から営業データを取得し、受注・完了粗利の推移や課題を分析するプロジェクト。

## セットアップ

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Salesforce CLIでログイン済みであること（`sf org list`で`tcd-company`がConnectedになっているか確認）。
未ログインの場合:

```bash
sf org login web --alias tcd-company --instance-url https://tcd-company.my.salesforce.com
```

## 使い方

### 今期完了粗利の集計

```bash
.venv/bin/python src/kanryo_arari.py
```

会計年度（9月始まり〜翌8月終わり）の完了粗利をサマリーと月別内訳で出力し、`data/processed/`にCSVを保存する。

**完了の定義**:
- 対象: `Process__c`（案件）のうち受注日(`juchuubi__c`)が今期に入っているもの
- 受注確定済み（フェーズが「提案」「見積」「失注」以外）
- かつ、フェーズが「請求」「入金」まで進んでいる（実績） または 納品予定日(`nouhinyoteibi__c`)が今期末以前（実績＋見込み）

## 完了粗利の定義（2026-07-31確認・Salesforce標準レポート「リーダー別月別完了」準拠）

リーダー別・月別の完了粗利を見る際は、通年・月次いずれもこの条件で統一する。`src/kanryo_arari.py`の定義（受注日ベース）とは異なるので注意。

- **日付項目**: 受注日ではなく**請求日**(`seikyuubi__c`)で対象期間を絞り込む
- **フェーズ**: `見積`・`受注`・`納品`・`請求`・`入金`を全て含む（`提案`・`失注`のみ除外）
- **受注確度**(`juchukakudo__c`): `A (80～100%)`のみ

SOQL例（通年）:
```sql
SELECT rida__r.Name, SUM(arari__c) grossProfit
FROM Process__c
WHERE seikyuubi__c >= {期間開始} AND seikyuubi__c <= {期間終了}
AND phase__c IN ('見積','受注','納品','請求','入金')
AND juchukakudo__c = 'A (80～100%)'
GROUP BY rida__r.Name
```

月別に見る場合は`CALENDAR_YEAR(seikyuubi__c)`, `CALENDAR_MONTH(seikyuubi__c)`でGROUP BYに追加する。

**既知の差異**: `src/kanryo_arari.py`は受注日(`juchuubi__c`)ベース・フェーズ「請求」「入金」のみ（または納品予定日で見込み判定）・受注確度フィルタなしという別の定義で書かれている。Salesforce標準レポートの数値とは一致しないため、リーダー別実績を出す際はこのスクリプトを使わず、上記SOQL条件で都度集計すること。

## データ品質メモ

- `rida__c`(リーダー)などの集計結果に、チームのリーダー一覧に存在しない名前や不自然に少額・少件数のレコードが混ざっていたら、入力ミスの可能性を疑うこと。
  - 例: 2026-07-31時点の集計で「須田 史義」名義の実績(325,000円・4件)が検出されたが、リーダー一覧に存在せず入力ミスと判断。
  - こうした怪しい項目は、集計結果を渡す際に都度指摘する。

## データモデルのメモ

- `Process__c`（案件）: 受注〜納品〜請求〜入金までを管理する中心オブジェクト。`uriagegoukei__c`(売上)、`genka_goukei__c`(原価)、`arari__c`(粗利)。
- `Profit__c`（売上）: 案件に紐づく個別の売上明細。ZAC（外部会計システム）連携用フィールドも持つが、2023年以降はデータ更新が止まっている。
- `Opportunity`（標準商談オブジェクト）: このプロジェクトの分析ではほぼ使われていない（実データは`Process__c`側で管理）。
