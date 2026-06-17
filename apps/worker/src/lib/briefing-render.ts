import fs from "node:fs/promises";

import { eq } from "drizzle-orm";
import { Client as MinioClient } from "minio";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

import { briefingTemplateFields } from "@fe-radar/db";
import { BriefingRenderError } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BriefingPayload {
  /** YYYYMMDD, e.g. "20260520" */
  briefingDate: string;
  /** All template placeholder values keyed by placeholder_key */
  fields: Record<string, string>;
}

export interface RenderResult {
  docxPath: string;
  minioKey: string;
}

// ---------------------------------------------------------------------------
// Helpers — environment variable resolution
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new BriefingRenderError(
      "MISSING_ENV",
      `Required environment variable ${name} is not set`,
      { envVar: name }
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Template lint — scan all {{key}} placeholders in the docx text content
// and verify each is registered as is_active=true in briefing_template_fields.
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{([^{}]+?)\}\}/g;

function extractPlaceholders(content: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(content)) !== null) {
    // match[1] is the first capture group — always defined when regex matches
    keys.add((match[1] as string).trim());
  }
  return [...keys];
}

async function lintTemplate(
  zip: PizZip,
  db: DbClient
): Promise<void> {
  // Collect raw XML from all document parts
  const xmlContent: string[] = [];
  const files = zip.files;
  for (const filename of Object.keys(files)) {
    if (filename.endsWith(".xml")) {
      const entry = files[filename];
      if (entry) {
        xmlContent.push(entry.asText());
      }
    }
  }
  const combined = xmlContent.join("\n");
  const templateKeys = extractPlaceholders(combined);

  if (templateKeys.length === 0) {
    return; // No placeholders — nothing to lint
  }

  // Query all active registered keys
  const activeFields = await db
    .select({ placeholderKey: briefingTemplateFields.placeholderKey })
    .from(briefingTemplateFields)
    .where(eq(briefingTemplateFields.isActive, true));

  const registeredSet = new Set(activeFields.map((f) => f.placeholderKey));
  const missingKeys = templateKeys.filter((k) => !registeredSet.has(k));

  if (missingKeys.length > 0) {
    throw new BriefingRenderError(
      "TEMPLATE_LINT_MISSING_PLACEHOLDER",
      `Template contains unregistered placeholder(s): ${missingKeys.join(", ")}`,
      { keys: missingKeys }
    );
  }
}

// ---------------------------------------------------------------------------
// MinIO client factory (created fresh per call — stateless)
// ---------------------------------------------------------------------------

function createMinioClient(): MinioClient {
  const endpoint = process.env["MINIO_ENDPOINT"] ?? "minio";
  const port = parseInt(process.env["MINIO_PORT"] ?? "9000", 10);
  const useSSL = process.env["MINIO_USE_SSL"] === "true";
  const accessKey = process.env["MINIO_ACCESS_KEY"] ?? "";
  const secretKey = process.env["MINIO_SECRET_KEY"] ?? "";

  return new MinioClient({
    endPoint: endpoint,
    port,
    useSSL,
    accessKey,
    secretKey,
  }) as MinioClient;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function renderBriefing(
  payload: BriefingPayload,
  db: DbClient,
  minioClientOverride?: MinioClient
): Promise<RenderResult> {
  const templatePath = requireEnv("BRIEFING_TEMPLATE_PATH");
  const bucket = requireEnv("BRIEFING_MINIO_BUCKET");

  // Load template
  let templateBuffer: Buffer;
  try {
    templateBuffer = await fs.readFile(templatePath);
  } catch (cause) {
    throw new BriefingRenderError(
      "TEMPLATE_READ_FAILED",
      `Cannot read template at ${templatePath}`,
      { templatePath, cause }
    );
  }

  // Parse zip
  const zip = new PizZip(templateBuffer);

  // Lint before rendering
  await lintTemplate(zip, db);

  // Render with docxtemplater
  let docxBuffer: Buffer;
  try {
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{{", end: "}}" },
      // On unresolved tag: use fallback text "—" rather than throwing
      nullGetter: () => "—",
    });
    doc.render(payload.fields);
    docxBuffer = Buffer.from(doc.getZip().generate({ type: "nodebuffer" }));
  } catch (cause) {
    throw new BriefingRenderError(
      "TEMPLATE_RENDER_FAILED",
      `docxtemplater render failed for briefing date ${payload.briefingDate}`,
      { briefingDate: payload.briefingDate, cause }
    );
  }

  // Build object key: briefings/YYYY/MM/briefing-YYYYMMDD.docx
  const year = payload.briefingDate.slice(0, 4);
  const month = payload.briefingDate.slice(4, 6);
  const filename = `briefing-${payload.briefingDate}.docx`;
  const minioKey = `briefings/${year}/${month}/${filename}`;

  // Upload to MinIO
  const minio = minioClientOverride ?? createMinioClient();
  try {
    await minio.putObject(
      bucket,
      minioKey,
      docxBuffer,
      docxBuffer.length,
      {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }
    );
  } catch (cause) {
    throw new BriefingRenderError(
      "MINIO_UPLOAD_FAILED",
      `MinIO upload failed for key ${minioKey} in bucket ${bucket}`,
      { minioKey, bucket, cause }
    );
  }

  const docxPath = `${bucket}/${minioKey}`;
  return { docxPath, minioKey };
}
