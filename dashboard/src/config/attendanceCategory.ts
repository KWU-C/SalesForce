/**
 * 勤怠状況(/resource下部)のメンバー区分（`data/Member.numbers`の「リソース」列、
 * ユーザー提供、2026-09-18）。
 *
 * freee人事労務APIにはこの区分に相当するフィールドが存在しないことを実地確認済み
 * （employees/profile_rule/basic_pay_rule/allowance_rulesの4APIを実際に呼び出し、
 * 「正社員_所定8h_みなし32」のような表示ラベルはfreee画面側が内部設定から組み立てて
 * いるものと判断、公開APIには出てこない。2026-09-18）。そのためCR人数と同様、
 * 手動でメンテナンスする定数として持つ（新しいマスタは作らない、ユーザー確定）。
 *
 * 区分:
 * - EXCLUDED(対象外): 勤怠状況セクションに一切表示しない(役員等)
 * - SHORT_HOURS(時短) / CLERICAL(事務): 下段セクションにまとめて表示
 * - 上記いずれにも載っていない全員 = 対象(「正社員_所定8h_みなし32」相当)。
 *   平均残業時間の多い順(左)・少ない順(右)に二分割して表示する
 *
 * 氏名はfreee人事労務APIのdisplay_nameと突き合わせる(services/freee/freeeHrClient.ts、
 * features/attendance/attendance.ts参照)。表記ゆれ(空白の種類・前後空白)は
 * 突き合わせ側で正規化する。
 */
export const ATTENDANCE_EXCLUDED_NAMES: readonly string[] = [
  "山田 崇雄",
  "山崎 晴司",
  "川内 祥克",
  "生山 久展",
  "田中 恵子",
  "河﨑 美生",
];

export const ATTENDANCE_SHORT_HOURS_NAMES: readonly string[] = ["能登 愛", "柳田 佳奈", "澤間 紋華", "所 美由紀"];

export const ATTENDANCE_CLERICAL_NAMES: readonly string[] = ["牛尾 郁美", "伊藤 茜", "加藤 絵理子"];
