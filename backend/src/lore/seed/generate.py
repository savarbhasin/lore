import argparse
import json
import re
from pathlib import Path

from lore.seed import world as W

TEXT_DIR = Path(__file__).resolve().parent / "text"
FILLER_PATH = TEXT_DIR / "northwind_filler.json"
CONV_PATH = TEXT_DIR / "northwind_conversations.json"
CONV_DIR = TEXT_DIR / "conversations"
CHUNKS_DIR = TEXT_DIR / "chunks"
PROGRESS_DIR = TEXT_DIR / ".progress"

RESERVED = [
    ("pool-sizing", re.compile(r"pool\s*(size|sizing|exhaustion|exhausted|shrink|shrank|trim|reduce|cut|lower)", re.I)),
    ("pool-size-const", re.compile(r"POOL_SIZE|max_connections", re.I)),
    ("connection-count", re.compile(r"connection[\s-]+(count|pool|heavy|limit)", re.I)),
    ("rds-cost", re.compile(r"\bRDS\b|PgBouncer|pgbouncer", re.I)),
    ("cost-cutting-conn", re.compile(r"(cost.{0,40}connect|connect.{0,40}cost)", re.I)),
    ("idempotency", re.compile(r"idempoten", re.I)),
    ("double-charge", re.compile(r"double[\s-]*charg|charged\s+twice|duplicate\s+charg|charged\s+2x", re.I)),
    ("retry-storm", re.compile(r"retry\s*storm|retries?\s+without\s+bound|unbounded\s+retr|capture\s+retr|retr(y|ies|ied)\s+(on\s+)?(capture|psp)", re.I)),
    ("planted-pr", re.compile(r"\bPR[\-\s#]*(121|127|288|301|305|402|455|476|479|481|482)\b", re.I)),
    ("planted-inc", re.compile(r"\bINC[\-\s#]*(142|203|260|288|301)\b", re.I)),
    ("planted-decision", re.compile(r"(?<![A-Z])\bD[\-\s#]*(09|12|17|21|24|30)\b", re.I)),
    ("planted-adr", re.compile(r"\bADR[\-\s#]*(0?07|0?12|0?15|0?18|7|12|15|18)\b", re.I)),
    ("planted-doc", re.compile(r"\b(PM[\-\s#]*(142|203)|RB[\-\s#]*(0?7|11)|DD[\-\s#]*0?3)\b", re.I)),
    ("planted-ticket", re.compile(r"\b(PAY[\-\s#]*(88|131)|CHK[\-\s#]*77|PLAT[\-\s#]*311|GRW[\-\s#]*40)\b", re.I)),
    ("new-decision", re.compile(r"from now on|we always|must never|never (drop|go) below|requires? .*sign-?off|formally (agreed|decided)", re.I)),
    ("ownership-change", re.compile(r"ownership (moves?|changes?|transfers?|moving)|moves? to (team|growth|platform)|takes? ownership|new owner", re.I)),
]


def find_violations(text):
    return [name for name, pat in RESERVED if pat.search(text or "")]


def visible_texts(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "mentions":
                continue
            yield from visible_texts(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from visible_texts(v)
    elif isinstance(obj, str):
        yield obj


def scan_violations(data):
    hits = []
    for text in visible_texts(data):
        for name in find_violations(text):
            hits.append((name, text[:100]))
    return hits


def check_timeline(conversations):
    joined = {p[0]: p[4] for p in W.PEOPLE}
    problems = []
    for conv in conversations:
        days = conv["days_ago"]
        if days < 0:
            problems.append((conv.get("id", "?"), "future thread"))
        total_min = max((m["minutes_after"] for m in conv["messages"]), default=0)
        if days * 1440 - total_min < 0:
            problems.append((conv.get("id", "?"), "message in the future"))
        for m in conv["messages"]:
            author = m["author"]
            if author not in joined:
                problems.append((conv.get("id", "?"), f"unknown author {author}"))
            elif joined[author] <= days:
                problems.append((conv.get("id", "?"), f"{author} posted before joining"))
            if author == "priya" and days < 1.2:
                problems.append((conv.get("id", "?"), "priya posted while OOO"))
    return problems


def check_schema(conversations):
    problems = []
    seen = set()
    for conv in conversations:
        for field in ("channel", "title", "days_ago", "messages"):
            if field not in conv:
                problems.append((conv.get("id", "?"), f"missing {field}"))
        if conv.get("id"):
            if conv["id"] in seen:
                problems.append((conv["id"], "duplicate id"))
            seen.add(conv["id"])
        for m in conv.get("messages", []):
            for field in ("author", "minutes_after", "text"):
                if field not in m:
                    problems.append((conv.get("id", "?"), f"message missing {field}"))
            if not isinstance(m.get("mentions", []), list):
                problems.append((conv.get("id", "?"), "mentions not a list"))
    return problems


def load_merged_filler():
    merged = {"prs": {}, "tickets": {}, "threads": {}}
    prog = PROGRESS_DIR / "filler.json"
    if prog.exists():
        try:
            data = json.loads(prog.read_text())
            for k in merged:
                merged[k].update({str(k2): v for k2, v in data.get(k, {}).items()})
        except Exception:
            pass
    if CHUNKS_DIR.exists():
        for path in sorted(CHUNKS_DIR.glob("*.json")):
            try:
                data = json.loads(path.read_text())
            except Exception:
                continue
            for k in merged:
                merged[k].update({str(k2): v for k2, v in data.get(k, {}).items()})
    return merged


def load_merged_conversations():
    convs = []
    if CONV_DIR.exists():
        for path in sorted(CONV_DIR.glob("*.json")):
            try:
                data = json.loads(path.read_text())
            except Exception as e:
                print(f"  SKIP {path.name}: invalid JSON ({e})")
                continue
            items = data.get("conversations", []) if isinstance(data, dict) else []
            convs.extend(items)
    old = PROGRESS_DIR / "conversations.json"
    if old.exists() and not convs:
        try:
            data = json.loads(old.read_text())
            convs.extend(data.get("conversations", []))
        except Exception:
            pass
    renumbered = []
    for i, conv in enumerate(convs, 1):
        conv = dict(conv)
        conv["id"] = f"C{i:04d}"
        msgs = []
        for j, m in enumerate(conv.get("messages", [])):
            m = dict(m)
            m.pop("mid", None)
            msgs.append(m)
        conv["messages"] = msgs
        renumbered.append(conv)
    return renumbered


def merge():
    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    filler = load_merged_filler()
    FILLER_PATH.write_text(json.dumps(filler, indent=1))
    convs = load_merged_conversations()
    CONV_PATH.write_text(json.dumps({"conversations": convs}, indent=1))
    return filler, convs


def stats():
    filler = load_merged_filler()
    convs = load_merged_conversations()
    channels = {}
    for c in convs:
        channels[c["channel"]] = channels.get(c["channel"], 0) + 1
    return {
        "prs": len(filler["prs"]),
        "tickets": len(filler["tickets"]),
        "filler_threads": len(filler["threads"]),
        "conversations": len(convs),
        "messages": sum(len(c.get("messages", [])) for c in convs),
        "channels": channels,
    }


def validate():
    filler, convs = merge()
    violations = scan_violations(filler) + scan_violations({"conversations": convs})
    timeline = check_timeline(convs)
    schema = check_schema(convs)
    return {"violations": violations, "timeline": timeline, "schema": schema, **stats()}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--merge", action="store_true", help="merge chunks into final JSON files")
    args = ap.parse_args(argv)
    if args.merge:
        filler, convs = merge()
        print(json.dumps({"prs": len(filler["prs"]), "tickets": len(filler["tickets"]),
                          "threads": len(filler["threads"]), "conversations": len(convs),
                          "messages": sum(len(c["messages"]) for c in convs)}, indent=2))
        return
    result = validate()
    print(f"prs={result['prs']} tickets={result['tickets']} filler_threads={result['filler_threads']} "
          f"conversations={result['conversations']} messages={result['messages']}")
    print(f"violations={len(result['violations'])} timeline={len(result['timeline'])} schema={len(result['schema'])}")
    for v in result["violations"][:20]:
        print(f"  VIOLATION {v[0]}: {v[1]}")
    for t in result["timeline"][:20]:
        print(f"  TIMELINE {t[0]}: {t[1]}")
    for s in result["schema"][:20]:
        print(f"  SCHEMA {s[0]}: {s[1]}")
    print(json.dumps(result["channels"], indent=2))
