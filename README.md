# Lore

**The company brain, built on FalkorDB.** Lore turns your PRs, Slack threads, docs, decisions and incidents into one live knowledge graph, then puts agents on top of it. Ask it anything and every claim comes back cited. When an alert fires, an agent team investigates and proposes fixes that only the right owners can approve. It can run code in its own sandbox, live in Slack, and be walked around as a 3D world you talk to out loud.

## What it does

- **Cited answers.** "Why does payments-api keep its DB pool at 32, and who should I ask this week?" Lore traverses the graph (decision → incident → code → people), answers in a few lines, and cites every claim with a graph ID. A grounding check rejects any ID that isn't in the graph. Every answer has a permalink with the evidence subgraph and the Cypher it ran.
- **Incident response.** Fire an alert and an agent team (triage, three parallel investigators, responder) works the graph and finds the root cause. In the demo data it is a PR that shrank the payments pool below decision D-17. The responder proposes actions (page, open a fix PR, post an update). **Approvals are graph-authorized**: only the owning team and the owners of the decisions involved can approve, enforced on the server.
- **Memory that compounds.** After an incident, a scribe agent writes a `Procedure` node. Next time, vector matching on symptoms reuses it (our test incident went from 28 tool calls to 15). Each user also has a private memory graph.
- **Agents that act.** Lore has its own [E2B](https://e2b.dev) sandbox. It can clone repos, read and run code, and (once approved) open a fix PR, which is recorded back in the graph.
- **Slack bot.** Ask Lore in threads, approve incident actions, and every channel message is ingested into the graph (ownership changes and decisions are recorded with history). Socket Mode, so no public URL.
- **Lore World** (`/world`). The graph as a 3D island: teams are buildings, services are towers, people are real colleagues. Hold V and ask out loud (local Whisper), and Lore answers in a neural voice while evidence beams light up the island. Walk up to anyone and they answer as themselves from their own graph footprint and memory. Open incidents become walk-in war rooms where you approve actions in place.

## How FalkorDB is used

| Need | FalkorDB feature |
|---|---|
| Multi-hop "why / who / what changed" questions | Cypher over a graph of people, teams, services, PRs, deploys, tickets, threads, docs, decisions, incidents |
| Search by meaning, then expand | Full-text and vector indexes (1024-dim embeddings) in the same engine as the graph |
| "Who owned this in April?" | `OWNS` / `MEMBER_OF` edges with `valid_from` / `valid_to` |
| Bus factor, communities, blast radius, "how are X and Y connected?" | `algo.betweenness`, `algo.labelPropagation`, `algo.bfs`, `algo.SPpaths` |
| Agent coordination during incidents | `Hypothesis`, `Finding`, `Action`, `Event` nodes (a graph blackboard) |
| Reusing what worked | `Procedure` nodes + `vec.cosineDistance` |
| Tenant and user isolation | One graph per tenant (`brain:{tenant}`) and per user (`mem:{tenant}:{user}`) |

Tools are served over MCP with the tenant bound at connection time, so an agent can't read another company's graph.

## Architecture

```
backend/   FastAPI + agents (Python 3.12, uv)
  src/lore/
    tools/         graph tools exposed to agents (search, who_knows, trace_decision, blast_radius, ...)
    agents/        ask, incident team, NPC personas, approved-action tasks
    blackboard.py  incident hypotheses / findings / actions / approvals
    memory.py      per-user memory graphs
    mcp_server.py  tenant-bound MCP server
    sandbox.py     E2B sandbox tools for the agent
    ingest/        Slack/API message -> graph (mentions, ownership changes, decisions)
    slack/         Slack bot (Socket Mode)
    alerts/        Sentry / Grafana / Alertmanager / Datadog webhooks -> incidents
    stt.py tts.py  local Whisper speech-to-text, neural text-to-speech
    seed/          the Northwind and Acme demo companies
web/       Next.js 16 app: Ask, incident rooms, Lore World (react-three-fiber)
northwind-platform/   (git-ignored) the demo company's code repo used for sandbox demos
```

## Run it

Prerequisites: Docker, [uv](https://docs.astral.sh/uv/), Node 20+ with pnpm, and a [Fireworks](https://fireworks.ai) API key (LLM and embeddings).

```bash
# 1. FalkorDB (browser UI on :3001)
docker compose up -d

# 2. config
cp .env.example .env        # set FIREWORKS_API_KEY at minimum

# 3. backend (API on :8000)
cd backend
uv sync
uv run lore seed            # loads the Northwind demo company (~5k nodes) and embeds it
uv run lore-api

# 4. web (on :3000), in another terminal
cd web
pnpm install
pnpm dev
```

Open <http://localhost:3000>. Pick **Ask**, **Incidents** or **World** in the nav, and use the company and person pickers to act as someone else.

**Try this**
1. *Ask:* "Why does payments-api keep its DB pool at 32, and who should I ask this week?"
2. *Incidents:* click **Fire alert**, watch the agent team find the root cause, then try to approve as Maya (blocked) and as Arjun (allowed).
3. *World:* enter, walk to the glowing figure in the plaza, press **E**, and hold **V** to speak (or type).

### Optional integrations

| Feature | Set in `.env` |
|---|---|
| Sandbox (clone / read / run code) | `E2B_API_KEY` |
| Let the agent push branches and open PRs | `GITHUB_TOKEN` (fine-grained, scoped to the demo repo only) |
| Slack bot | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`; create the app from `slack-app-manifest.yml` |
| Monitoring alerts to incidents | `LORE_WEBHOOK_TOKEN` and point Sentry/Grafana/Datadog at `/api/webhooks/<source>` |

Voice notes: speech-to-text runs locally with `faster-whisper` (downloads a ~140 MB model on first use). Text-to-speech uses Microsoft Edge's online neural voices via `edge-tts`, so it needs internet and no key.

## Tests

```bash
cd backend && uv run pytest
```

## Notes

This is a hackathon project. The "acting as" picker has no login, so anyone can pick anyone; treat it as a demo of the authorization model, not production auth.
