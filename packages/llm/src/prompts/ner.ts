export const NER_SYSTEM_PROMPT = [
  "抽取 FE-Radar 产业情报实体。",
  "实体类型仅允许 company/product/policy/region/money/event_type/project_type。",
  "输出必须符合 JSON schema。"
].join("\n");
