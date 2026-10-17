# Assumptions

Every assumption or judgment call made while building Lore goes here. If it turns out to be wrong, change it here and in the code.

Status:
- **Confirmed**: the user agreed explicitly.
- **Assumed**: our call, not yet confirmed.
- **Measured**: backed by a test or run.

## Product and scope

| # | Assumption | Status |
|---|---|---|
| P1 | Lore is one product entered in all three Graph Hacks tracks: agents that act on connected data, agent memory and coordination, and the company brain. | Confirmed |
| P2 | Lore targets engineering orgs, with incident response as the flagship flow, not a general-purpose company brain. | Assumed |
| P3 | The demo runs on a synthetic company (Northwind) with storylines planted so the demo is reliable. Live GitHub/Slack data shows the ingest is real. | Assumed |
| P4 | The event runs Oct 15–18 2026 and requires the "main FalkorDB implementation" to be new work done during the event. The user chose to start building on Oct 3 anyway, knowing the risk (option C). | Confirmed |
| P5 | Moonshots (Conway's Law detector, fleet sweep, what-if simulator, etc.) are out of scope. | Confirmed |
| P6 | Surfaces: web Ask page plus incident room, Slack bot, and Discord bot. Slack is the primary bot; Discord is a second adapter on the same core. | Assumed |
| P7 | Agents act through a sandbox: clone the repo, reproduce the bug, patch it, run the tests, open a PR. | Confirmed |
| P8 | Merges are never automated. Pushing, opening PRs and paging need human approval. PRs only go to repos we control. | Assumed |
| P9 | Auth/SSO, billing and an admin console are out of scope. | Assumed |

## Data

| # | Assumption | Status |
|---|---|---|
| D1 | Northwind is a payments company: 29 people, 6 teams, 24 services. The structure (who, when, which files) of ~340 PRs, 68 tickets and 120 Q&A threads is generated deterministically around the hand-written storylines in `world.py`. Their text, plus 688 extra conversations, comes from committed JSON (D9–D16). | Measured |
| D2 | Seed timestamps are relative to load time ("deployed 40 min ago" means 40 min before seeding). Re-run `lore seed` right before a demo, otherwise relative times drift. | Measured (drift seen: "1.7h ago") |
| D3 | Filler PRs are authored according to per-service affinity weights, so expertise comes out of the data rather than being hard-coded. Fixed random seed (7) so runs are reproducible. | Assumed |
| D4 | Acme Robotics is a deliberately tiny second tenant whose only job is the isolation demo. | Assumed |
| D5 | ~~Generated dummy data uses only glm-5p3-flash.~~ Superseded: the Muse Spark subagent writes seed text itself. glm-5p3-flash is only for runtime generation inside the app. | Confirmed (user) |
| D7 | Graph links point at the real repo. File nodes go to `blob/main/<path>`, which exists for all 55 files. The 13 planted PRs that exist as commits go to their commit URL, found from `git log` at seed time. Filler PRs (e.g. `/pull/200`) are fictional and their links 404. | Measured |
| D8 | `POST /api/seed` reseeds using the code already loaded in the API process, so after editing seed code you must restart the API or run `uv run lore seed`. | Measured |
| D6 | The graphs `social-demo` and `social-demo-test` in the local FalkorDB aren't ours; we leave them alone. | Assumed |

## Graph model

| # | Assumption | Status |
|---|---|---|
| G1 | One FalkorDB graph per tenant (`brain:{tenant}`) and per user (`mem:{tenant}:{user}`) gives the isolation we need. | Measured (isolation test) |
| G2 | Every brain node carries `:Entity` plus its type label, and `Entity.id` is unique per tenant. | Assumed |
| G3 | Timestamps are epoch-ms integers, because FalkorDB has no temporal arithmetic. | Measured |
| G4 | Only `OWNS` and `MEMBER_OF` are versioned (`valid_from`/`valid_to`). Other facts aren't versioned yet. | Assumed |
| G5 | Expertise is computed at query time with these weights: authored PR 3, review 1.5, Slack message 1, doc 2, decision 3. Recency decay is 120 days for activity and 365 days for docs/decisions. The weights are judgment calls, not tuned. | Assumed |
| G6 | "Available" means not out of office per the `ooo_from`/`ooo_to` person properties. There's no calendar, timezone or on-call data. | Assumed |
| G7 | `COLLABORATES` (reviews×2 + shared threads) drives betweenness. `WORKS_CLOSELY` (weight ≥ 4) drives community detection. The threshold of 4 was picked so communities match the teams. | Measured (threshold 3–4 recovers the teams) |
| G8 | Blackboard nodes (`Hypothesis`, `Finding`, `Action`, `Event`, `Answer`) don't carry `:Entity`, so they stay out of search. Incidents and Procedures do carry it. | Assumed |
| G9 | Procedures (procedural memory) are shared org-wide in the brain graph. Episodes and facts are private to each user's memory graph. | Assumed |

## Agents and LLM

| # | Assumption | Status |
|---|---|---|
| L1 | The LLM provider is Fireworks through the OpenAI-compatible API. The team has no Anthropic key. | Confirmed |
| L2 | Agent model `minimax-m3` was picked from a single-run bake-off. It got 3/3 correct in 13s; kimi-k3, glm-5p3 and qwen3p8-max were also 3/3 but slower; gpt-oss-120b got 1/3. One run per model is a weak signal. | Measured (n=1) |
| L3 | `glm-5p3-flash` always reasons before answering and needs ≥2k max_tokens, or it returns empty content. | Measured |
| L4 | Embeddings use `qwen3-embedding-8b` at 1024 dimensions, now wired in (see V1–V8). | Confirmed |
| L5 | Agents call tools over real MCP sessions (`mcp.Client` on an in-process `MCPServer`). That satisfies "tool selection via MCP". | Assumed |
| L6 | Tenant, agent name and user are bound when the server is created and hidden from the model, so a prompt can't redirect them. | Assumed |
| L7 | Ask answers must make at least one tool call, and every cited id must exist in the tenant graph. Otherwise the model is sent back up to 2 times. | Measured (fixed a hallucinated follow-up) |
| L8 | Incident team: one triage agent, up to 3 investigators in parallel, one responder, and one scribe on resolve. Step caps are 8–10 per agent. | Assumed |
| L9 | ~~Word overlap ≥ 2.~~ Superseded: a procedure matches when it applies to the alerted service or something it depends on, **and** its embedding similarity to the alert is ≥ 0.78 (V5). | Confirmed |
| L10 | Run 1 of the planted incident took 28 tool calls; run 2, with procedure P-1, took 15. The PRD target was ≥3× fewer, and we're at about 1.9×. | Measured |

## Approvals and actions

| # | Assumption | Status |
|---|---|---|
| A1 | Who can approve an action is decided by the graph: current members of the team that owns the service the evidence points to, plus the people who decided or approved a decision governing that evidence. | Assumed |
| A2 | Out-of-office people stay in the approver list; they just won't be paged. | Assumed |
| A3 | `open_pr` now really runs: approving it hands the task to the Lore agent with its sandbox. `page` and `post_message` stay "simulated" until Slack exists. | Assumed |

## API and infrastructure

| # | Assumption | Status |
|---|---|---|
| I1 | The API has no authentication, and the request body's `user` / `person_id` is trusted. This is fine for the demo, not production. Bots will map Slack/Discord identities to `person_id`. | Assumed |
| I2 | A single API process: the event bus is in memory. Incident events are also persisted to the graph, but per-tool-call stream events only exist in memory. | Assumed |
| I3 | CORS allows all origins (development). | Assumed |
| I4 | Local FalkorDB is the `falkordb/falkordb:latest` Docker image. FalkorDB Cloud is planned for the live deployment. | Assumed |
| I5 | Backend is Python 3.12 + FastAPI. Web is Next.js. | Assumed |
| I6 | ~~The sandbox starts as local Docker.~~ Superseded: the sandbox is **E2B** (see S1–S8). | Confirmed |
| I7 | The Northwind code repo lives at `graph-hack/northwind-platform/` as its own git repo, ignored by the parent repo. It's pushed to **github.com/savarbhasin/northwind-platform (private)**, default branch `main`. | Confirmed |
| I9 | Real PRs the Fixer opens will be numbered #1, #2… on GitHub, which doesn't match the graph's fictional numbering (#482). The graph will record the real number and URL on the PR node it creates. This is undecided. | Assumed |
| I10 | The repo is private, so source links only open for people with access (judges won't have it unless we make it public or invite them). | Assumed |
| I8 | The repo is being built by a Muse Spark 1.3 subagent through the OpenCode harness, because the OpenRouter harness is disabled in Traycer. | Assumed (user asked for OpenRouter) |

## Northwind code repo (`northwind-platform/`, built by the Muse Spark subagent, verified)

| # | Assumption | Status |
|---|---|---|
| N1 | Simulated Postgres query time is a fixed 0.05s (`asyncio.sleep` while holding an `asyncio.Semaphore(POOL_SIZE)`). | Assumed (subagent) |
| N2 | The load repro sends 64 concurrent captures through checkout → payments-api, each with a unique order_id so idempotency can't skip the DB wait. The p99 budget is 0.40s. | Measured: 0.83s at pool 4 (fails), ~0.1s at 32 and ~0.18s at 24 (pass) |
| N3 | The pool size before #288 was 16, hardcoded in pool.py, because world.py doesn't say. #301 moved it to `config.py` with an env override `PAYMENTS_POOL_SIZE`. | Assumed (subagent) |
| N4 | Commit dates approximate world.py's "merged N days ago" to the hour. Fractional precision is lost, and dates are fixed at build time, unlike the graph seed, which is relative to load time. | Assumed (subagent) |
| N5 | Filler commits #350 (catalog) and #421 (kafka) exist only in the repo, not in the graph seed. | Assumed (subagent) |
| N6 | `test_load.py` has existed since the initial import but is excluded from default runs (`addopts = -m "not load"`). That's why #482 passed CI. | Assumed (subagent) |
| N7 | Unit tests target HEAD behavior and may fail on intermediate historical commits (e.g. before #127). | Assumed (subagent) |
| N8 | The fix is one line: the `POOL_SIZE` default `"4"` → `"32"` in `services/payments_api/config.py` (or set `PAYMENTS_POOL_SIZE=32`). | Measured |
| N9 | Kabir's #482 left the ADR-012/D-17 warning in pool.py's docstring and just appended a PLAT-311 note, so the violation sits right next to the warning. | Assumed (subagent) |
| N10 | The repo uses a `main` branch, `uv` with Python 3.12, and pytest + pytest-asyncio in the `dev` dependency group. | Assumed (subagent) |

## Web app

| # | Assumption | Status |
|---|---|---|
| W1 | The web app runs on port 3000. FalkorDB Browser moves to host port 3001. | Assumed |
| W2 | The browser calls the Lore API directly at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`) with no Next.js proxy, relying on the API's open CORS. | Assumed |
| W3 | The evidence graph uses `react-force-graph-2d` rather than FalkorDB's Canvas web component, which is less proven for our needs. | Assumed |
| W4 | "Acting as" is a person picker with no login, so anyone can pick anyone. This matches assumption I1. | Assumed |
| W5 | Graph labels only appear on highlighted nodes and anchors (Service, Incident, Decision) until you zoom in. This keeps dense evidence graphs readable. | Assumed |
| W6 | After an API restart, the incident room rebuilds the timeline, board and findings graph from FalkorDB. The live tool-call feed and its per-call evidence only exist in memory, so they come back empty. | Assumed |
| W7 | Verified at 580px (the in-app browser) and 1440px (headless Chrome). Layouts in between were not checked. | Measured |
| W8 | The evidence graph is hidden by default. It opens from "View evidence graph" under an answer, or by clicking a citation chip, which also focuses that node. It shows as a side panel at ≥1024px and a full-screen overlay below that. | Assumed |
| W9 | The source list under each answer is gone because the inline citation chips already name every source. A source's title and link now live in the graph panel's node card. | Assumed |
| W10 | Switching company or person still starts a new conversation. The "+" button next to the composer does the same thing by hand. | Assumed |
| W11 | The incident room reads top to bottom in this order: what happened (the confirmed root cause), the actions waiting for approval, then the hypotheses. The agent team, tool calls and timeline go in a side rail. The evidence graph is hidden until opened, same as on the Ask page. | Assumed |
| W12 | The Approve and Reject buttons are disabled unless the "acting as" person is one of the approvers the graph computed. The server still enforces this on its own. | Assumed |

## Agent sandbox (E2B)

| # | Assumption | Status |
|---|---|---|
| S1 | There's no special-purpose Fixer. A single Lore agent has the graph tools plus sandbox tools (`run_command`, `read_file`, `write_file`) and decides for itself what to run. An approved `open_pr` action is just a task given to that same agent. | Confirmed (user) |
| S2 | One E2B sandbox per conversation session or incident, created on the first sandbox tool call, living 30 minutes (extended on each use). It uses E2B's default template, overridable with `LORE_E2B_TEMPLATE`. | Assumed |
| S3 | A GitHub token is passed into the sandbox (`GH_TOKEN`/`GITHUB_TOKEN`) and git is set up to use it, so the agent can clone the private repo, push and open PRs. This replaces the earlier "no secrets in the sandbox" idea. We assume a fine-grained token scoped to `savarbhasin/northwind-platform` only (Contents + Pull requests write), **not** the broad `gh` login token. | Assumed |
| S4 | The agent can run any command with open internet. The guardrails are prompt rules (never push to main, never merge, don't print secrets) plus the token's narrow scope. | Assumed |
| S5 | Step budgets: 30 tool-use steps for Ask, 40 for an incident task. | Assumed |
| S6 | Only the incident flow puts a human approval in front of opening a PR. On the Ask page or in a bot, if a user asks Lore to open a PR, it just does it. | Assumed — needs a decision |
| S7 | PRs the agent opens become `PR` nodes with id `GH-PR-<n>`, linked with `FIXES`, `REVERTS`, `TOUCHES` and `MODIFIES` edges. This only happens if the agent calls `record_pull_request`, which isn't enforced. | Assumed |
| S8 | If the sandbox can't start (no key, quota), the tool returns an error and the agent answers from the graph and says it couldn't check the code. | Measured |

## Slack bot

| # | Assumption | Status |
|---|---|---|
| K1 | The Slack bot runs inside the API process (started in FastAPI's lifespan) so it shares the in-memory event bus. Incidents opened on the web get a Slack card, and Slack approvals show up live in the web incident room. Running more than one API process would break this. | Assumed |
| K2 | Socket Mode, so no public URL is needed. The app is created from `slack-app-manifest.yml`, and one workspace is bound to one tenant (`LORE_SLACK_TENANT`, default northwind). | Assumed |
| K3 | Slack identity is linked on the graph `Person` node (`slack_id`), set with `/lore iam <person-id>` or auto-matched once from the Slack profile's email or real name. Unlinked users can ask questions (memory under `slack-<id>`) but can't approve anything. | Assumed |
| K4 | `/lore iam` lets anyone claim any person, the same trust model as the web "acting as" picker (I1, W4). Fine for a demo, not for production. | Assumed |
| K5 | Each Slack thread is one Lore session (`slack:{channel}:{thread_ts}`), so follow-ups in a thread keep context and reuse the same sandbox. | Assumed |
| K6 | Incident cards go to `#incidents` (`LORE_SLACK_INCIDENT_CHANNEL`). The card's location is stored on the Incident node (`slack_channel`, `slack_ts`) and re-rendered at most once per ~1.2s while events arrive. | Assumed |
| K7 | With Slack connected, the `page` action DMs the person if their Slack account is linked (otherwise it posts in the incident thread), and `post_message` posts to the named channel (falling back to the incident thread if the bot can't post there). `open_pr` still runs the Lore agent. | Assumed |
| K8 | Answers use Slack's `markdown` block, with citations turned into links to the cited PR/doc/commit and a link to the web evidence graph. | Assumed |
| K9 | ~~The bot ignores channel messages for now.~~ Superseded by live ingest (L-rows below): every channel message the bot can see goes into the graph. DMs are never ingested. | Confirmed |

## Live knowledge ingest (Slack, reusable for Discord)

| # | Assumption | Status |
|---|---|---|
| LI1 | Every human message in a channel the bot is in (public or private, not DMs) is stored as a `Message` in its `Thread`, `AUTHORED` by the linked person, and linked with `MENTIONS` to what it names. Messages from unlinked users keep only a display name. | Confirmed (user) |
| LI2 | Mentions are linked without an LLM: keyed ids (`PR-482`, `INC-203`, `D-17`, `ADR-012`, `PLAT-311`), `#482` / `PR 482`, `services/...` and `infra/...` paths, Slack `<@U…>` mentions, service ids, team ids or "Team X" phrases, person ids, and first names that are unique. Bare words like "checkout" or "ledger" mean the service, not the team. | Measured |
| LI3 | The LLM only runs when a message both mentions an entity and matches a signal keyword (owns/moves/decided/from now on/never/must/supersedes…), so ordinary chatter costs nothing. | Assumed |
| LI4 | Extraction uses the fast model (glm-5p3-flash) in JSON mode. It may only use ids from lists we give it, and facts below 0.7 confidence are dropped. The fact types are `ownership_change`, `membership_change` and `decision` (technical/process rules only, not staffing or on-call). | Assumed |
| LI5 | Changes are applied with history: the current `OWNS`/`MEMBER_OF` edge is closed (`valid_to`, `closed_by` = message id) and a new one opened (`source` = message id). A decision that supersedes another marks the old one `superseded` and adds a `SUPERSEDES` edge. Nothing is deleted. | Measured |
| LI6 | Anyone who posts in a channel can change ownership or record a decision. There's no review step; provenance (author + source message) is the safeguard. | Assumed |
| LI7 | Edited and deleted Slack messages aren't handled. The first version of a message wins. | Assumed |
| LI8 | Ingest is silent: no reply in Slack. Each ingest publishes a `knowledge` event on `/api/knowledge/stream` for the web UI. | Confirmed (user) |
| LI9 | New decision ids continue the existing numbering (`D-31`, …). Live thread/message ids look like `SLT-<channel>-<ts>` / `SLM-<channel>-<ts>`, or `APT`/`APM` for the API endpoint. | Assumed |
| LI10 | `POST /api/ingest/message` runs the same pipeline without Slack, for testing and other sources. | Assumed |

## Vector search (FalkorDB vector indexes)

| # | Assumption | Status |
|---|---|---|
| V1 | Embeddings are stored on the nodes themselves (`embedding` = `vecf32`). There are three HNSW cosine indexes: `Entity` (global search), `Incident` and `Procedure` (memory matching). | Measured |
| V2 | Embedded labels: Doc, Decision, Message, PR, Ticket, Incident, Procedure, Service. The text is `title or name — text`, capped at 4,000 chars. People, files, threads and deploys aren't embedded. | Assumed |
| V3 | `search_entities` is hybrid: full-text plus vector k-nearest-neighbour, merged with reciprocal rank fusion (k=60). Each hit says which retriever found it (`matched: text/semantic`). | Measured |
| V4 | `similar_incidents` filters candidates by graph structure first (resolved incidents on the service or its dependencies, up to 2 hops), then ranks by shared files with the suspect PR, then by embedding similarity (`1 - vec.cosineDistance`). | Measured |
| V5 | The procedure-match threshold is cosine similarity ≥ 0.78. Measured with plain Qwen3 query embeddings: the same failure mode scores 0.81–0.92, unrelated incidents ≤ 0.72. The instruction-prefixed queries Qwen3 recommends gave no better separation here, so we don't use them. | Measured |
| V6 | Vectors are cached in `backend/.cache/embeddings.sqlite`, keyed by model, dimensions and text hash. The first Northwind seed embeds 849 nodes in ~21s; re-seeds take ~2s. | Measured |
| V7 | Embedding happens after seeding, after each live ingest, after each Ask/agent run (e.g. a recorded PR) and after an incident is resolved (the incident plus its new procedure). Nodes created elsewhere stay unembedded until the next one of those. | Assumed |
| V8 | If the embedding API fails, search falls back to full-text only and matching treats similarity as 0. Nothing crashes. | Assumed |

## Monitoring webhooks → incidents

| # | Assumption | Status |
|---|---|---|
| M1 | `POST /api/webhooks/{sentry,grafana,alertmanager,datadog,generic}` accepts each tool's own payload and turns it into one internal alert shape. Sentry supports three formats: internal-integration event/issue alerts, metric alerts, and the legacy WebHooks plugin. Grafana and Alertmanager share one format. Datadog needs the custom payload template in `docs/alerting.md`. | Measured (with sample payloads, not a live Sentry account yet) |
| M2 | An alert maps to a service via, in order: a `service`/`app`/`component`/`job`/`project` tag or label (lowercased, `_`→`-`, suffixes like `-service`/`-api` stripped), then service ids mentioned in the title or text. Alerts that can't be mapped are ignored and the reason is returned. | Measured |
| M3 | Deduplication: if an alert with the same fingerprint fires again within 6h while its incident is still open, it's logged as `alert_refired` instead of opening a new incident. A "resolved" notification is logged as `monitor_recovered`; it does not auto-resolve the incident. | Measured |
| M4 | Severity mapping: Sentry fatal→SEV1, error→SEV2, warning/info→SEV3. Labels critical/page/high→SEV1, error→SEV2, warning→SEV3. Datadog P1–P2→SEV1, P3→SEV2, P4–P5→SEV3. | Assumed |
| M5 | Auth is a shared secret in the URL (`?token=` = `LORE_WEBHOOK_TOKEN`), because the providers sign requests differently. If it's unset, there's no check (local dev only). | Assumed |
| M6 | Until we deploy, monitoring tools reach the laptop through a free Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:8000`). | Assumed |
| M7 | The web form, Slack `/lore incident` and webhooks all go through `alerts.intake.start`. Slack registers an "incident opened" hook so every incident, whatever its source, gets a Slack card. The incident's `Alert` node keeps `source`, `url` (a link back to the Sentry issue, Grafana panel, etc.) and `fingerprint`. | Measured |
| M8 | `uv run lore sentry-error --service checkout` sends a real exception to Sentry (`SENTRY_DSN`), tagged with the service, to drive the real loop: error → Sentry issue → alert rule → webhook → Lore. | Assumed (no DSN yet) |

## Seed text (written by the Muse Spark subagent, verified)

| # | Assumption | Status |
|---|---|---|
| D9 | Seed text lives in committed JSON: `seed/text/northwind_filler.json` (340 PRs, 68 tickets, 120 Q&A threads) and `seed/text/northwind_conversations.json` (688 threads, 3,000 messages, 19 channels). The per-chunk source files are in `text/conversations/` and `text/chunks/`. `uv run lore check-text --merge` rebuilds the merged files. `build.py` falls back to templates if a file or entry is missing. Seeding makes no LLM calls. | Measured |
| D10 | Provenance: before the switch, glm-5p3-flash wrote 172 PRs, 68 tickets, 119 Q&A threads and 4 conversations. Muse Spark wrote the other 168 PRs, 1 Q&A thread and 684 conversations (2,984 messages) by hand. | Measured |
| D11 | Mix: team channels are mostly work; #random/#food/#pets/#music/#parties/#social/#wins mostly social. The subagent added #wins, #oncall and #frontend. Threads average ~4.4 messages, up to 16. | Measured |
| D12 | Each person has a fixed voice (e.g. Arjun/Tom/Oliver terse lowercase; Sofia/Zara/Inês emoji-heavy; Kabir/Dev/Raj eager with typos; leads formal). Seniors explain, new hires ask. | Assumed (subagent) |
| D13 | Reserved topics never appear in visible text: pool sizing/`POOL_SIZE`/connection counts/RDS cost, idempotency/double charges/retry storms, planted ids, new-decision language, ownership changes. The plain words "pool", "retry" and "connection" are allowed in code-grounded PR text so real symbols like `ConnectionPool` can be named. Verified with 0 hits by both the subagent's checker and an independent scan of 3,528 texts. | Measured |
| D14 | Timeline: nobody posts before joining (Kabir only in the last 42 days, plus "welcome" threads right after each hire); no technical posts from Priya while she's out of office; nothing in the future. Two subagent drafts were dropped for breaking the storyline: a "Chloe moves to Growth" announcement and a duplicate Priya-vacation thread. | Measured (checker) |
| D15 | Conversations never mention `pool.py` or pool sizing, so they can't shift expertise on the demo file. Work threads draw participants from AFFINITY + team. Demo facts re-verified after reseeding (who_knows pool.py, recent_changes, "customers charged twice"). | Measured |
| D16 | The graph grows to 5,108 nodes / 11,043 relationships, with 3,851 nodes embedded. Reseeding takes ~10s once embeddings are cached. | Measured |

## Lore World (3D, `/world`)

| # | Assumption | Status |
|---|---|---|
| X1 | The game is a new route, `/world` (there's a "World" tab in the nav). The Ask, Incidents and permalink pages are untouched. | Confirmed (user) |
| X2 | The world is generated from the graph, not hand-modelled. Each team (`/api/people` + `/api/services`) gets an HQ building on a ring around the plaza, its people stand in front, and its services are towers behind. Taller towers mean a lower (more critical) tier. Services with no owner go to a "Commons" district. | Assumed |
| X3 | Graphics come from react-three-fiber + drei + postprocessing (bloom, vignette, ACES tone mapping) using low-poly primitives. There are no downloaded models, textures or HDRIs, so it works offline and loads instantly. | Assumed |
| X4 | Voice input is push-to-talk (hold V or the mic button). The browser records with MediaRecorder and the API transcribes locally with Whisper (`faster-whisper`, model `base.en`, `LORE_STT_MODEL`), primed with the tenant's people and service names. This replaced Chrome's Web Speech API, which needs Google's cloud service and failed with "network" in the in-app browser. Lore answers aloud with neural TTS (see X11). | Measured (~0.4s per 4s clip on CPU) |
| X5 | You have to walk up to Lore (inside the plaza) to speak to it. The "Ask Lore: …" buttons on person/service cards work from anywhere. | Assumed |
| X6 | While Lore works, people and services in the evidence get light beams from Lore to their spot on the island. Every other node (PRs, decisions, docs, incidents…) floats as a glowing orb above the plaza, with edges drawn as lines. | Assumed |
| X7 | The first 6 people/services Lore cites in an answer become quests: a diamond marker, a light pillar, an entry in the quest log, and a ground arrow pointing to the nearest one. Walking within reach marks it found ("insights" counter). Progress lives only in memory for the session. | Assumed |
| X8 | Services in any unresolved incident show a red siren and beam, and a banner links to the incident room. Incidents are re-polled every 15s. | Assumed |
| X9 | The player is the "acting as" person, so they don't also stand in their team's district. Asks from the world use `surface: "world"` and their own session id. | Assumed |
| X10 | Verified in headless Chrome (Metal/ANGLE) at 1440×900: intro, walking, talking to Lore, a typed question with beams/orbs/quests, and night mode. Real mic and speaker output weren't testable headless. | Measured |
| X11 | Lore's voice is Microsoft Edge's online neural TTS via the `edge-tts` package (`POST /api/tts`). It needs no API key but is an unofficial endpoint. Each request costs about 2.5s of connection time, so answers are split into sentences and synthesized in parallel, then cached (256 entries). If it fails, the browser's built-in voice takes over. | Measured (≈2.3–3.4s per request) |
| X12 | Lore always speaks with `en-US-AvaMultilingualNeural`. Each person gets a stable voice picked by hashing their id over 15 English neural voices. The graph has no gender or accent data, so a voice may not match the real person. | Assumed |
| X13 | In the world, every question uses "voice mode" (`voice: true`). The agent gets extra rules: 2–4 spoken sentences, no lists or markdown, names instead of ids, but citations still in brackets. Brackets are shown as chips and stripped before speaking. | Assumed |
| X14 | NPCs answer as themselves (`POST /api/ask_person`) from a dossier built from their graph footprint: authored and reviewed PRs, decisions, docs, recent Slack messages, incidents, their team's services, OOO status. Their own memory graph adds facts and what they recently asked Lore. They get read-only graph tools plus `recall`. Each conversation is saved to the NPC's memory graph (session `npc:{asker}`), so they remember you. | Assumed |
| X15 | Persona answers don't have to cite, but any id they do cite must exist in the graph (same check as Lore). Persona answers are stored as `Answer` nodes with surface `world:npc:{person}` and no `ABOUT` edges. | Assumed |
| X16 | Each unresolved incident gets a walk-in war room on one of the clearings reserved between the paths. The room goes to the free clearing closest to its affected service. Walking inside opens the panel with no key press. Approve/Reject use the same graph-authorized `/api/actions/{id}/decide` as the web UI. | Assumed |
| X17 | Sandbox work is shown as a holographic terminal. For Lore it floats to the viewer's left of Lore; inside a war room it hangs over the holo table and shows what the executing agent runs. It streams the `sandbox_*` events (commands, output, exit codes), with light packets flying from the worker while a command runs. No `E2B_API_KEY` is set in `.env`, so right now it only shows "sandbox unavailable". | Measured |
| X18 | The provider sometimes drops the final `]` when an answer ends with a citation ("… [arjun"). `llm.clean` closes a trailing unclosed citation bracket for every agent. | Measured |
| X19 | `window.__loreWorld` (player, world, rooms) exists only in development, for scripted play-throughs. | Assumed |
| X20 | `window.__loreWorld.autopilot` (dev only) walks the player to a target with a follow-cam, so the demo video can film natural movement. It does nothing unless a script sets a target. | Assumed |
| X21 | Resetting demo data (`POST /api/seed`) now clears the event bus's replay history for that tenant's incidents. Incident ids restart after a reset, and a stale final `done` event from the old INC-302 was ending new streams instantly, so the incident room stopped updating live. | Measured (bug fixed) |
| X22 | Lore's grounding check now accepts an answer with no graph citations if Lore ran commands in its sandbox during that answer (it read files or ran code). The prompt tells it to say where such facts came from ("the README says…"). Before this, external content like a public repo's README could never pass, because it has no graph ids. | Measured |
| X23 | `E2B_API_KEY` is set in `.env`, so the sandbox runs for real (started in ~1.9s). `GITHUB_TOKEN` is still unset, so the private `savarbhasin/northwind-platform` repo can't be cloned; the demo summarizes the public FalkorDB README instead. | Measured |
