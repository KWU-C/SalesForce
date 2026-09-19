import { describe, expect, it } from "vitest";
import { parseCsvRows, parseJournalCsv } from "./journalCsv";

/** 25列固定の仕訳帳CSV1行を作る(必要な列以外は空) */
function csvRow(fields: {
  code: string;
  date?: string;
  debit?: [string, string, number];
  credit?: [string, string, number];
  memo?: string;
}): string {
  const cols = Array<string>(25).fill("");
  cols[0] = fields.code;
  cols[3] = fields.date ?? "2026/08/15";
  if (fields.debit) [cols[4], cols[5], cols[8]] = [fields.debit[0], fields.debit[1], String(fields.debit[2])];
  else cols[8] = "0";
  if (fields.credit) [cols[10], cols[11], cols[14]] = [fields.credit[0], fields.credit[1], String(fields.credit[2])];
  else cols[14] = "0";
  cols[16] = fields.memo ?? "";
  return cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(",");
}

describe("parseCsvRows", () => {
  it("handles quoted fields with commas, escaped quotes and embedded newlines", () => {
    expect(parseCsvRows('"a,b","c""d","e\nf"\n"g","","h"\n')).toEqual([
      ["a,b", 'c"d', "e\nf"],
      ["g", "", "h"],
    ]);
  });

  it("accepts CRLF line endings and a missing trailing newline", () => {
    expect(parseCsvRows('"a","b"\r\n"c","d"')).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parseJournalCsv", () => {
  it("reads a single-row journal (2000) into one group with debit and credit lines", () => {
    const text = csvRow({
      code: "2000",
      debit: ["現金及び預金", "普通預金A", 500],
      credit: ["売掛金", "株式会社X", 500],
      memo: "入金 ﾌﾘｺﾐ",
    });

    expect(parseJournalCsv(text)).toEqual([
      {
        date: "2026-08-15",
        debits: [{ account: "現金及び預金", subAccount: "普通預金A", amount: 500, memo: "入金 ﾌﾘｺﾐ" }],
        credits: [{ account: "売掛金", subAccount: "株式会社X", amount: 500, memo: "入金 ﾌﾘｺﾐ" }],
      },
    ]);
  });

  it("groups a compound journal (2110 ... 2100 ... 2101) into one group, keeping one-sided rows", () => {
    const text = [
      csvRow({ code: "2110", debit: ["現金及び預金", "普通預金A", 990], credit: ["複合", "", 990] }),
      csvRow({ code: "2100", debit: ["複合", "", 1000], credit: ["受取手形", "", 1000] }),
      csvRow({ code: "2101", debit: ["支払手数料", "", 10], credit: ["複合", "", 10] }),
      csvRow({ code: "2000", debit: ["雑費", "", 1], credit: ["未払金", "", 1] }),
    ].join("\n");

    const groups = parseJournalCsv(text);

    expect(groups).toHaveLength(2);
    expect(groups[0].debits.map((l) => l.account)).toEqual(["現金及び預金", "複合", "支払手数料"]);
    expect(groups[0].credits.map((l) => l.account)).toEqual(["複合", "受取手形", "複合"]);
  });

  it("omits the blank side of a one-sided row instead of creating a zero line", () => {
    const text = [
      csvRow({ code: "2110", debit: ["現金及び預金", "普通預金A", 100], credit: ["売掛金", "", 100] }),
      csvRow({ code: "2101", debit: ["支払手数料", "", 5] }),
    ].join("\n");

    const [group] = parseJournalCsv(text);

    expect(group.credits).toHaveLength(1);
    expect(group.debits).toHaveLength(2);
  });

  it("fails closed on an unexpected column count (freee's CSV format changed)", () => {
    expect(() => parseJournalCsv('"2000","a","b"')).toThrow("journal_csv_unexpected_columns");
  });

  it("fails closed on a compound journal that never closes or continues without a start", () => {
    expect(() => parseJournalCsv(csvRow({ code: "2110", debit: ["雑費", "", 1] }))).toThrow(
      "journal_csv_unexpected_sequence"
    );
    expect(() => parseJournalCsv(csvRow({ code: "2101", debit: ["雑費", "", 1] }))).toThrow(
      "journal_csv_unexpected_sequence"
    );
  });

  it("fails closed on an unknown record code", () => {
    expect(() => parseJournalCsv(csvRow({ code: "9999" }))).toThrow("journal_csv_unknown_record_code");
  });

  it("returns no groups for an empty export", () => {
    expect(parseJournalCsv("")).toEqual([]);
  });
});
