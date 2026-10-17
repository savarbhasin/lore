"""Turn the Northwind world spec into nodes and edges, plus deterministic filler history."""

import json
import random
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from lore.seed import world as W

DAY_MS = 86_400_000
TEXT_DIR = Path(__file__).resolve().parent / "text"


def load_filler_text():
    path = TEXT_DIR / "northwind_filler.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def load_conversations():
    out = []
    path = TEXT_DIR / "northwind_conversations.json"
    if path.exists():
        try:
            data = json.loads(path.read_text())
            items = data.get("conversations", []) if isinstance(data, dict) else []
            out.extend(items)
        except Exception:
            pass
    return out


@dataclass
class Dataset:
    now: int
    nodes: list[dict] = field(default_factory=list)  # {label, id, props}
    edges: list[dict] = field(default_factory=list)  # {type, src, dst, props}
    _ids: set = field(default_factory=set)

    def node(self, label: str, id: str, **props):
        if id in self._ids:
            raise ValueError(f"duplicate node id {id}")
        self._ids.add(id)
        self.nodes.append({"label": label, "id": id, "props": {k: v for k, v in props.items() if v is not None}})

    def edge(self, type: str, src: str, dst: str, **props):
        self.edges.append({"type": type, "src": src, "dst": dst, "props": {k: v for k, v in props.items() if v is not None}})

    def has(self, id: str) -> bool:
        return id in self._ids


def file_id(path: str) -> str:
    return f"file:{path}"


def ref(token: str) -> str:
    """Map a mention token from the world spec to a node id."""
    if token.startswith(("services/", "infra/")):
        return file_id(token)
    return token


def commit_urls(github: str, repo_dir: str) -> dict[int, str]:
    """PR number -> commit URL for PRs that exist as real commits in the Northwind code repo ("... (#482)")."""
    path = Path(__file__).resolve().parents[4] / repo_dir
    if not (path / ".git").exists():
        return {}
    try:
        log = subprocess.run(["git", "-C", str(path), "log", "--format=%H %s"], capture_output=True, text=True,
                             check=True, timeout=10).stdout
    except (subprocess.SubprocessError, OSError):
        return {}
    out = {}
    for line in log.splitlines():
        sha, _, subject = line.partition(" ")
        m = re.search(r"\(#(\d+)\)\s*$", subject)
        if m:
            out[int(m.group(1))] = f"{github}/commit/{sha}"
    return out


def build(now_ms: int, seed: int = 7) -> Dataset:
    rng = random.Random(seed)
    ds = Dataset(now=now_ms)

    def ago(days: float) -> int:
        return int(now_ms - days * DAY_MS)

    gh, slack, wiki, jira = W.ORG["github"], W.ORG["slack"], W.ORG["wiki"], W.ORG["jira"]
    real_commits = commit_urls(gh, W.ORG["repo_dir"])
    people = {p[0]: p for p in W.PEOPLE}
    services = {s[0]: s for s in W.SERVICES}
    file_service = {f: s[0] for s in W.SERVICES for f in s[5]}

    # --- org -------------------------------------------------------------------------------
    ds.node("Repo", "repo:platform", name=gh.removeprefix("https://github.com/"), url=gh)
    for tid, name, channel in W.TEAMS:
        ds.node("Team", tid, name=name, channel=channel)
    for pid, name, title, team, joined in W.PEOPLE:
        ooo = W.OOO.get(pid)
        ds.node("Person", pid, name=name, title=title, handle=f"@{pid}", email=f"{pid}@northwind.dev",
                github=f"{pid}-nw", joined=ago(joined),
                ooo_from=ago(ooo[0]) if ooo else None, ooo_to=ago(ooo[1]) if ooo else None)
    history = {(p, t) for p, t, *_ in W.MEMBERSHIP_HISTORY}
    for pid, _, _, team, joined in W.PEOPLE:
        if (pid, team) not in history:
            ds.edge("MEMBER_OF", pid, team, valid_from=ago(joined))
    for pid, team, start, end in W.MEMBERSHIP_HISTORY:
        ds.edge("MEMBER_OF", pid, team, valid_from=ago(start), valid_to=ago(end) if end is not None else None)

    owned_history = {svc for _, svc, *_ in W.OWNERSHIP_HISTORY}
    for sid, team, tier, desc, deps, files in W.SERVICES:
        ds.node("Service", sid, name=sid, tier=tier, text=desc)
        ds.edge("IN_REPO", sid, "repo:platform")
        if sid not in owned_history:
            ds.edge("OWNS", team, sid, valid_from=ago(900))
        for path in files:
            ds.node("File", file_id(path), name=path, path=path, url=f"{gh}/blob/main/{path}")
            ds.edge("PART_OF", file_id(path), sid)
    for team, sid, start, end in W.OWNERSHIP_HISTORY:
        ds.edge("OWNS", team, sid, valid_from=ago(start), valid_to=ago(end) if end is not None else None,
                source="D-24")
    for sid, *_, deps, _files in W.SERVICES:
        for d in deps:
            ds.edge("DEPENDS_ON", sid, d)

    # --- pull requests & deploys -------------------------------------------------------------
    deploy_seq = [0]

    def add_pr(n, title, author, reviewers, service, files, merged_days, deployed_days, body=""):
        pid = f"PR-{n}"
        merged = ago(merged_days)
        ds.node("PR", pid, name=f"PR #{n}", number=n, title=title, text=body, state="merged",
                ts=merged - int(rng.uniform(2, 30) * 3_600_000), merged_at=merged, url=real_commits.get(n, f"{gh}/pull/{n}"))
        ds.edge("AUTHORED", author, pid, ts=merged)
        for r in reviewers:
            ds.edge("REVIEWED", r, pid, ts=merged - 600_000, verdict="approved")
        for f in files:
            ds.edge("TOUCHES", pid, file_id(f))
        ds.edge("MODIFIES", pid, service)
        if deployed_days is not None:
            deploy_seq[0] += 1
            did = f"DEP-{deploy_seq[0]:04d}"
            ds.node("Deploy", did, name=f"deploy {service} #{deploy_seq[0]}", env="prod", ts=ago(deployed_days),
                    sha=f"{rng.getrandbits(28):07x}", url=f"https://deploy.northwind.dev/{did}")
            ds.edge("OF", did, service)
            ds.edge("SHIPPED", did, pid)

    planted_numbers = {p["n"] for p in W.PLANTED_PRS}
    # Filler history: realistic authorship so expertise emerges from the graph rather than being hard-coded.
    weights = {s[0]: (4 if s[2] == 0 else 2 if s[2] == 1 else 1) for s in W.SERVICES}
    filler = []
    for _ in range(340):
        svc = rng.choices(list(weights), weights=list(weights.values()))[0]
        days = rng.uniform(1.6, 235)
        aff = W.AFFINITY.get(svc, {})
        candidates = [(p, w) for p, w in aff.items() if people[p][4] > days]
        if not candidates:
            team = services[svc][1]
            candidates = [(p[0], 1) for p in W.PEOPLE if p[3] == team and p[4] > days]
        author = rng.choices([c[0] for c in candidates], weights=[c[1] for c in candidates])[0]
        team = services[svc][1]
        pool = [p for p, _ in candidates if p != author] + [p[0] for p in W.PEOPLE
                                                            if p[3] == team and p[0] != author and p[4] > days]
        reviewers = sorted(set(rng.sample(pool, k=min(len(pool), rng.choice([1, 1, 2]))))) if pool else []
        files = rng.sample(services[svc][5], k=min(len(services[svc][5]), rng.choice([1, 1, 2])))
        title = f"{svc}: {rng.choice(W.FILLER_VERBS)} {rng.choice(W.FILLER_THINGS)}"
        filler.append((days, title, author, reviewers, svc, files))
    filler.sort(key=lambda x: -x[0])
    free_numbers = [n for n in range(130, 482) if n not in planted_numbers]
    pr_text = load_filler_text().get("prs", {})
    for (days, title, author, reviewers, svc, files), n in zip(filler, free_numbers[: len(filler)]):
        ov = pr_text.get(str(n), {})
        if ov.get("title"):
            title = ov["title"]
        add_pr(n, title, author, reviewers, svc, files, days, days - rng.uniform(0.02, 0.25),
               ov.get("body", ""))
    for p in W.PLANTED_PRS:
        add_pr(p["n"], p["title"], p["author"], p["reviewers"], p["service"], p["files"], p["merged"], p["deployed"],
               p["body"])

    # --- tickets -----------------------------------------------------------------------------
    prefix = {"team-checkout": "CHK", "team-payments": "PAY", "team-ledger": "LED", "team-platform": "PLAT",
              "team-growth": "GRW", "team-identity": "IDN"}
    for key, title, days, author, status, about, incident in W.TICKETS:
        ds.node("Ticket", key, name=key, title=title, status=status, ts=ago(days), url=f"{jira}/{key}")
        ds.edge("AUTHORED", author, key, ts=ago(days))
        for s in about:
            ds.edge("ABOUT", key, s)
    used = {t[0] for t in W.TICKETS}
    ticket_text = load_filler_text().get("tickets", {})
    for i in range(70):
        svc = rng.choice(list(services))
        team = services[svc][1]
        key = f"{prefix[team]}-{rng.randint(10, 400)}"
        if key in used:
            continue
        used.add(key)
        days = rng.uniform(2, 220)
        authors = [p[0] for p in W.PEOPLE if p[3] == team and p[4] > days] or [p[0] for p in W.PEOPLE if p[3] == team]
        title = f"{svc}: {rng.choice(W.FILLER_VERBS)} {rng.choice(W.FILLER_THINGS)}"
        ov = ticket_text.get(key, {})
        if ov.get("title"):
            title = ov["title"]
        ds.node("Ticket", key, name=key, title=title, text=ov.get("description"),
                status=rng.choice(["done", "done", "todo", "in_progress"]), ts=ago(days), url=f"{jira}/{key}")
        ds.edge("AUTHORED", rng.choice(authors), key, ts=ago(days))
        ds.edge("ABOUT", key, svc)
    for pr, ticket in [("PR-127", "PAY-88"), ("PR-301", "PAY-131"), ("PR-305", "CHK-77"), ("PR-482", "PLAT-311")]:
        ds.edge("IMPLEMENTS", pr, ticket)

    # --- docs, incidents, decisions ----------------------------------------------------------
    for did, kind, title, days, author, about, text in W.DOCS:
        ds.node("Doc", did, name=did, kind=kind, title=title, text=text, ts=ago(days), url=f"{wiki}/{kind}/{did}")
        ds.edge("AUTHORED", author, did, ts=ago(days))
        for s in about:
            ds.edge("ABOUT", did, s)

    for inc in W.INCIDENTS:
        start = ago(inc["days"])
        ds.node("Incident", inc["id"], name=inc["id"], title=inc["title"], severity=inc["severity"], status="resolved",
                ts=start, resolved_at=start + int(inc["duration_h"] * 3_600_000), text=inc["symptoms"],
                url=f"https://incidents.northwind.dev/{inc['id']}")
        for s in inc["affects"]:
            ds.edge("AFFECTS", inc["id"], s)
        if inc["caused_by"]:
            ds.edge("CAUSED_BY", inc["id"], inc["caused_by"])
        for pr in inc["resolved_by"]:
            ds.edge("RESOLVED_BY", inc["id"], pr)
        if inc["postmortem"]:
            ds.edge("POSTMORTEM", inc["id"], inc["postmortem"])
        ds.edge("COMMANDED", inc["commander"], inc["id"])
    for key, *_rest, incident in W.TICKETS:
        if incident:
            ds.edge("RELATES_TO", key, incident)

    # --- slack ------------------------------------------------------------------------------
    def add_thread(tid, channel, title, days, messages):
        start = ago(days)
        ds.node("Thread", tid, name=f"{channel}: {title}", channel=channel, title=title, ts=start,
                url=f"{slack}/{channel.strip('#')}/p{start}")
        for i, (author, minutes, text, mentions) in enumerate(messages):
            mid = f"{tid}-m{i}"
            ts = start + int(minutes * 60_000)
            ds.node("Message", mid, name=f"{author} in {channel}", text=text, ts=ts,
                    url=f"{slack}/{channel.strip('#')}/p{ts}")
            ds.edge("IN_THREAD", mid, tid)
            ds.edge("AUTHORED", author, mid, ts=ts)
            for m in mentions:
                if ds.has(ref(m)) or ref(m) in people:
                    ds.edge("MENTIONS", mid, ref(m))

    for t in W.THREADS:
        add_thread(*t)

    thread_text = load_filler_text().get("threads", {})
    for i in range(120):
        svc = rng.choices(list(weights), weights=list(weights.values()))[0]
        days = rng.uniform(1.6, 230)
        aff = {p: w for p, w in W.AFFINITY.get(svc, {}).items() if people[p][4] > days}
        if not aff:
            continue
        answerer = rng.choices(list(aff), weights=list(aff.values()))[0]
        asker = rng.choice([p[0] for p in W.PEOPLE if p[0] != answerer and p[4] > days])
        f = rng.choice(services[svc][5])
        thing = rng.choice(W.FILLER_THINGS)
        q = rng.choice(W.FILLER_QUESTIONS).format(svc=svc, symptom=rng.choice(W.FILLER_SYMPTOMS), thing=thing)
        a = rng.choice(W.FILLER_ANSWERS).format(thing=thing, file=f)
        team = services[svc][1]
        channel = next(c for t, _, c in W.TEAMS if t == team)
        msgs = [(asker, 0, q, [svc]), (answerer, rng.uniform(3, 90), a, [svc, f]),
                (asker, rng.uniform(95, 140), "Thanks, that helps!", [])]
        tid = f"T-q{i:03d}"
        ov = thread_text.get(tid)
        if ov:
            texts = list(ov)[:4]
            authors = [asker, answerer, asker, answerer]
            mentions_pool = [[svc], [svc, f], [], [svc]]
            gaps = [0, msgs[1][1] if len(msgs) > 1 else 30, msgs[2][1] if len(msgs) > 2 else 120, 150]
            msgs = [(authors[k], gaps[k], texts[k], mentions_pool[k]) for k in range(len(texts))]
        add_thread(tid, channel, (msgs[0][2] if isinstance(msgs[0][2], str) else q)[:60], days, msgs)

    for conv in load_conversations():
        try:
            msgs = [(m["author"], m["minutes_after"], m["text"], m.get("mentions", []))
                    for m in conv["messages"]]
        except (KeyError, TypeError):
            continue
        if msgs:
            add_thread(conv["id"], conv["channel"], conv["title"], conv["days_ago"], msgs)

    for d in W.DECISIONS:
        ds.node("Decision", d["id"], name=d["id"], title=d["title"], text=d["text"], status=d["status"],
                ts=ago(d["days"]), url=f"{wiki}/decisions/{d['id']}")
        for p in d["by"]:
            ds.edge("DECIDED", p, d["id"], ts=ago(d["days"]))
        for p in d["approved"]:
            ds.edge("APPROVED", p, d["id"], ts=ago(d["days"]))
        if d["doc"]:
            ds.edge("RECORDED_IN", d["id"], d["doc"])
        if d["thread"]:
            ds.edge("DISCUSSED_IN", d["id"], d["thread"])
        if d["motivated_by"]:
            ds.edge("MOTIVATED_BY", d["id"], d["motivated_by"])
        governed_services = set()
        for path in d["governs"]:
            ds.edge("GOVERNS", d["id"], file_id(path))
            governed_services.add(file_service[path])
        for s in sorted(governed_services):
            ds.edge("GOVERNS", d["id"], s)
    return ds
