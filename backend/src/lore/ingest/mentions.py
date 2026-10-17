"""Link free text to graph entities without an LLM: ids, shorthands, service/team names, file paths, people."""

import re

from falkordb import Graph

from lore import db

KEYED = re.compile(r"\b(?:PR|INC|ADR|PM|RB|DD|D|[A-Z]{2,5})-\d+\b")
PR_REF = re.compile(r"(?:\bPR\s*#?|(?<![\w/])#)(\d{1,6})\b", re.IGNORECASE)
FILE_PATH = re.compile(r"\b(?:services|infra)/[\w./-]+\.\w+")
SLACK_USER = re.compile(r"<@([A-Z0-9]+)>")
WORD = re.compile(r"[A-Za-z][\w-]+")


def vocabulary(g: Graph) -> dict[str, str]:
    """lowercased name -> entity id for services, teams and unambiguous first names."""
    vocab: dict[str, str] = {}
    for r in db.rows(g, "MATCH (s:Service) RETURN s.id AS id"):
        vocab[r["id"].lower()] = r["id"]
    for r in db.rows(g, "MATCH (t:Team) RETURN t.id AS id, t.name AS name"):
        # "checkout"/"ledger" are services; a team is named as "Team Ledger" or by its id.
        vocab[f"team {r['name'].lower()}"] = r["id"]
        vocab[f"{r['name'].lower()} team"] = r["id"]
        vocab[r["id"].lower()] = r["id"]
        vocab.setdefault(r["name"].lower(), r["id"])
    first: dict[str, list[str]] = {}
    for r in db.rows(g, "MATCH (p:Person) RETURN p.id AS id, p.name AS name"):
        vocab[r["id"].lower()] = r["id"]
        first.setdefault(r["name"].split()[0].lower(), []).append(r["id"])
    for name, ids in first.items():
        if len(ids) == 1:
            vocab.setdefault(name, ids[0])
    return vocab


def candidates(text: str, vocab: dict[str, str]) -> list[str]:
    found = list(KEYED.findall(text))
    found += [f"PR-{n}" for n in PR_REF.findall(text)]
    found += [f"file:{p}" for p in FILE_PATH.findall(text)]
    lowered = text.lower()
    for word in WORD.findall(lowered):
        if word in vocab:
            found.append(vocab[word])
    for name, eid in vocab.items():
        if " " in name and name in lowered:  # multi-word team names
            found.append(eid)
    return list(dict.fromkeys(found))


def link(g: Graph, text: str, vocab: dict[str, str] | None = None) -> list[dict]:
    """Entities mentioned in `text` that actually exist in the graph (Slack <@U..> mentions included)."""
    ids = candidates(text, vocab if vocab is not None else vocabulary(g))
    slack_ids = SLACK_USER.findall(text)
    return db.rows(
        g,
        """
        MATCH (e:Entity)
        WHERE e.id IN $ids OR (e:Person AND e.slack_id IN $sids)
        RETURN e.id AS id, [l IN labels(e) WHERE l <> 'Entity'][0] AS label, coalesce(e.title, e.name) AS name
        """,
        {"ids": ids, "sids": slack_ids},
    )
