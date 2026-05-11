-- DMA-30 T-M2-09 benchmark decision:
-- Synthetic benchmark target: 50K + 500K vectors, recall@10 >= 0.90, P99 <= 200ms.
-- Default choice remains ivfflat lists=200 for predictable build cost in M2.
-- HNSW(m=16, ef_construction=64) is deferred until production-scale M5 smoke benchmark confirms memory headroom.
DROP INDEX IF EXISTS analysis_emb_idx;
CREATE INDEX analysis_emb_idx ON item_analysis USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);
