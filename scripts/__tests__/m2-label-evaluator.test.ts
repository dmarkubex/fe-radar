import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { evaluateM2Labels, renderMarkdownReport } from "../m2-label-evaluator";

describe("M2 label evaluator", () => {
  it("passes a fully labeled miniature package", () => {
    const root = createFixtureRoot();
    writeMeta(root, {
      prefilter: 2,
      ner: 2,
      scorer: 2,
      scrubber: 2,
      backtest: 2
    });
    writeFixture(root, "spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv", [
      "id,title,content,label,reason,model_suggestion,reviewer,review_notes",
      "p1,电缆项目,,related,,related,alice,",
      "p2,娱乐新闻,,unrelated,,unrelated,alice,"
    ].join("\n"));
    writeFixture(root, "spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl", [
      JSON.stringify({
        id: "n1",
        title: "国家能源局发布 GB/T 12706-2020",
        content: "",
        entities: [{ type: "policy", text: "GB/T 12706-2020", start: 7, end: 23 }],
        predictedEntities: [{ type: "policy", text: "GB/T 12706-2020", start: 7, end: 23 }],
        reviewer: "alice"
      }),
      JSON.stringify({ id: "n2", title: "无实体", content: "", entities: [], predictedEntities: [], reviewer: "alice" })
    ].join("\n"));
    writeFixture(root, "spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json", JSON.stringify([
      scorerRow("s1", 50, 50),
      scorerRow("s2", 70, 70)
    ]));
    writeFixture(root, "spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl", [
      JSON.stringify({
        id: "r1",
        rawText: "联系人 13812345678",
        expectedRedactions: [{ type: "PHONE", text: "13812345678" }],
        reviewer: "alice"
      }),
      JSON.stringify({ id: "r2", rawText: "国家能源局发布政策", expectedRedactions: [], reviewer: "alice" })
    ].join("\n"));
    writeFixture(root, "spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json", JSON.stringify([
      backtestRow("b1", 10, 10, false),
      backtestRow("b2", 90, 90, true)
    ]));

    const report = evaluateM2Labels(root);

    expect(report.overallStatus).toBe("pass");
    expect(report.classes.map((item) => item.gate.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });

  it("blocks rather than fabricating metrics when manual labels are missing", () => {
    const root = createFixtureRoot();
    writeMeta(root, {
      prefilter: 1,
      ner: 1,
      scorer: 1,
      scrubber: 1,
      backtest: 1
    });
    writeFixture(root, "spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv", "id,title,content,label,reason,model_suggestion,reviewer,review_notes\np1,电缆项目,,,,related,,");
    writeFixture(root, "spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl", JSON.stringify({ id: "n1", title: "电缆", content: "", entities: [], reviewer: "" }));
    writeFixture(root, "spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json", JSON.stringify([scorerRow("s1", null, 50)]));
    writeFixture(root, "spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl", JSON.stringify({ id: "r1", rawText: "安全文本", expectedRedactions: [], reviewer: "" }));
    writeFixture(root, "spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json", JSON.stringify([backtestRow("b1", null, 50, null)]));

    const report = evaluateM2Labels(root);
    const markdown = renderMarkdownReport(report);

    expect(report.overallStatus).toBe("blocked");
    expect(markdown).toContain("blocked/missing labels");
    expect(markdown).toContain("Rows listed here block metric computation");
  });
});

function createFixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "m2-label-evaluator-"));
}

function writeMeta(root: string, classCounts: Record<string, number>): void {
  writeFixture(root, "spec/labels/_meta/sample-counts.json", JSON.stringify({
    source: "fixture",
    source_total: Object.values(classCounts).reduce((sum, value) => sum + value, 0),
    class_counts: classCounts
  }));
}

function writeFixture(root: string, path: string, content: string): void {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function scorerRow(id: string, expectedScore: number | null, predictedScore: number): Record<string, unknown> {
  return {
    id,
    title: id,
    content: "",
    expected: {
      d1Policy: expectedScore,
      d3Market: expectedScore,
      d4Tech: expectedScore,
      d5Business: expectedScore,
      qualityScore: expectedScore
    },
    model_reference: {
      d1Policy: predictedScore,
      d3Market: predictedScore,
      d4Tech: predictedScore,
      d5Business: predictedScore,
      qualityScore: predictedScore
    }
  };
}

function backtestRow(id: string, expectedScore: number | null, predictedScore: number, curated: boolean | null): Record<string, unknown> {
  return {
    id,
    title: id,
    content: "",
    expected: {
      d1Policy: expectedScore,
      d3Market: expectedScore,
      d4Tech: expectedScore,
      d5Business: expectedScore,
      qualityScore: expectedScore,
      curated
    },
    reference: {
      modelQualityScore: predictedScore
    }
  };
}
