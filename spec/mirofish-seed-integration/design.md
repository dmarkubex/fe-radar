# FE-Radar x MiroFish Seed Integration Design

Version: v0.1
Date: 2026-06-29
Owner: Codex

## Current Problem

MiroFish currently starts from uploaded files. FE-Radar items are mostly webpages already fetched, parsed, scored, summarized, and clustered by FE-Radar. Sending them to MiroFish as a synthetic upload works technically, but it hides the real integration contract and makes future automation hard to reason about.

## Design Decision

Use a first-class JSON seed contract:

- FE-Radar owns webpage acquisition, parsing, scoring, and context packaging.
- MiroFish owns project creation, ontology generation, graph build, simulation, and report generation.
- The handoff artifact is an inline text document plus structured metadata, not a URL and not raw HTML.

## FE-Radar Flow

1. User opens item detail.
2. FE-Radar checks the current role.
3. Editor/admin clicks "模拟预测".
4. Browser calls `POST /api/items/:id/mirofish`.
5. FE-Radar API loads item detail and builds:
   - `simulation_requirement`
   - one Markdown seed document
   - metadata for traceability
6. FE-Radar API calls MiroFish `POST /api/external/seed`.
7. FE-Radar returns:

```json
{
  "itemId": 42,
  "projectId": "proj_xxxx",
  "projectUrl": "http://mirofish.internal/process/proj_xxxx"
}
```

8. Browser navigates to `projectUrl`.

## MiroFish API Contract

Endpoint:

```http
POST /api/external/seed
Content-Type: application/json
```

Request:

```json
{
  "project_name": "FE-Radar #42 铜价波动带动线缆企业成本关注",
  "simulation_requirement": "基于 FE-Radar 情报条目...",
  "additional_context": "来源：FE-Radar 产业情报雷达...",
  "documents": [
    {
      "filename": "fe-radar-item-42.md",
      "content": "# FE-Radar 情报预测种子\n...",
      "mime_type": "text/markdown",
      "source_url": "https://example.com/item"
    }
  ],
  "metadata": {
    "source_system": "fe-radar",
    "item_id": 42,
    "source_name": "测试信源",
    "source_tier": "T1",
    "category": "原料",
    "top_circle": "C2"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "project_id": "proj_xxxx",
    "project_name": "FE-Radar #42 铜价波动带动线缆企业成本关注",
    "ontology": {
      "entity_types": [],
      "edge_types": []
    },
    "analysis_summary": "...",
    "files": [
      {
        "filename": "fe-radar-item-42.md",
        "size": 12345
      }
    ],
    "total_text_length": 12345
  }
}
```

Validation:

- `simulation_requirement` is required.
- `documents` must be a non-empty array.
- each document must include non-empty `content`.
- max documents: 8.
- max total text chars: 200000.

## Persistence

MiroFish stores inline documents as project files, with a generated safe saved filename. The original upstream filename remains in project metadata. The extracted-text file is the concatenation of preprocessed document text, matching the upload route's downstream expectations.

## Security And Deployment

Initial implementation assumes MiroFish is reachable only on an internal network. FE-Radar must call MiroFish from the server side using `MIROFISH_API_BASE_URL`. Browser navigation uses `MIROFISH_WEB_BASE_URL`.

The two projects do not need one Compose file. Deployment options:

- same Swarm overlay network and service DNS, e.g. `http://mirofish:5001`
- separate stacks joined to a shared external network
- internal reverse proxy URL, e.g. `http://mirofish.internal`

Future hardening can add an internal bearer token, but that is not required for the first local integration.

## Failure Mapping

FE-Radar:

- missing or disabled MiroFish config: `503 MIROFISH_NOT_CONFIGURED`
- MiroFish rejection/failure: `502 MIROFISH_CREATE_FAILED`

MiroFish:

- invalid JSON / missing fields: `400`
- ontology generation or persistence failure: `500`

## Rationale

This avoids three bad coupling patterns:

- fake file upload from FE-Radar implementation details
- MiroFish fetching arbitrary URLs and duplicating FE-Radar's compliance/fetch logic
- passing only URLs and losing FE-Radar's scoring, entity, and cluster context
