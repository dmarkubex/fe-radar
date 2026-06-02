/**
 * gen-briefing-template.ts — generate design/templates/briefing.docx
 *
 * The v1.1 commodity briefing docx template MUST be tracked in git (CLAUDE.md
 * trap #10 / T-CB-11): no runtime upload allowed. This script builds a minimal
 * but valid OOXML (.docx) whose {{placeholders}} exactly match the flat
 * `placeholder_key` rows seeded in packages/db/migrations/0009_commodity_seed.sql.
 *
 * Keeping the placeholder list here in sync with the seed is what makes
 * briefing-render.ts's lint pass (every {{key}} must be a registered, active
 * field) and lets apps/worker buildTemplateFields() values substitute.
 *
 * Usage:
 *   pnpm tsx scripts/gen-briefing-template.ts            # write the .docx
 *   pnpm tsx scripts/gen-briefing-template.ts --dry-run  # print keys only
 *
 * Re-run after editing the seed's briefing_template_fields. The output is
 * deterministic and idempotent.
 */
import fs from "node:fs";
import path from "node:path";

import PizZip from "pizzip";

// Sections mirror 0009_commodity_seed.sql briefing_template_fields ordering.
// [placeholder_key, human label]
const SECTIONS: { title: string; fields: [string, string][] }[] = [
  {
    title: "元信息",
    fields: [
      ["briefing_date", "简报日期"],
      ["template_version", "模板版本号"],
      ["generated_at", "生成时间"],
      ["report_disclaimer", "免责声明"],
    ],
  },
  {
    title: "沪铜 (SHFE 上期所)",
    fields: [
      ["cu_close", "收盘价"],
      ["cu_open", "开盘价"],
      ["cu_high", "最高价"],
      ["cu_low", "最低价"],
      ["cu_volume", "成交量"],
      ["cu_change_pct", "涨跌幅"],
      ["cu_warrants", "仓单"],
    ],
  },
  {
    title: "碳酸锂 (GFEX 广期所)",
    fields: [
      ["lc_close", "收盘价"],
      ["lc_open", "开盘价"],
      ["lc_high", "最高价"],
      ["lc_low", "最低价"],
      ["lc_volume", "成交量"],
      ["lc_change_pct", "涨跌幅"],
      ["lc_warrants", "仓单"],
    ],
  },
  {
    title: "LME 伦铜",
    fields: [
      ["lme_cu_close", "3M 结算价"],
      ["lme_cu_cash", "现货价"],
      ["lme_cu_change_pct", "涨跌幅"],
    ],
  },
  {
    title: "汇率 & 利率",
    fields: [
      ["fx_usdcny", "美元中间价"],
      ["fx_eurcny", "欧元中间价"],
      ["fx_hkdcny", "港元中间价"],
      ["cny_10y_yield", "10Y 国债收益率"],
      ["cny_5y_yield", "5Y 国债收益率"],
      ["cny_2y_yield", "2Y 国债收益率"],
    ],
  },
  {
    title: "铜现货价",
    fields: [
      ["cu_spot_smm", "SMM 铜现货均价"],
      ["cu_spot_100ppi", "生意社铜现货价"],
      ["cu_spot_cjsc", "长江有色铜现货价"],
    ],
  },
  {
    title: "碳酸锂现货价",
    fields: [["lc_spot_smm", "SMM 碳酸锂现货均价"]],
  },
  {
    title: "支撑位 / 压力位 (代码计算 · design.md §6.5)",
    fields: [
      ["cu_support", "沪铜支撑位"],
      ["cu_resistance", "沪铜压力位"],
      ["lc_support", "碳酸锂支撑位"],
      ["lc_resistance", "碳酸锂压力位"],
    ],
  },
  {
    title: "行情逻辑 (LLM 7 段 · design.md §6.1)",
    fields: [
      ["cu_logic_summary", "铜逻辑摘要"],
      ["cu_outlook_trend", "铜趋势判断"],
      ["lc_logic_summary", "碳酸锂逻辑摘要"],
      ["lc_outlook_trend", "碳酸锂趋势判断"],
      ["macro_summary", "宏观摘要"],
      ["risk_notes", "风险提示"],
      ["procurement_advice", "采购建议"],
    ],
  },
  {
    title: "新能源下游",
    fields: [["ev_sales_monthly", "新能源汽车月销量"]],
  },
  {
    title: "周边品种现货",
    fields: [
      ["al_spot_smm", "SMM 铝现货均价"],
      ["zn_spot_smm", "SMM 锌现货均价"],
    ],
  },
  {
    title: "近 5 日序列",
    fields: [
      ["cu_5d_series", "沪铜近 5 日收盘序列"],
      ["lc_5d_series", "碳酸锂近 5 日收盘序列"],
    ],
  },
  {
    title: "页脚",
    fields: [
      ["footer_date", "页脚日期"],
      ["footer_company", "出具机构"],
    ],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map(([k]) => k));

/** Escape text for inclusion in OOXML run text. */
function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A single WordprocessingML paragraph with optional bold. */
function para(text: string, bold = false): string {
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  // xml() escapes &<> while leaving {{placeholder}} braces intact.
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function buildDocumentXml(): string {
  const body: string[] = [];
  body.push(para("铜锂大宗商品 · 每日行情简报", true));
  body.push(para("{{briefing_date}} · 生成于 {{generated_at}}"));
  for (const section of SECTIONS) {
    body.push(para(`【${section.title}】`, true));
    for (const [key, label] of section.fields) {
      body.push(para(`${label}：{{${key}}}`));
    }
  }
  body.push(para("{{report_disclaimer}}"));
  body.push(para("{{footer_company}} · {{footer_date}}"));

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    body.join(""),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("");
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`briefing.docx template — ${ALL_KEYS.length} placeholder keys:`);
  for (const key of ALL_KEYS) console.log(`  {{${key}}}`);

  if (dryRun) return;

  const documentXml = buildDocumentXml();

  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);

  const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });

  const outDir = path.resolve(__dirname, "..", "design", "templates");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "briefing.docx");
  fs.writeFileSync(outPath, buffer);

  console.log(`\nWrote ${outPath} (${buffer.length} bytes)`);
}

main();
