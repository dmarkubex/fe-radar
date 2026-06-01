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

  it("per-doc NER recall rejects cross-document false matches", () => {
    // Doc A expects {policy, "GB/T 12706"} but has NO matching prediction.
    // Doc B has NO expected entities but DOES predict {policy, "GB/T 12706"}.
    // Old global-set approach: "GB/T 12706" in global predicted set → matches doc A's expected → recall = 1.0
    // Per-doc approach: doc A's expected entity can only match doc A's predictions → recall = 0.0
    const root = createFixtureRoot();
    writeMeta(root, { prefilter: 2, ner: 2, scorer: 2, scrubber: 2, backtest: 2 });
    writeFixture(root, "spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv", [
      "id,title,content,label,reason,model_suggestion,reviewer,review_notes",
      "p1,电缆项目,,related,,related,alice,",
      "p2,娱乐新闻,,unrelated,,unrelated,alice,"
    ].join("\n"));
    writeFixture(root, "spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl", [
      JSON.stringify({
        id: "n1", title: "国家能源局发布 GB/T 12706-2020", content: "",
        entities: [{ type: "policy", text: "GB/T 12706-2020", start: 7, end: 23 }],
        predictedEntities: [{ type: "org", text: "国家能源局", start: 0, end: 5 }],
        reviewer: "alice"
      }),
      JSON.stringify({
        id: "n2", title: "无关文档", content: "",
        entities: [],
        predictedEntities: [{ type: "policy", text: "GB/T 12706-2020", start: 0, end: 16 }],
        reviewer: "alice"
      })
    ].join("\n"));
    writeFixture(root, "spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json", JSON.stringify([
      scorerRow("s1", 50, 50), scorerRow("s2", 70, 70)
    ]));
    writeFixture(root, "spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl", [
      JSON.stringify({ id: "r1", rawText: "联系人 13812345678", expectedRedactions: [{ type: "PHONE", text: "13812345678" }], reviewer: "alice" }),
      JSON.stringify({ id: "r2", rawText: "国家能源局发布政策", expectedRedactions: [], reviewer: "alice" })
    ].join("\n"));
    writeFixture(root, "spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json", JSON.stringify([
      backtestRow("b1", 10, 10, false), backtestRow("b2", 90, 90, true)
    ]));

    const report = evaluateM2Labels(root);
    const nerGate = report.classes.find((c) => c.className === "ner")!.gate;

    // Per-doc recall: doc A has 1 expected, 0 matched (prediction was wrong entity).
    // Doc B has 0 expected (empty entities, but reviewed). Total: 0/1 = 0.0
    expect(nerGate.metricValue).toBe(0);
    expect(nerGate.status).toBe("fail");
    expect(nerGate.detail).toContain("per-doc");
  });

  it("backtest falls back to qualityScore when modelQualityScore is non-finite", () => {
    const root = createFixtureRoot();
    writeMeta(root, { prefilter: 2, ner: 2, scorer: 2, scrubber: 2, backtest: 2 });
    writeFixture(root, "spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv", [
      "id,title,content,label,reason,model_suggestion,reviewer,review_notes",
      "p1,电缆项目,,related,,related,alice,",
      "p2,娱乐新闻,,unrelated,,unrelated,alice,"
    ].join("\n"));
    writeFixture(root, "spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl", [
      JSON.stringify({ id: "n1", title: "t", content: "", entities: [{ type: "policy", text: "X", start: 0, end: 1 }], predictedEntities: [{ type: "policy", text: "X", start: 0, end: 1 }], reviewer: "alice" }),
      JSON.stringify({ id: "n2", title: "t", content: "", entities: [], predictedEntities: [], reviewer: "alice" })
    ].join("\n"));
    writeFixture(root, "spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json", JSON.stringify([
      scorerRow("s1", 50, 50), scorerRow("s2", 70, 70)
    ]));
    writeFixture(root, "spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl", [
      JSON.stringify({ id: "r1", rawText: "联系人 13812345678", expectedRedactions: [{ type: "PHONE", text: "13812345678" }], reviewer: "alice" }),
      JSON.stringify({ id: "r2", rawText: "安全文本", expectedRedactions: [], reviewer: "alice" })
    ].join("\n"));
    // reference.modelQualityScore is a string "garbage" (non-finite) but reference.qualityScore is valid
    writeFixture(root, "spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json", JSON.stringify([
      {
        id: "b1", title: "b1", content: "",
        expected: { d1Policy: 10, d3Market: 10, d4Tech: 10, d5Business: 10, qualityScore: 10, curated: false },
        reference: { modelQualityScore: "garbage", qualityScore: 10 }
      },
      {
        id: "b2", title: "b2", content: "",
        expected: { d1Policy: 90, d3Market: 90, d4Tech: 90, d5Business: 90, qualityScore: 90, curated: true },
        reference: { modelQualityScore: "garbage", qualityScore: 90 }
      }
    ]));

    const report = evaluateM2Labels(root);
    const backtestGate = report.classes.find((c) => c.className === "backtest")!.gate;

    // Should fall back to qualityScore, producing a valid Pearson (perfect correlation = 1.0)
    expect(backtestGate.status).toBe("pass");
    expect(backtestGate.metricValue).toBeCloseTo(1.0, 5);
  });

  it("scorer detail does not contain raw NaN", () => {
    const root = createFixtureRoot();
    writeMeta(root, { prefilter: 2, ner: 2, scorer: 2, scrubber: 2, backtest: 2 });
    writeFixture(root, "spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv", [
      "id,title,content,label,reason,model_suggestion,reviewer,review_notes",
      "p1,电缆项目,,related,,related,alice,",
      "p2,娱乐新闻,,unrelated,,unrelated,alice,"
    ].join("\n"));
    writeFixture(root, "spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl", [
      JSON.stringify({ id: "n1", title: "t", content: "", entities: [{ type: "policy", text: "X", start: 0, end: 1 }], predictedEntities: [{ type: "policy", text: "X", start: 0, end: 1 }], reviewer: "alice" }),
      JSON.stringify({ id: "n2", title: "t", content: "", entities: [], predictedEntities: [], reviewer: "alice" })
    ].join("\n"));
    // model_reference intentionally lacks atom fields → atomMse should show "N/A" not "NaN"
    writeFixture(root, "spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json", JSON.stringify([
      {
        id: "s1", title: "s1", content: "",
        expected: { d1Policy: 50, d3Market: 50, d4Tech: 50, d5Business: 50, qualityScore: 50 },
        model_reference: { qualityScore: 50 }
      },
      {
        id: "s2", title: "s2", content: "",
        expected: { d1Policy: 70, d3Market: 70, d4Tech: 70, d5Business: 70, qualityScore: 70 },
        model_reference: { qualityScore: 70 }
      }
    ]));
    writeFixture(root, "spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl", [
      JSON.stringify({ id: "r1", rawText: "联系人 13812345678", expectedRedactions: [{ type: "PHONE", text: "13812345678" }], reviewer: "alice" }),
      JSON.stringify({ id: "r2", rawText: "安全文本", expectedRedactions: [], reviewer: "alice" })
    ].join("\n"));
    writeFixture(root, "spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json", JSON.stringify([
      backtestRow("b1", 10, 10, false), backtestRow("b2", 90, 90, true)
    ]));

    const report = evaluateM2Labels(root);
    const markdown = renderMarkdownReport(report);
    const scorerGate = report.classes.find((c) => c.className === "scorer")!.gate;

    // The detail string should not contain raw "NaN"
    expect(scorerGate.detail).not.toContain("NaN");
    expect(scorerGate.detail).toContain("N/A");
    expect(markdown).not.toMatch(/\bNaN\b/);
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
