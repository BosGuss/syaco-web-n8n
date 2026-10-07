# System Architecture & Technical Specifications

> **System Name:** SyaCo Content & Backlink Automation Stack (`n8n-sandbox`)  
> **Target Environment:** Docker Compose (Self-Hosted n8n + SearXNG + Postgres + Sandbox Service + Gemini API + Discord + Bluesky)  
> **Document Purpose:** System Overview, File Hierarchy, Container Specifications, and AI Workflow Pipeline Reference.

---

## 1. Directory Structure & File Inventory

```text
n8n-sandbox/
├── .env                     # Local environment variables and secrets [GIT-IGNORED]
├── .env.example             # Git-safe environment template (keys only, no values)
├── .gitignore               # Secret protection & runtime data exclusions
├── compose.yml              # Docker Compose services (n8n, SearXNG, Postgres, Sandbox)
├── searxng-settings.yml     # SearXNG engine configuration (JSON format must be enabled)
├── ARCHITECTURE.md          # System Architecture & AI Agent Reference (This File)
│
├── db/
│   └── init.sql             # backlink_candidates table, run once by the postgres container
│
├── workflows/               # Git-tracked exported JSON workflow backups
│   ├── SyaCo Backlink Research v1.json   # Previous version (kept for reference)
│   ├── SyaCo Backlink Research v2.json   # Research + draft + save + Discord notification
│   └── SyaCo Backlink Review v1.json     # Review page, approve/reject, Bluesky posting
│
├── pgdata/                  # Postgres data directory [GIT-IGNORED]
└── n8n_data/                # Local runtime data [GIT-IGNORED]
    ├── config               # Database encryption key file
    ├── database.sqlite      # n8n SQLite database (Workflows, History, Credentials)
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
| **`n8n`** | `docker.n8n.io/n8nio/n8n:latest` | `5678:5678` | `./n8n_data:/home/node/.n8n` | Automation engine. Keeps its own SQLite DB. Needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` for `$env.*` and `WEBHOOK_URL` for the review links. |
| **`postgres`** | `postgres:17-alpine` | `127.0.0.1:5432:5432` | `./pgdata:/var/lib/postgresql/data`, `./db/init.sql` | Stores every discovered post and its review status (`backlink_candidates`). Used for de-duplication and the approval trail. |
| **`searxng`** | `searxng/searxng:latest` | `127.0.0.1:8081:8080` | `./searxng-settings.yml:/etc/searxng/settings.yml:ro` | Private metasearch engine. No external API cost. |
| **`sandbox-api`** | `n8nio/n8n-sandbox-service-api:1.4.0` | `127.0.0.1:8080:8080` | `sandbox-tls:/tls:ro` | API gateway for isolated code execution & n8n AI assistant sandbox. |
| **`sandbox-runner-1`** | `n8nio/n8n-sandbox-service-runner-dind:1.4.0` | Internal gRPC | `sandbox-tls:/tls:ro` | Docker-in-Docker privileged runner. |
| **`sandbox-certs`** | `n8nio/n8n-sandbox-service-api:1.4.0` | N/A | `sandbox-tls:/tls` | One-shot init container generating mTLS certificates. |

Environment variables read by n8n (`$env.*`): `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `DISCORD_WEBHOOK_URL`, `REVIEW_BASE_URL`, `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`. `WEBHOOK_URL` is read by n8n itself.

---

## 3. Database & Secret Security Specifications

- **n8n database:** SQLite 3 (`n8n_data/database.sqlite`) in WAL mode. Encryption key in `n8n_data/config`.
- **Backlink database:** Postgres 17, database `backlinks`, table `backlink_candidates` (see `db/init.sql`). Reached from n8n through a Postgres credential created in the n8n UI (host `postgres`).
- **Secret Protection Rules:**
  - `n8n_data/`, `pgdata/`, `.env`, `*.sqlite`, `*.log`, `*.py` MUST remain inside `.gitignore`.
  - **NEVER** commit `n8n_data/` to Git to avoid GitHub Secret Scanning block (`GH013`).
  - Workflows MUST be exported as sanitized `.json` files inside `workflows/` for version control. Do not export with credentials.
  - Use a Bluesky **App Password**, never the account password.
- **Review links:** `/webhook/backlink-review?id=<id>&token=<token>`. The token is a random value stored in the row. Approve/reject is an atomic `UPDATE ... WHERE status = 'pending_review'`, so a link works once.

---

## 4. Workflow 1: `SyaCo Backlink Research v2`

Runs daily (and manually). Finds threads, drafts an answer, stores it and pings Discord. It never posts anything.

```text
[Daily Trigger / Manual Trigger]
        ↓
[Get SyaCo Solutions] → [Split Solutions] → [Prepare Queries] → [Limit Solution]   (Limit = test switch, raise or disable for production)
        ↓
[Build Query Request] → [AI Generate Search Queries]  (Gemini: 5 English queries per solution)
        ↓
[Parse Queries] → [Split Out Queries]                 (each query x site:reddit.com / dev.to / bsky.app)
        ↓
[SearXNG Search] → [Deduplicate Results]              (canonical thread URLs only, age filter per platform)
        ↓
[Load Seen URLs] (Postgres) → [Filter Unseen]         (drop every URL already stored)
        ↓
[Top Candidates Filter]                               (local similarity, Thai-aware, top 5 per solution)
        ↓
[Build Relevance Request] → [AI Check Relevance] → [Parse Relevance] → [Relevant >= 0.80]
        │ false                                             │ true
        ↓                                                   ↓
[Save Skipped] (status = skipped)      [Build Answer Request] → [AI Generate Answer] → [Create Review Candidate]
                                                            ↓
                                      [Save Candidate] (status = pending_review) → [Build Discord Message] → [Notify Discord]
```

Key principles:
1. **Solution data comes from the source, not from the LLM.** `Parse Queries` re-attaches the original solution object, so `titleTh`/`descTh` and string ids are never lost.
2. **Every Gemini request is built in a Code node** and passed to the HTTP node as `={{ $json.geminiBody }}` (native object, no `JSON.stringify`).
3. **Pairing by index with a length check.** Each Parse node reads its source items from the matching Build node and throws if the counts differ. HTTP nodes use `onError: continueRegularOutput` so the count never changes.
4. **AI failures are retried, not remembered.** If Gemini fails for an item, nothing is written for it. If it fails for all items the run stops with an error.
5. **Only answerable platforms are searched.** Results are reduced to thread URLs on reddit.com, dev.to and bsky.app. Everything else is dropped before any AI call.
6. **Disclosure and length are part of the prompt.** The answer must disclose the SyaCo affiliation when it contains the link, and must fit the platform limit (Bluesky 280, Reddit 1200, dev.to 1000 characters).
7. **The external post is treated as untrusted data** in both prompts.

---

## 5. Workflow 2: `SyaCo Backlink Review v1`

Must be **active** (production webhooks are only registered for active workflows).

| Entry | Path | What it does |
|---|---|---|
| `Review Page (GET)` | `/webhook/backlink-review` | Loads the candidate by `id` + `token`, renders an HTML page with an editable answer and Approve / Reject buttons. |
| `Review Submit (POST)` | `/webhook/backlink-review-submit` | Atomically claims the candidate (`pending_review` → `approved` / `manual` / `rejected`), saving the edited answer. |
| `Mark Posted (POST)` | `/webhook/backlink-mark-posted` | "I posted it" button for manual platforms (`manual` → `posted`). |

After approval:

```text
Claim Candidate → Claim OK? ──false──→ Page: Not Valid
                     │ true
                  Rejected? ──true──→ Page: Rejected
                     │ false
                  Is Bluesky? ──false──→ Page: Manual   (Reddit, dev.to: shows final text + thread link)
                     │ true
        Prepare Bluesky Post   (parse URL, 300-grapheme check, link facets)
                     ↓
        Create Bluesky Session → Resolve Actor DID → Get Parent Post → Build Reply Record
                     ↓
        Post to Bluesky → Evaluate Post Result → Posted OK? ─true─→ Mark Posted → Page: Posted
                                                      │ false (any failure above also lands here)
                                                      └────────→ Mark Failed → Page: Failed (shows the text for a manual reply)
```

Platform support:

| Platform | Discovery | Posting |
|---|---|---|
| Bluesky | SearXNG `site:bsky.app` | Automatic reply through the AT Protocol after approval |
| Reddit | SearXNG `site:reddit.com` | Manual (copy from the review result page). Reddit removes bot comments with brand links quickly. |
| dev.to | SearXNG `site:dev.to` | Manual. The API cannot create comments. |

---

## 6. Expression & Parameter Rules for n8n Nodes

- HTTP Request nodes with `specifyBody: "json"` use native objects: `={{ $json.geminiBody }}` or `={{ { "a": 1 } }}`. **Never** wrap in `JSON.stringify(...)`.
- Never write two closing braces next to each other inside an expression body (`}}` ends the expression). Build large bodies in a Code node instead.
- Avoid special unicode characters inside expression strings. Plain ASCII is safe; Code nodes are fine.
- Postgres nodes pass parameters as an array expression to `Query Parameters` (`$1`, `$2`, ...). Never concatenate values into the SQL.
- Do not rely on `$('Node').item` across Code nodes that create new items. Carry what you need in the item itself, or pair by index with a length check (see Workflow 1, principle 3).
- All HTML built for the review pages escapes every dynamic value and only links `http(s)` URLs.

---

## 7. Operating Notes

- First run: import both workflows, create the Postgres credential, set the env vars, activate **Review v1**, then run **Research v2** manually with `Limit Solution` at 1.
- If the review page loads but the buttons do nothing, your n8n version is sandboxing HTML webhook responses. Check the n8n docs for the setting that relaxes the webhook iframe sandbox.
- A Discord webhook cannot render interactive buttons, so the review link is a normal URL. `REVIEW_BASE_URL` must be reachable from the device you review on (phone needs a tunnel, not `localhost`).
- Keep volume low: at most a few posts per platform per day, and reply as a real person who discloses the SyaCo affiliation.
