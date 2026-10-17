"""Read-only graph tools. Each returns {data, evidence, sources, cypher} via Trace.result()."""

import re
from datetime import UTC, datetime

from falkordb import Graph

from lore.db import now_ms
from lore.embeddings import embed_query
from lore.tools.trace import Trace

DAY = 86_400_000
ACTIVITY_TAU_DAYS = 120.0
DOC_TAU_DAYS = 365.0
SOCIAL_RELS = {"COLLABORATES", "WORKS_CLOSELY"}
WEIGHTS = {"AUTHORED": 3.0, "REVIEWED": 1.5, "DISCUSSED": 1.0, "DOC": 2.0, "DECIDED": 3.0}


def _ms(at: str | None) -> int:
    if not at:
        return now_ms()
    dt = datetime.fromisoformat(at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp() * 1000)


def _iso(ms: int | None) -> str | None:
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="minutes") if ms else None


def _ago(ms: int) -> str:
    mins = (now_ms() - ms) / 60_000
    if mins < 90:
        return f"{mins:.0f} min ago"
    if mins < 60 * 36:
        return f"{mins / 60:.1f} h ago"
    return f"{mins / 1440:.0f} days ago"


def resolve(t: Trace, entity_id: str) -> str | None:
    """Forgiving id lookup: exact id, 'file:' prefix, PR/INC shorthands ('PR #482'), a file path or directory
    ('services/payments_api' -> its service), or an exact name."""
    raw = (entity_id or "").strip()
    norm = re.sub(r"^(PR|INC)\s*#?\s*(\d+)$", r"\1-\2", raw, flags=re.IGNORECASE).upper() if re.match(r"^(pr|inc)\s*#?\s*\d+$", raw, re.IGNORECASE) else raw
    candidates = [norm, f"file:{norm}", norm.removeprefix("file:")]
    r = t.q("MATCH (n:Entity) WHERE n.id IN $c RETURN n.id AS id LIMIT 1", {"c": candidates}, highlight=False)
    if r:
        return r[0]["id"]
    path = norm.removeprefix("file:").rstrip("/")
    r = t.q(
        """
        OPTIONAL MATCH (f:File)-[:PART_OF]->(s:Service) WHERE f.path STARTS WITH $p
        OPTIONAL MATCH (n:Entity) WHERE toLower(n.name) = toLower($raw)
        RETURN coalesce(n.id, s.id) AS id LIMIT 1
        """,
        {"p": path + "/", "raw": raw},
        highlight=False,
    )
    return r[0]["id"] if r and r[0]["id"] else None


def _label(t: Trace, entity_id: str) -> str | None:
    r = t.q("MATCH (n:Entity {id: $id}) RETURN labels(n) AS labels", {"id": entity_id}, highlight=False)
    if not r:
        return None
    return next((l for l in r[0]["labels"] if l != "Entity"), None)


def _service_of(t: Trace, entity_id: str) -> str | None:
    """Resolve a File / PR / Service id to its service id."""
    r = t.q(
        """
        MATCH (n:Entity {id: $id})
        OPTIONAL MATCH (n)-[:PART_OF]->(s1:Service)
        OPTIONAL MATCH (n)-[:MODIFIES]->(s2:Service)
        RETURN CASE WHEN 'Service' IN labels(n) THEN n.id ELSE coalesce(s1.id, s2.id) END AS sid
        """,
        {"id": entity_id},
        highlight=False,
    )
    return r[0]["sid"] if r else None


def try_q(t: Trace, cypher: str, params: dict, **kw) -> list[dict]:
    """For queries that depend on an index that may not exist yet (e.g. an empty tenant graph)."""
    try:
        return t.q(cypher, params, **kw)
    except Exception:  # noqa: BLE001 — a missing index on an empty tenant graph means "no hits"
        return []


def _not_found(t: Trace, entity_id: str) -> dict:
    return t.result({"error": f"no entity with id {entity_id!r}. Use search_entities first."})


# --------------------------------------------------------------------------------------------
RRF_K = 60


def fuse(*ranked: list[dict]) -> list[dict]:
    """Reciprocal rank fusion of several ranked hit lists (by id); remembers which retrievers found each hit."""
    merged: dict[str, dict] = {}
    for hits in ranked:
        for rank, h in enumerate(hits):
            m = merged.setdefault(h["id"], {**h, "score": 0.0, "matched": []})
            m["score"] += 1.0 / (RRF_K + rank + 1)
            m["matched"].append(h["via"])
    out = sorted(merged.values(), key=lambda h: -h["score"])
    for h in out:
        h.pop("via", None)
        h["score"] = round(h["score"], 4)
    return out


async def search_entities(g: Graph, query: str, label: str | None = None, limit: int = 10) -> dict:
    """Find entities (people, services, files, PRs, docs, decisions, messages, incidents...) by free text.
    Hybrid: FalkorDB full-text index + vector (semantic) index, fused. Do NOT use this for ids you already have
    (PR-482, D-17, INC-203, file:...): pass them straight to the other tools, which accept ids, file paths and
    shorthands like 'PR #482'."""
    t = Trace(g)
    terms = [w for w in re.split(r"[^\w-]+", query) if len(w) > 1]
    text_hits, vector_hits = [], []
    if terms:
        text_hits = try_q(
            t,
            """
            CALL db.idx.fulltext.queryNodes('Entity', $q) YIELD node, score
            WHERE $label IS NULL OR $label IN labels(node)
            RETURN node.id AS id, [l IN labels(node) WHERE l <> 'Entity'][0] AS label,
                   coalesce(node.title, node.name) AS name, 'text' AS via
            ORDER BY score DESC LIMIT $limit
            """,
            {"q": " | ".join(terms), "label": label, "limit": limit * 2},
            highlight=False,
        )
    vector = await embed_query(query)
    if vector:
        vector_hits = try_q(
            t,
            """
            CALL db.idx.vector.queryNodes('Entity', 'embedding', $k, vecf32($v)) YIELD node, score
            WHERE $label IS NULL OR $label IN labels(node)
            RETURN node.id AS id, [l IN labels(node) WHERE l <> 'Entity'][0] AS label,
                   coalesce(node.title, node.name) AS name, 'semantic' AS via, score AS distance
            ORDER BY distance
            """,
            {"v": vector, "k": limit * 3, "label": label},
            highlight=False,
        )
    hits = fuse(text_hits, vector_hits)[:limit]
    if not hits:
        hits = t.q(
            """
            MATCH (n:Entity)
            WHERE ($label IS NULL OR $label IN labels(n)) AND
                  (toLower(n.id) CONTAINS toLower($q) OR toLower(coalesce(n.name, '')) CONTAINS toLower($q))
            RETURN n.id AS id, [l IN labels(n) WHERE l <> 'Entity'][0] AS label,
                   coalesce(n.title, n.name) AS name, 1.0 AS score, ['id'] AS matched
            LIMIT $limit
            """,
            {"q": query, "label": label, "limit": limit},
            highlight=False,
        )
    for h in hits:
        h.pop("distance", None)
    return t.result(hits)


def get_entity(g: Graph, entity_id: str) -> dict:
    """An entity's properties and its direct neighbourhood, grouped by relationship."""
    t = Trace(g)
    entity_id = resolve(t, entity_id) or entity_id
    node = t.q("MATCH (n:Entity {id: $id}) RETURN n", {"id": entity_id})
    if not node:
        return _not_found(t, entity_id)
    rels = t.q(
        """
        MATCH (n:Entity {id: $id})-[r]-(m:Entity)
        WHERE NOT type(r) IN ['COLLABORATES', 'WORKS_CLOSELY']
        RETURN type(r) AS rel, CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS dir,
               m.id AS id, [l IN labels(m) WHERE l <> 'Entity'][0] AS label, coalesce(m.title, m.name) AS name
        LIMIT 60
        """,
        {"id": entity_id},
        highlight=False,
    )
    neighbours: dict[str, list] = {}
    for r in rels:
        neighbours.setdefault(f"{r['dir']}:{r['rel']}", []).append({k: r[k] for k in ("id", "label", "name")})
    return t.result({"entity": node[0]["n"], "neighbours": neighbours})


def who_owns(g: Graph, entity_id: str, at: str | None = None) -> dict:
    """Owning team and its members for a service/file/PR, at a point in time (ISO date, default now),
    plus the full ownership history (ownership edges are versioned, never deleted)."""
    t = Trace(g)
    entity_id = resolve(t, entity_id) or entity_id
    sid = _service_of(t, entity_id)
    if not sid:
        return _not_found(t, entity_id)
    when = _ms(at)
    owner = t.q(
        """
        MATCH p = (team:Team)-[o:OWNS]->(s:Service {id: $sid})
        WHERE o.valid_from <= $at AND (o.valid_to IS NULL OR o.valid_to > $at)
        RETURN p, team.id AS team, team.name AS team_name, team.channel AS channel
        """,
        {"sid": sid, "at": when},
    )
    members = []
    if owner:
        members = t.q(
            """
            MATCH (p:Person)-[m:MEMBER_OF]->(:Team {id: $team})
            WHERE m.valid_from <= $at AND (m.valid_to IS NULL OR m.valid_to > $at)
            RETURN p.id AS id, p.name AS name, p.title AS title,
                   (p.ooo_from IS NOT NULL AND p.ooo_from <= $now AND p.ooo_to >= $now) AS out_of_office
            ORDER BY name
            """,
            {"team": owner[0]["team"], "at": when, "now": now_ms()},
            highlight=False,
        )
    history = t.q(
        """
        MATCH (team:Team)-[o:OWNS]->(s:Service {id: $sid})
        RETURN team.name AS team, o.valid_from AS since, o.valid_to AS until, o.source AS source
        ORDER BY since
        """,
        {"sid": sid},
        highlight=False,
    )
    return t.result({
        "service": sid,
        "as_of": _iso(when),
        "owner": {k: owner[0][k] for k in ("team", "team_name", "channel")} if owner else None,
        "members": members,
        "history": [
            {"team": h["team"], "since": _iso(h["since"]), "until": _iso(h["until"]) or "present", "source": h["source"]}
            for h in history
        ],
    })


def _expertise_rows(t: Trace, target_files: list[str], mention_ids: list[str], service_id: str | None) -> list[dict]:
    now = now_ms()
    p = {"files": target_files, "mentions": mention_ids, "sid": service_id, "now": now,
         "tau": ACTIVITY_TAU_DAYS * DAY, "dtau": DOC_TAU_DAYS * DAY}
    rows = t.q(
        """
        MATCH (f:File)<-[:TOUCHES]-(pr:PR)<-[r:AUTHORED|REVIEWED]-(p:Person)
        WHERE f.id IN $files
        WITH DISTINCT p, pr, type(r) AS kind
        RETURN p.id AS person, kind, count(pr) AS n, sum(exp(($now - pr.merged_at) / -$tau)) AS w
        """,
        p,
        highlight=False,
    )
    rows += t.q(
        """
        MATCH (x:Entity)<-[:MENTIONS]-(m:Message)<-[:AUTHORED]-(p:Person)
        WHERE x.id IN $mentions
        WITH DISTINCT p, m
        RETURN p.id AS person, 'DISCUSSED' AS kind, count(m) AS n, sum(exp(($now - m.ts) / -$tau)) AS w
        """,
        p,
        highlight=False,
    )
    if service_id:
        rows += t.q(
            """
            MATCH (s:Service {id: $sid})<-[:ABOUT]-(d:Doc)<-[:AUTHORED]-(p:Person)
            RETURN p.id AS person, 'DOC' AS kind, count(d) AS n, sum(exp(($now - d.ts) / -$dtau)) AS w
            """,
            p,
            highlight=False,
        )
    rows += t.q(
        """
        MATCH (x:Entity)<-[:GOVERNS]-(dec:Decision)<-[:DECIDED|APPROVED]-(p:Person)
        WHERE x.id IN $files OR x.id = $sid
        WITH DISTINCT p, dec
        RETURN p.id AS person, 'DECIDED' AS kind, count(dec) AS n, sum(exp(($now - dec.ts) / -$dtau)) AS w
        """,
        p,
        highlight=False,
    )
    return rows


def who_knows(g: Graph, entity_id: str, limit: int = 5) -> dict:
    """Rank people by expertise on a service or file, computed from the graph: authored and reviewed PRs,
    answers in Slack, docs and decisions, with recency decay. Flags anyone out of office."""
    t = Trace(g)
    entity_id = resolve(t, entity_id) or entity_id
    label = _label(t, entity_id)
    if not label:
        return _not_found(t, entity_id)
    sid = _service_of(t, entity_id)
    if label == "File":
        files, mentions = [entity_id], [entity_id]
    else:
        files = [r["id"] for r in t.q("MATCH (f:File)-[:PART_OF]->(:Service {id: $sid}) RETURN f.id AS id",
                                      {"sid": sid}, highlight=False)]
        mentions = files + [sid]
    scores: dict[str, dict] = {}
    for r in _expertise_rows(t, files, mentions, sid):
        s = scores.setdefault(r["person"], {"score": 0.0, "breakdown": {}})
        s["score"] += WEIGHTS[r["kind"]] * r["w"]
        s["breakdown"][r["kind"].lower()] = r["n"]
    if not scores:
        return t.result({"target": entity_id, "experts": []})
    ranked = sorted(scores.items(), key=lambda kv: -kv[1]["score"])[:limit]
    top = ranked[0][1]["score"] or 1.0
    ids = [pid for pid, _ in ranked]
    info = {
        r["id"]: r
        for r in t.q(
            """
            MATCH (p:Person)-[m:MEMBER_OF]->(team:Team)
            WHERE p.id IN $ids AND m.valid_to IS NULL
            RETURN p.id AS id, p.name AS name, p.title AS title, team.name AS team,
                   (p.ooo_from IS NOT NULL AND p.ooo_from <= $now AND p.ooo_to >= $now) AS ooo, p.ooo_to AS ooo_to
            """,
            {"ids": ids, "now": now_ms()},
            highlight=False,
        )
    }
    # Evidence: each expert's most recent contributions to the target.
    t.q(
        """
        MATCH path = (p:Person)-[:AUTHORED|REVIEWED]->(pr:PR)-[:TOUCHES]->(f:File)
        WHERE p.id IN $ids AND f.id IN $files
        WITH p, path, pr ORDER BY pr.merged_at DESC
        WITH p, collect(path)[0..2] AS paths
        UNWIND paths AS path
        RETURN path
        """,
        {"ids": ids, "files": files},
    )
    experts = []
    for pid, s in ranked:
        i = info.get(pid, {})
        experts.append({
            "id": pid,
            "name": i.get("name"),
            "title": i.get("title"),
            "team": i.get("team"),
            "score": round(s["score"] / top, 2),
            "evidence_counts": s["breakdown"],
            "available": not i.get("ooo"),
            "out_of_office_until": _iso(i.get("ooo_to")) if i.get("ooo") else None,
        })
    return t.result({"target": entity_id, "service": sid, "experts": experts})


def blast_radius(g: Graph, service_id: str, depth: int = 3) -> dict:
    """What breaks if this service breaks (upstream dependents) and what it relies on (downstream, via BFS)."""
    t = Trace(g)
    service_id = resolve(t, service_id) or service_id
    if _label(t, service_id) != "Service":
        return _not_found(t, service_id)
    depth = max(1, min(int(depth), 5))
    upstream = t.q(
        f"""
        MATCH path = (u:Service)-[:DEPENDS_ON*1..{depth}]->(s:Service {{id: $sid}})
        WITH u, min(length(path)) AS hops, collect(path)[0] AS path
        OPTIONAL MATCH (team:Team)-[o:OWNS]->(u) WHERE o.valid_to IS NULL
        RETURN u.id AS service, u.tier AS tier, hops, team.name AS owner, path
        ORDER BY hops, tier
        """,
        {"sid": service_id},
    )
    downstream = t.q(
        f"""
        MATCH (s:Service {{id: $sid}})
        CALL algo.bfs(s, {depth}, 'DEPENDS_ON') YIELD nodes
        UNWIND nodes AS d
        RETURN d.id AS service, d.tier AS tier
        """,
        {"sid": service_id},
        highlight=False,
    )
    return t.result({
        "service": service_id,
        "dependents": [{k: r[k] for k in ("service", "tier", "hops", "owner")} for r in upstream],
        "tier0_dependents": sorted({r["service"] for r in upstream if r["tier"] == 0}),
        "dependencies": [r for r in downstream if r["service"] != service_id],
    })


def recent_changes(g: Graph, service_id: str, hours: float = 24, include_dependencies: bool = True) -> dict:
    """Deploys to a service (and the services it depends on) in the last N hours, with the PRs shipped,
    who wrote/reviewed them, and risk flags: decision-governed files touched without the decision owners
    reviewing, authors new to the codebase, authors outside the owning team."""
    t = Trace(g)
    service_id = resolve(t, service_id) or service_id
    if _label(t, service_id) != "Service":
        return _not_found(t, service_id)
    since = now_ms() - int(hours * 3_600_000)
    depth = 2 if include_dependencies else 0
    changes = t.q(
        f"""
        MATCH dep = (s:Service {{id: $sid}})-[:DEPENDS_ON*0..{depth}]->(target:Service)
        WITH target, min(length(dep)) AS hops, collect(dep)[0] AS dep
        MATCH ship = (target)<-[:OF]-(d:Deploy)-[:SHIPPED]->(pr:PR)
        WHERE d.ts >= $since
        MATCH (author:Person)-[:AUTHORED]->(pr)
        OPTIONAL MATCH (rev:Person)-[:REVIEWED]->(pr)
        RETURN target.id AS service, hops, d.id AS deploy, d.ts AS deployed_at, pr.id AS pr, pr.title AS title,
               author.id AS author, author.joined AS author_joined, collect(DISTINCT rev.id) AS reviewers, dep, ship
        ORDER BY deployed_at DESC
        """,
        {"sid": service_id, "since": since},
    )
    out = []
    for c in changes:
        flags = []
        governed = t.q(
            """
            MATCH path = (pr:PR {id: $pr})-[:TOUCHES]->(f:File)<-[:GOVERNS]-(dec:Decision {status: 'active'})
            OPTIONAL MATCH (owner:Person)-[:DECIDED|APPROVED]->(dec)
            RETURN dec.id AS decision, dec.title AS title, f.path AS file, collect(DISTINCT owner.id) AS owners, path
            """,
            {"pr": c["pr"]},
        )
        for d in governed:
            if not set(d["owners"]) & set(c["reviewers"] + [c["author"]]):
                flags.append(f"touches {d['file']} governed by {d['decision']} ({d['title']}) "
                             f"but none of its owners ({', '.join(d['owners'])}) reviewed")
        if c["author_joined"] and now_ms() - c["author_joined"] < 60 * DAY:
            flags.append(f"author {c['author']} joined {(now_ms() - c['author_joined']) // DAY} days ago")
        team = t.q(
            """
            MATCH (p:Person {id: $a})-[m:MEMBER_OF]->(team:Team)-[o:OWNS]->(:Service {id: $svc})
            WHERE m.valid_to IS NULL AND o.valid_to IS NULL RETURN team.id AS team
            """,
            {"a": c["author"], "svc": c["service"]},
            highlight=False,
        )
        if not team:
            flags.append(f"author {c['author']} is not on the team that owns {c['service']}")
        out.append({
            "service": c["service"],
            "dependency_hops": c["hops"],
            "deploy": c["deploy"],
            "deployed": _ago(c["deployed_at"]),
            "pr": c["pr"],
            "title": c["title"],
            "author": c["author"],
            "reviewers": c["reviewers"],
            "governing_decisions": sorted({d["decision"] for d in governed}),
            "risk_flags": sorted(set(flags)),
        })
    return t.result({"service": service_id, "window_hours": hours, "changes": out})


def trace_decision(g: Graph, entity_id: str) -> dict:
    """Why is something the way it is? Finds the decisions governing a file/service/PR (or a decision id)
    and traces each back to its sources: ADR, Slack discussion, the incident that motivated it, who made it."""
    t = Trace(g)
    entity_id = resolve(t, entity_id) or entity_id
    label = _label(t, entity_id)
    if not label:
        return _not_found(t, entity_id)
    if label == "Decision":
        ids = [entity_id]
    else:
        ids = [r["id"] for r in t.q(
            """
            MATCH (n:Entity {id: $id})
            OPTIONAL MATCH (n)-[:TOUCHES]->(f:File)<-[:GOVERNS]-(d1:Decision)
            OPTIONAL MATCH (n)<-[:GOVERNS]-(d2:Decision)
            OPTIONAL MATCH (n)<-[:PART_OF]-(:File)<-[:GOVERNS]-(d3:Decision)
            OPTIONAL MATCH (n)-[:PART_OF]->(:Service)<-[:GOVERNS]-(d4:Decision)
            WITH collect(DISTINCT d1) + collect(DISTINCT d2) + collect(DISTINCT d3) + collect(DISTINCT d4) AS ds
            UNWIND ds AS d
            RETURN DISTINCT d.id AS id
            """,
            {"id": entity_id},
            highlight=False,
        ) if r["id"]]
    decisions = []
    for did in ids:
        d = t.q(
            """
            MATCH (d:Decision {id: $id})
            OPTIONAL MATCH by = (p:Person)-[:DECIDED]->(d)
            OPTIONAL MATCH ap = (a:Person)-[:APPROVED]->(d)
            OPTIONAL MATCH doc = (d)-[:RECORDED_IN]->(adr:Doc)
            OPTIONAL MATCH th = (d)-[:DISCUSSED_IN]->(thread:Thread)
            OPTIONAL MATCH inc = (d)-[:MOTIVATED_BY]->(i:Incident)
            OPTIONAL MATCH cause = (i)-[:CAUSED_BY]->(:PR)
            OPTIONAL MATCH pm = (i)-[:POSTMORTEM]->(:Doc)
            OPTIONAL MATCH gov = (d)-[:GOVERNS]->(:File)
            RETURN d.id AS id, d.title AS title, d.text AS statement, d.status AS status, d.ts AS ts,
                   collect(DISTINCT p.name) AS decided_by, collect(DISTINCT a.name) AS approved_by,
                   adr.id AS adr, adr.url AS adr_url, thread.id AS thread, thread.url AS thread_url,
                   i.id AS incident, i.title AS incident_title,
                   collect(DISTINCT by) + collect(DISTINCT ap) + collect(DISTINCT doc) + collect(DISTINCT th) +
                   collect(DISTINCT inc) + collect(DISTINCT cause) + collect(DISTINCT pm) + collect(DISTINCT gov) AS paths
            """,
            {"id": did},
        )
        if not d:
            continue
        d = d[0]
        quotes = []
        if d["thread"]:
            quotes = t.q(
                """
                MATCH (d:Decision {id: $did})<-[:DECIDED|APPROVED]-(p:Person)-[:AUTHORED]->(m:Message)
                      -[:IN_THREAD]->(:Thread {id: $tid})
                RETURN p.name AS who, m.text AS said, m.url AS url ORDER BY m.ts
                """,
                {"did": did, "tid": d["thread"]},
            )
        d.pop("paths")
        d["decided_at"] = _iso(d.pop("ts"))
        d["key_quotes"] = quotes
        decisions.append(d)
    decisions.sort(key=lambda d: d["decided_at"] or "", reverse=True)
    decisions.sort(key=lambda d: d["status"] != "active")
    return t.result({"target": entity_id, "decisions": decisions})


def explain_path(g: Graph, from_id: str, to_id: str, max_len: int = 6) -> dict:
    """Shortest connection between any two entities (ignoring direction) — 'how is X related to Y?'"""
    t = Trace(g)
    from_id = resolve(t, from_id) or from_id
    to_id = resolve(t, to_id) or to_id
    rel_types = [r["t"] for r in t.q("CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType AS t",
                                       highlight=False) if r["t"] not in SOCIAL_RELS]
    rows = t.q(
        """
        MATCH (a:Entity {id: $a}), (b:Entity {id: $b})
        CALL algo.SPpaths({sourceNode: a, targetNode: b, relTypes: $types, relDirection: 'both', maxLen: $len,
                           pathCount: 1})
        YIELD path
        RETURN path
        """,
        {"a": from_id, "b": to_id, "len": int(max_len), "types": rel_types},
    )
    if not rows:
        return t.result({"from": from_id, "to": to_id, "path": None})
    path = rows[0]["path"]
    steps = []
    for i, e in enumerate(path["edges"]):
        steps.append(f"{e['from']} -[{e['_type']}]-> {e['to']}")
    return t.result({"from": from_id, "to": to_id, "hops": len(path["edges"]), "steps": steps})


async def similar_incidents(g: Graph, service_id: str, symptoms: str | None = None, compare_pr: str | None = None,
                            limit: int = 5) -> dict:
    """Past incidents on this service or its dependencies, ranked by how similar their symptoms are to
    `symptoms` (vector embeddings), with root cause, fix, postmortem and runbooks. If compare_pr is given,
    reports which files that PR shares with each incident's causing PR."""
    t = Trace(g)
    service_id = resolve(t, service_id) or service_id
    compare_pr = (resolve(t, compare_pr) or compare_pr) if compare_pr else None
    if _label(t, service_id) != "Service":
        return _not_found(t, service_id)
    rows = t.q(
        """
        MATCH (s:Service {id: $sid})-[:DEPENDS_ON*0..2]->(x:Service)<-[:AFFECTS]-(i:Incident)
        WHERE i.status = 'resolved'
        WITH DISTINCT i
        OPTIONAL MATCH cause = (i)-[:CAUSED_BY]->(c:PR)
        OPTIONAL MATCH fix = (i)-[:RESOLVED_BY]->(:PR)
        OPTIONAL MATCH pm = (i)-[:POSTMORTEM]->(:Doc)
        OPTIONAL MATCH dec = (i)<-[:MOTIVATED_BY]-(:Decision)
        RETURN i.id AS id, i.title AS title, i.severity AS severity, i.ts AS ts, i.text AS symptoms, c.id AS caused_by,
               CASE WHEN $v IS NULL OR i.embedding IS NULL THEN null
                    ELSE 1 - vec.cosineDistance(i.embedding, vecf32($v)) END AS similarity,
               collect(DISTINCT cause) + collect(DISTINCT fix) + collect(DISTINCT pm) + collect(DISTINCT dec) AS paths
        ORDER BY ts DESC
        """,
        {"sid": service_id, "v": await embed_query(symptoms) if symptoms else None},
    )
    incidents = []
    for r in rows:
        fixes = t.q("MATCH (:Incident {id: $i})-[:RESOLVED_BY]->(p:PR) RETURN p.id AS id, p.title AS title",
                    {"i": r["id"]}, highlight=False)
        pm = t.q("MATCH (:Incident {id: $i})-[:POSTMORTEM]->(d:Doc) RETURN d.id AS id, d.text AS text",
                 {"i": r["id"]}, highlight=False)
        decs = t.q("MATCH (:Incident {id: $i})<-[:MOTIVATED_BY]-(d:Decision) RETURN d.id AS id, d.title AS title",
                   {"i": r["id"]}, highlight=False)
        shared = []
        if compare_pr and r["caused_by"]:
            shared = [x["path"] for x in t.q(
                """
                MATCH (:PR {id: $a})-[:TOUCHES]->(f:File)<-[:TOUCHES]-(:PR {id: $b})
                RETURN f.path AS path
                """,
                {"a": compare_pr, "b": r["caused_by"]},
            )]
        incidents.append({
            "id": r["id"], "title": r["title"], "severity": r["severity"], "when": _ago(r["ts"]),
            "symptoms": r["symptoms"], "caused_by": r["caused_by"], "resolved_by": fixes,
            "postmortem": pm[0] if pm else None, "led_to_decisions": decs,
            "symptom_similarity": round(r["similarity"], 3) if r["similarity"] is not None else None,
            "files_shared_with_compare_pr": shared,
        })
    incidents.sort(key=lambda i: (-len(i["files_shared_with_compare_pr"]), -(i["symptom_similarity"] or 0)))
    runbooks = t.q(
        """
        MATCH (s:Service {id: $sid})-[:DEPENDS_ON*0..2]->(x:Service)<-[:ABOUT]-(d:Doc {kind: 'runbook'})
        RETURN DISTINCT d.id AS id, d.title AS title, d.text AS text
        """,
        {"sid": service_id},
    )
    return t.result({"service": service_id, "incidents": incidents[:limit], "runbooks": runbooks})


def knowledge_hubs(g: Graph, limit: int = 10) -> dict:
    """People who bridge the org (betweenness centrality on the collaboration graph) — the ones whose
    absence would disconnect teams."""
    t = Trace(g)
    rows = t.q(
        """
        CALL algo.betweenness({nodeLabels: ['Person'], relationshipTypes: ['COLLABORATES']}) YIELD node, score
        MATCH (node)-[m:MEMBER_OF]->(team:Team) WHERE m.valid_to IS NULL
        RETURN node.id AS id, node.name AS name, team.name AS team, score
        ORDER BY score DESC LIMIT $limit
        """,
        {"limit": limit},
        highlight=False,
    )
    top = rows[0]["score"] if rows and rows[0]["score"] else 1
    for r in rows:
        r["score"] = round(r["score"] / top, 3)
    return t.result(rows)


def bus_factor(g: Graph, service_id: str | None = None, threshold: float = 0.5) -> dict:
    """How many people really know each service (recency-weighted authorship + reviews). Services that
    depend on one or two people are a risk — especially when those people are out of office."""
    t = Trace(g)
    rows = t.q(
        """
        MATCH (s:Service)<-[:MODIFIES]-(pr:PR)<-[r:AUTHORED|REVIEWED]-(p:Person)
        WHERE $sid IS NULL OR s.id = $sid
        WITH s, p, sum(CASE type(r) WHEN 'AUTHORED' THEN 3.0 ELSE 1.5 END * exp(($now - pr.merged_at) / -$tau)) AS w
        WITH s, collect({id: p.id, w: w, ooo: p.ooo_from IS NOT NULL AND p.ooo_from <= $now AND p.ooo_to >= $now}) AS ppl,
             max(w) AS top
        RETURN s.id AS service, s.tier AS tier,
               [x IN ppl WHERE x.w >= $th * top | x.id] AS experts,
               [x IN ppl WHERE x.w >= $th * top AND NOT x.ooo | x.id] AS available
        ORDER BY size(available), tier
        """,
        {"sid": service_id, "now": now_ms(), "tau": ACTIVITY_TAU_DAYS * DAY, "th": threshold},
        highlight=False,
    )
    for r in rows:
        r["bus_factor"] = len(r["experts"])
        r["available_now"] = len(r["available"])
    return t.result(rows)


def communities(g: Graph) -> dict:
    """Detect real working groups (label propagation on the collaboration graph) and compare them to the
    org chart: groups that span teams are hidden coordination; teams split across groups are silos."""
    t = Trace(g)
    rows = t.q(
        """
        CALL algo.labelPropagation({nodeLabels: ['Person'], relationshipTypes: ['WORKS_CLOSELY']})
        YIELD node, communityId
        MATCH (node)-[m:MEMBER_OF]->(team:Team) WHERE m.valid_to IS NULL
        RETURN communityId AS community, collect(node.name) AS members, collect(DISTINCT team.name) AS teams
        ORDER BY size(members) DESC
        """,
        highlight=False,
    )
    return t.result(rows)


def graph_schema(g: Graph) -> dict:
    """Labels, relationship types and how they connect — read this before writing raw Cypher."""
    t = Trace(g)
    labels = t.q("MATCH (n) UNWIND labels(n) AS l WITH l WHERE l <> 'Entity' RETURN l AS label, count(*) AS n "
                 "ORDER BY n DESC", highlight=False)
    rels = t.q(
        """
        MATCH (a)-[r]->(b)
        RETURN [l IN labels(a) WHERE l <> 'Entity'][0] AS from, type(r) AS rel,
               [l IN labels(b) WHERE l <> 'Entity'][0] AS to, count(*) AS n
        ORDER BY n DESC
        """,
        highlight=False,
    )
    return t.result({"labels": labels, "relationships": rels,
                     "notes": "Every node also has label Entity with unique `id`. Timestamps are epoch ms. "
                              "Versioned edges (OWNS, MEMBER_OF) have valid_from/valid_to; valid_to null = current."})


WRITE_RE = re.compile(r"\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|LOAD\s+CSV|FOREACH)\b", re.IGNORECASE)


def run_cypher(g: Graph, query: str, params: dict | None = None) -> dict:
    """Read-only Cypher escape hatch (executed with GRAPH.RO_QUERY and a timeout)."""
    t = Trace(g)
    if WRITE_RE.search(query):
        return t.result({"error": "run_cypher is read-only"})
    try:
        rows = t.q(query, params or {})
    except Exception as e:  # noqa: BLE001 — surface Cypher errors to the model so it can fix the query
        return t.result({"error": str(e)})
    return t.result(rows[:200])
