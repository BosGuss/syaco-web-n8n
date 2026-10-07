# System Architecture & Technical Specifications

> **System Name:** SyaCo Content & Backlink Automation Stack (`n8n-sandbox`)  
> **Target Environment:** Docker Compose (Self-Hosted n8n + SearXNG + PostgreSQL 17 + Sandbox Service + Gemini API)  
> **Document Purpose:** System Overview, File Hierarchy, Container Specifications, and AI Workflow Pipeline Reference.

---

## 1. Directory Structure & File Inventory

```text
n8n-sandbox/
├── .env                     # Local environment variables (GEMINI_API_KEY, PostgreSQL, Webhooks) [GIT-IGNORED]
├── .env.example             # Git-safe environment template
├── .gitignore               # Secret protection & runtime data exclusions
├── compose.yml              # Docker Compose services definition (n8n, SearXNG, Postgres, Sandbox)
├── searxng-settings.yml     # SearXNG Engine configuration
├── init.sql                 # PostgreSQL initialization schema for backlink_candidates table
├── ARCHITECTURE.md          # System Architecture & AI Agent Reference (This File)
│
├── workflows/               # Git-tracked exported JSON workflow backups
│   ├── SyaCo Backlink Research v1.json
│   ├── SyaCo Backlink Research v2.json
│   └── SyaCo Solution-first Backlink Research v1.json
│
└── n8n_data/                # Local runtime data [GIT-IGNORED]
    ├── config               # Database encryption key file
    ├── database.sqlite      # Primary SQLite database (n8n internal workflows & credentials)
    ├── database.sqlite-shm  # Shared Memory file (WAL mode)
    ├── database.sqlite-wal  # Write-Ahead Log file
    ├── n8nEventLog.log      # n8n runtime logs
    └── storage/             # Binary data & file storage
```

---

## 2. Docker Compose Stack (`compose.yml`)

| Service Name | Docker Image | Port Mapping | Volume / Path | Role & Specifications |
|---|---|---|---|---|
| **`n8n`** | `docker.n8n.io/n8nio/n8n:latest` | `5678:5678` | `./n8n_data:/home/node/.n8n` | Automation Engine & SQLite DB Manager. Environment: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `GEMINI_MODEL`, `DISCORD_WEBHOOK_URL`, `BLUESKY_*`. |
| **`searxng`** | `searxng/searxng:latest` | `127.0.0.1:8081:8080` | `./searxng-settings.yml:/etc/searxng/settings.yml:ro` | Private Metasearch Engine. Handles web queries without external API costs. |
| **`postgres`** | `postgres:17-alpine` | `127.0.0.1:5433:5432` | `./pgdata:/var/lib/postgresql/data`, `./init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro` | Stores `backlink_candidates` table in `syaco_n8n_db` database for human review workflow, unique post deduplication & candidate statuses. |
| **`sandbox-api`** | `n8nio/n8n-sandbox-service-api:1.4.0` | `127.0.0.1:8080:8080` | `sandbox-tls:/tls:ro` | API Gateway for isolated code execution & n8n AI Assistant sandbox. |
| **`sandbox-runner-1`** | `n8nio/n8n-sandbox-service-runner-dind:1.4.0` | Internal gRPC | `sandbox-tls:/tls:ro` | Docker-in-Docker privileged runner executing user code securely. |
| **`sandbox-certs`** | `n8nio/n8n-sandbox-service-api:1.4.0` | N/A | `sandbox-tls:/tls` | One-shot init bootstrap container generating mTLS certificates for gRPC services. |

---

## 3. Database & Secret Security Specifications

- **n8n Internal Database:** SQLite 3 (`n8n_data/database.sqlite`) in WAL mode.
- **Candidate Store Database:** PostgreSQL 17 (`postgres:5433`, DB: `syaco_n8n_db`, Table: `backlink_candidates`).
- **Secret Protection Rules:**
  - `n8n_data/`, `pgdata/`, `.env`, `*.sqlite`, `*.log`, `*.py` MUST remain inside `.gitignore`.
  - **NEVER** commit `n8n_data/` or real credentials to Git repository.
  - Workflows MUST be exported as sanitized `.json` files inside `workflows/` directory for version control.

---

## 4. Main Workflow Architecture (`SyaCo Backlink Research v2`)

```text
[Trigger / Schedule]
        ↓
[Get SyaCo Solutions] ➔ (Fetches solutions from SyaCo API)
        ↓
[Split Solutions] & [Limit 1] ➔ (Trims raw HTML/metadata, keeping clean fields)
        ↓
[AI Generate Search Queries] ➔ (Gemini Cloud API generates 3-5 query strings)
        ↓
[SearXNG Search] ➔ (Metasearch for ~50 raw results)
        ↓
[Deduplicate Results] ➔ (Deduplicates unique URLs)
        ↓
[Top Candidates Filter] ➔ (Local Keyword Vector / Jaccard Similarity -> Top 5 candidates per solution)
        ↓
[AI Check Relevance] ➔ (Gemini Cloud API: Strict problem-based classifier HIGH/MEDIUM/LOW)
        ↓
[Relevant >= 0.80] (If Node)
        ↓
[AI Generate Answer] ➔ (Gemini Cloud API: Natural, non-promotional answer draft)
        ↓
[Save to PostgreSQL Candidate Store] ➔ (Inserts candidate into backlink_candidates table in syaco_n8n_db)
```
