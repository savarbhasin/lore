"""Apply extracted facts to the graph with history: versioned edges are closed and reopened, never overwritten,
and every change points back to the message that caused it."""

from falkordb import Graph

from lore import db


def team_name(g: Graph, team_id: str) -> str | None:
    r = db.rows(g, "MATCH (t:Team {id: $id}) RETURN t.name AS name", {"id": team_id})
    return r[0]["name"] if r else None


def ownership_change(g: Graph, fact: dict, source: dict) -> dict | None:
    service, team = fact.get("service"), fact.get("new_team")
    if not team_name(g, team) or not db.rows(g, "MATCH (s:Service {id: $id}) RETURN s.id", {"id": service}):
        return None
    current = db.rows(g, """
        MATCH (t:Team)-[o:OWNS]->(:Service {id: $s}) WHERE o.valid_to IS NULL RETURN t.id AS id, t.name AS name""",
                      {"s": service})
    if current and current[0]["id"] == team:
        return None
    db.write(g, """
        MATCH (:Team)-[o:OWNS]->(:Service {id: $s}) WHERE o.valid_to IS NULL
        SET o.valid_to = $ts, o.closed_by = $src""", {"s": service, "ts": source["ts"], "src": source["id"]})
    db.write(g, """
        MATCH (t:Team {id: $t}), (s:Service {id: $s})
        CREATE (t)-[:OWNS {valid_from: $ts, source: $src, confidence: $c}]->(s)""",
             {"t": team, "s": service, "ts": source["ts"], "src": source["id"], "c": float(fact.get("confidence", 1))})
    before = current[0]["name"] if current else "nobody"
    return {"kind": "ownership_change", "entity": service, "before": before, "after": team_name(g, team),
            "text": f"{service} ownership: {before} → {team_name(g, team)}"}


def membership_change(g: Graph, fact: dict, source: dict) -> dict | None:
    person, team = fact.get("person"), fact.get("new_team")
    if not team_name(g, team) or not db.rows(g, "MATCH (p:Person {id: $id}) RETURN p.id", {"id": person}):
        return None
    current = db.rows(g, """
        MATCH (:Person {id: $p})-[m:MEMBER_OF]->(t:Team) WHERE m.valid_to IS NULL RETURN t.id AS id, t.name AS name""",
                      {"p": person})
    if any(c["id"] == team for c in current):
        return None
    db.write(g, """
        MATCH (:Person {id: $p})-[m:MEMBER_OF]->(:Team) WHERE m.valid_to IS NULL
        SET m.valid_to = $ts, m.closed_by = $src""", {"p": person, "ts": source["ts"], "src": source["id"]})
    db.write(g, """
        MATCH (p:Person {id: $p}), (t:Team {id: $t})
        CREATE (p)-[:MEMBER_OF {valid_from: $ts, source: $src}]->(t)""",
             {"p": person, "t": team, "ts": source["ts"], "src": source["id"]})
    before = ", ".join(c["name"] for c in current) or "no team"
    return {"kind": "membership_change", "entity": person, "before": before, "after": team_name(g, team),
            "text": f"{person} moved: {before} → {team_name(g, team)}"}


def decision(g: Graph, fact: dict, source: dict) -> dict | None:
    statement = (fact.get("statement") or "").strip()
    if not statement:
        return None
    count = db.rows(g, "MATCH (d:Decision) RETURN count(d) AS n")[0]["n"]
    numbers = db.rows(g, "MATCH (d:Decision) RETURN max(toInteger(substring(d.id, 2))) AS n")[0]["n"] or count
    did = f"D-{numbers + 1}"
    db.write(g, """
        CREATE (d:Entity:Decision {id: $id, name: $id, title: $title, text: $text, status: 'active', ts: $ts,
                                   url: $url, source: $src})
        WITH d
        OPTIONAL MATCH (m:Message {id: $src})-[:IN_THREAD]->(t:Thread)
        FOREACH (_ IN CASE WHEN t IS NULL THEN [] ELSE [1] END | CREATE (d)-[:DISCUSSED_IN]->(t))
        WITH DISTINCT d
        OPTIONAL MATCH (p:Person {id: $author})
        FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | CREATE (p)-[:DECIDED {ts: $ts}]->(d))
        WITH DISTINCT d
        UNWIND (CASE WHEN size($governs) = 0 THEN [null] ELSE $governs END) AS gid
        OPTIONAL MATCH (x:Entity) WHERE x.id IN [gid, 'file:' + gid]
        FOREACH (_ IN CASE WHEN x IS NULL THEN [] ELSE [1] END | MERGE (d)-[:GOVERNS]->(x))
        """,
             {"id": did, "title": fact.get("title") or statement[:80], "text": statement, "ts": source["ts"],
              "url": source.get("url"), "src": source["id"], "author": source.get("author") or "",
              "governs": [str(x) for x in fact.get("governs") or []]})
    superseded = None
    old = fact.get("supersedes")
    if old and db.rows(g, "MATCH (d:Decision {id: $id}) RETURN d.id", {"id": old}):
        db.write(g, """
            MATCH (new:Decision {id: $new}), (old:Decision {id: $old})
            SET old.status = 'superseded', old.superseded_at = $ts
            CREATE (new)-[:SUPERSEDES {ts: $ts}]->(old)""", {"new": did, "old": old, "ts": source["ts"]})
        superseded = old
    text = f"new decision {did}: {statement}" + (f" (supersedes {superseded})" if superseded else "")
    return {"kind": "decision", "entity": did, "before": superseded, "after": did, "text": text}


APPLY = {"ownership_change": ownership_change, "membership_change": membership_change, "decision": decision}


def apply(g: Graph, facts: list[dict], source: dict) -> list[dict]:
    changes = []
    for fact in facts:
        fn = APPLY.get(fact.get("type", ""))
        change = fn(g, fact, source) if fn else None
        if change:
            change["source"] = source["id"]
            changes.append(change)
    return changes
