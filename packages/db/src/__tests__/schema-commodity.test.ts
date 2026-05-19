import { describe, expect, it } from "vitest";

import {
  briefingHolidays,
  briefingPushes,
  briefingTargets,
  briefingTemplateFields,
  commodityBriefings,
  commodityQuotes
} from "../schema-commodity";

describe("schema-commodity table objects", () => {
  it("commodity_quotes carries the v1.1 columns required by design §7.1", () => {
    expect(commodityQuotes).toBeDefined();
    expect(commodityQuotes.metricKey).toBeDefined();
    expect(commodityQuotes.value).toBeDefined();
    expect(commodityQuotes.observedAt).toBeDefined();
    expect(commodityQuotes.rawText).toBeDefined();
  });

  it("commodity_briefings exposes template_version (Plan-Fix v0.4 M1)", () => {
    expect(commodityBriefings).toBeDefined();
    expect(commodityBriefings.templateVersion).toBeDefined();
    expect(commodityBriefings.payloadJson).toBeDefined();
    expect(commodityBriefings.genStatus).toBeDefined();
  });

  it("briefing_targets exposes disabled_at for soft delete (Plan-Fix v0.4 M2)", () => {
    expect(briefingTargets).toBeDefined();
    expect(briefingTargets.disabledAt).toBeDefined();
    expect(briefingTargets.webhookUrl).toBeDefined();
    expect(briefingTargets.signSecret).toBeDefined();
  });

  it("briefing_pushes references briefing + target FKs", () => {
    expect(briefingPushes).toBeDefined();
    expect(briefingPushes.briefingId).toBeDefined();
    expect(briefingPushes.targetId).toBeDefined();
    expect(briefingPushes.pushStatus).toBeDefined();
  });

  it("briefing_holidays uses holiday_date as the primary key", () => {
    expect(briefingHolidays).toBeDefined();
    expect(briefingHolidays.holidayDate).toBeDefined();
    expect(briefingHolidays.name).toBeDefined();
  });

  it("briefing_template_fields maps placeholder_key to source_metric / llm_path", () => {
    expect(briefingTemplateFields).toBeDefined();
    expect(briefingTemplateFields.placeholderKey).toBeDefined();
    expect(briefingTemplateFields.sourceMetric).toBeDefined();
    expect(briefingTemplateFields.llmPath).toBeDefined();
    expect(briefingTemplateFields.fallbackText).toBeDefined();
  });
});
