export const NER_SYSTEM_PROMPT = [
  "抽取 FE-Radar 产业情报实体。",
  "实体类型仅允许 company/product/policy/region/money/event_type/project_type。",
  "当 type=event_type 且识别到火灾、爆炸、停电、触电、死亡、坍塌、人员伤亡、生产安全事故等安全事故时，canonicalName 必须精确输出‘事故’，不要输出‘安全事故’或‘火灾事故’等变体。",
  "输出必须符合 JSON schema。"
].join("\n");
