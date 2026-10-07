# System Architecture & Technical Specifications

> **System Name:** SyaCo Content & Backlink Automation Stack (`n8n-sandbox`)  
> **Target Environment:** Docker Compose (Self-Hosted n8n + SearXNG + Sandbox Service + Gemini API)  
> **Document Purpose:** System Overview, File Hierarchy, Container Specifications, and AI Workflow Pipeline Reference.

---

## 1. Directory Structure & File Inventory

```text
n8n-sandbox/
├── .env                     # Local environment variables (GEMINI_API_KEY, Sandbox tokens) [GIT-IGNORED]
├── .env.example             # Git-safe environment template
├── .gitignore               # Secret protection & runtime data exclusions
├── compose.yml              # Docker Compose services definition (n8n, SearXNG, Sandbox)
├── searxng-settings.yml     # SearXNG Engine configuration
├── ARCHITECTURE.md          # System Architecture & AI Agent Reference (This File)
│
├── workflows/               # Git-tracked exported JSON workflow backups
│   ├── SyaCo Backlink Research v1.json
│   └── SyaCo Solution-first Backlink Research v1.json
│
└── n8n_data/                # Local runtime data [GIT-IGNORED]
    ├── config               # Database encryption key file
    ├── database.sqlite      # Primary SQLite database (Workflows, History, Credentials)
    ├── database.sqlite-shm  # Shared Memory file (WAL mode)
    ├── database.sqlite-wal  # Write-Ahead Log file
    ├── crash.journal        # Crash state journal
    ├── n8nEventLog.log      # n8n runtime logs
    ├── nodes/               # Custom nodes directory
    └── storage/             # Binary data & file storage
```

---

## 2. Docker Compose Stack (`compose.yml`)

| Service Name | Docker Image | Port Mapping | Volume / Path | Role & Specifications |
|---|---|---|---|---|
| **`n8n`** | `docker.n8n.io/n8nio/n8n:latest` | `5678:5678` | `./n8n_data:/home/node/.n8n` | Automation Engine & SQLite DB Manager. Environment: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` to access `$env.GEMINI_API_KEY`. |
| **`searxng`** | `searxng/searxng:latest` | `127.0.0.1:8081:8080` | `./searxng-settings.yml:/etc/searxng/settings.yml:ro` | Private Metasearch Engine. Handles web queries without external API costs or rate limits. |
| **`sandbox-api`** | `n8nio/n8n-sandbox-service-api:1.4.0` | `127.0.0.1:8080:8080` | `sandbox-tls:/tls:ro` | API Gateway for isolated JS/Python code execution & n8n AI Assistant sandbox. |
| **`sandbox-runner-1`** | `n8nio/n8n-sandbox-service-runner-dind:1.4.0` | Internal gRPC | `sandbox-tls:/tls:ro` | Docker-in-Docker privileged runner executing user code securely. |
| **`sandbox-certs`** | `n8nio/n8n-sandbox-service-api:1.4.0` | N/A | `sandbox-tls:/tls` | One-shot init bootstrap container generating mTLS certificates for gRPC services. |

---

## 3. Database & Secret Security Specifications

- **Database Engine:** SQLite 3 (`n8n_data/database.sqlite`) in WAL mode.
- **Encryption Key:** Stored in `n8n_data/config` (`encryptionKey`). Must match `database.sqlite` deployment key decryption.
- **Secret Protection Rules:**
  - `n8n_data/`, `.env`, `*.sqlite`, `*.log`, `*.py` MUST remain inside `.gitignore`.
  - **NEVER** commit `n8n_data/` to Git repository to avoid GitHub Secret Scanning block (`GH013`).
  - Workflows MUST be exported as sanitized `.json` files inside `workflows/` directory for version control.

---

## 4. Main Workflow Architecture (`SyaCo Solution-first Backlink Research v1`)

### 6-Step Single Responsibility Pipeline:

```text
[Trigger / Manual]
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
[Create Review Candidate] ➔ (Formats candidate object with status: "pending_review")
```

### Key Workflow Principles:
1. **Payload Reduction (Node 3 `Split Solutions`):** Filters out heavy nested HTML/content, keeping only clean fields: `id`, `titleEn`, `titleTh`, `descEn`, `descTh`, `url`. Reduces token payload by >90%.
2. **Local Similarity Pre-Filter (Node `Top Candidates Filter`):** Calculates term overlap and similarity locally (0 Token Cost) and selects **Top 5 candidates** per solution, reducing downstream Gemini API calls by >85%.
3. **Strict AI Relevance Classifier (Node `AI Check Relevance`):** Uses Gemini API (`gemini-3.8-flash`) with `responseMimeType: "application/json"` and `responseSchema` to classify relevance based on actual user problem/question.
4. **Separation of Link Intent (Node `AI Generate Answer`):** AI drafts natural responses addressing the problem first, returning `answer`, `linkIncluded`, `linkReason`, and `suggestedAnchor` separately.

---

## 5. Expression & Parameter Rules for n8n Nodes

- When configuring HTTP Request nodes with `specifyBody: "json"`:
  - Use native JS Object expressions directly: `={{ { "contents": [ ... ] } }}`.
  - **DO NOT** wrap expressions in `JSON.stringify(...)` as n8n automatically serializes native JS objects.
  - Avoid unescaped special unicode characters (e.g. use plain ASCII `2 to 4` instead of `2–4`).
