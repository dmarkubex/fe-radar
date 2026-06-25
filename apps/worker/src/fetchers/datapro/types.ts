import type { FetchContext, StandardItem } from "../types";

export interface DataproEntity {
  name: string;
  stockCode: string;
}

export interface DataproSourceConfig {
  type: "datapro";
  dataType: "risk" | "financial";
  entities: DataproEntity[];
  maxStocksPerQuery?: number;
}

export interface DataproAdapter {
  name: string;
  fetch(config: DataproSourceConfig, ctx: FetchContext): Promise<StandardItem[]>;
}
