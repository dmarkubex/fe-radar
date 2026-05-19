import { describe, expect, it, vi, afterEach } from "vitest";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

import { BriefingRenderError } from "@fe-radar/shared";
import { renderBriefing } from "../briefing-render";
import type { BriefingPayload } from "../briefing-render";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid .docx buffer with the given placeholder keys */
function buildDocxBuffer(placeholderKeys: string[]): Buffer {
  const zip = new PizZip();
  const body = placeholderKeys.map((k) => `{{${k}}}`).join(" ");
  const wordXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body>
</w:document>`;
  zip.file("word/document.xml", wordXml);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);
  return Buffer.from(zip.generate({ type: "nodebuffer" }));
}

/** Build a mock DB that returns the given active placeholder keys */
function buildMockDb(activeKeys: string[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(
    activeKeys.map((k) => ({ placeholderKey: k }))
  );
  return { select: vi.fn().mockReturnValue(chain) };
}

/** Build a mock MinIO client that succeeds */
function buildMockMinio(opts: { fail?: boolean } = {}) {
  return {
    putObject: opts.fail
      ? vi.fn().mockRejectedValue(new Error("connection refused"))
      : vi.fn().mockResolvedValue(undefined),
  };
}

const BASE_PAYLOAD: BriefingPayload = {
  briefingDate: "20260520",
  fields: { cu_price: "78520", lc_price: "87400" },
};

// ---------------------------------------------------------------------------
// Setup: mock fs.readFile so we don't need a real .docx on disk
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: { readFile: (...args: unknown[]) => mockReadFile(...args) },
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["BRIEFING_TEMPLATE_PATH"];
  delete process.env["BRIEFING_MINIO_BUCKET"];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderBriefing", () => {
  /**
   * Case 1: lint passes — all placeholders registered and active
   * → render succeeds and returns correct docxPath + minioKey
   */
  it("returns docxPath and minioKey when all placeholders are registered", async () => {
    process.env["BRIEFING_TEMPLATE_PATH"] = "/templates/briefing.docx";
    process.env["BRIEFING_MINIO_BUCKET"] = "fe-radar-briefings";

    const docxBuf = buildDocxBuffer(["cu_price", "lc_price"]);
    mockReadFile.mockResolvedValue(docxBuf);

    const db = buildMockDb(["cu_price", "lc_price"]);
    const minio = buildMockMinio();

    const result = await renderBriefing(BASE_PAYLOAD, db as never, minio as never);

    expect(result.minioKey).toBe("briefings/2026/05/briefing-20260520.docx");
    expect(result.docxPath).toBe(
      "fe-radar-briefings/briefings/2026/05/briefing-20260520.docx"
    );
    expect(minio.putObject).toHaveBeenCalledOnce();
  });

  /**
   * Case 2: lint fails — template contains an unregistered placeholder
   * → throw BriefingRenderError with code TEMPLATE_LINT_MISSING_PLACEHOLDER
   *    and details.keys containing the missing key(s)
   */
  it("throws TEMPLATE_LINT_MISSING_PLACEHOLDER when a placeholder is not in briefing_template_fields", async () => {
    process.env["BRIEFING_TEMPLATE_PATH"] = "/templates/briefing.docx";
    process.env["BRIEFING_MINIO_BUCKET"] = "fe-radar-briefings";

    // Template has "unknown_field" which is not in the DB
    const docxBuf = buildDocxBuffer(["cu_price", "unknown_field"]);
    mockReadFile.mockResolvedValue(docxBuf);

    // DB only knows cu_price
    const db = buildMockDb(["cu_price"]);
    const minio = buildMockMinio();

    const err = await renderBriefing(BASE_PAYLOAD, db as never, minio as never).catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(BriefingRenderError);
    expect((err as BriefingRenderError).code).toBe(
      "TEMPLATE_LINT_MISSING_PLACEHOLDER"
    );
    expect((err as BriefingRenderError).details).toMatchObject({
      keys: expect.arrayContaining(["unknown_field"]),
    });
    // MinIO must NOT be called when lint fails
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  /**
   * Case 3: BRIEFING_TEMPLATE_PATH env is not set
   * → throw BriefingRenderError with code MISSING_ENV
   */
  it("throws MISSING_ENV when BRIEFING_TEMPLATE_PATH is not set", async () => {
    // Do NOT set BRIEFING_TEMPLATE_PATH
    process.env["BRIEFING_MINIO_BUCKET"] = "fe-radar-briefings";

    const db = buildMockDb([]);
    const minio = buildMockMinio();

    await expect(
      renderBriefing(BASE_PAYLOAD, db as never, minio as never)
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BriefingRenderError &&
        e.code === "MISSING_ENV" &&
        (e.details as Record<string, string>)["envVar"] === "BRIEFING_TEMPLATE_PATH"
    );
  });

  /**
   * Case 4: MinIO upload fails
   * → throw BriefingRenderError with code MINIO_UPLOAD_FAILED
   */
  it("throws MINIO_UPLOAD_FAILED when MinIO putObject rejects", async () => {
    process.env["BRIEFING_TEMPLATE_PATH"] = "/templates/briefing.docx";
    process.env["BRIEFING_MINIO_BUCKET"] = "fe-radar-briefings";

    const docxBuf = buildDocxBuffer(["cu_price"]);
    mockReadFile.mockResolvedValue(docxBuf);

    const db = buildMockDb(["cu_price"]);
    const minio = buildMockMinio({ fail: true });

    await expect(
      renderBriefing(BASE_PAYLOAD, db as never, minio as never)
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BriefingRenderError && e.code === "MINIO_UPLOAD_FAILED"
    );
  });

  /**
   * Case 5: filename is always briefing-YYYYMMDD.docx
   * → regardless of payload, the generated file uses the exact naming convention
   */
  it("generates filename as briefing-YYYYMMDD.docx from payload.briefingDate", async () => {
    process.env["BRIEFING_TEMPLATE_PATH"] = "/templates/briefing.docx";
    process.env["BRIEFING_MINIO_BUCKET"] = "fe-radar-briefings";

    const docxBuf = buildDocxBuffer(["cu_price"]);
    mockReadFile.mockResolvedValue(docxBuf);

    const db = buildMockDb(["cu_price"]);
    const minio = buildMockMinio();

    const payload: BriefingPayload = {
      briefingDate: "20261231",
      fields: { cu_price: "80000" },
    };

    const result = await renderBriefing(payload, db as never, minio as never);

    expect(result.minioKey).toBe("briefings/2026/12/briefing-20261231.docx");
    // Verify putObject was called with exactly this key
    expect(minio.putObject).toHaveBeenCalledWith(
      "fe-radar-briefings",
      "briefings/2026/12/briefing-20261231.docx",
      expect.any(Buffer),
      expect.any(Number),
      expect.objectContaining({ "Content-Type": expect.stringContaining("wordprocessingml") })
    );
  });
});
