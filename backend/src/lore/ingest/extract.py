"""Pull durable org facts out of a chat message with the fast model. Only explicit statements, only ids that exist."""

import json
import logging
import re

from falkordb import Graph

from lore import db, llm
from lore.config import settings

log = logging.getLogger(__name__)

# Cheap gate so ordinary chatter never costs an LLM call.
SIGNAL = re.compile(
    r"\b(own(s|ed|ership|er)?|mov(e|es|ing|ed)|tak(e|es|ing) over|hand(ing)? over|transfer|join(s|ing|ed)?|"
    r"switch(es|ing)? to|decid(e|ed|ing)|decision|agreed|going forward|from now on|effective|rule|policy|"
    r"never|always|must|deprecat|supersed|replac|instead of)\b",
    re.IGNORECASE,
)
MIN_CONFIDENCE = 0.7

PROMPT = """You maintain {org}'s engineering knowledge graph. Read one chat message and return the durable org facts
it explicitly states. Ignore questions, speculation, jokes, plans that are not agreed, and anything implied.

Fact types (use ONLY ids from the lists below):
- ownership_change: a service gets a new owning team. {{"type":"ownership_change","service":<service id>,
  "new_team":<team id>,"confidence":0-1}}
- membership_change: a person joins/moves to a team. {{"type":"membership_change","person":<person id>,
  "new_team":<team id>,"confidence":0-1}}
- decision: an agreed technical or process rule — how a system must behave or how changes to it are made.
  NOT staffing, on-call rotas, announcements or ownership moves (use ownership_change for those).
  {{"type":"decision","title":<short title>,"statement":<the rule, one or two sentences>,
  "governs":[<service ids and file paths it applies to>],"supersedes":<decision id or null>,"confidence":0-1}}

Emit each statement once, as the single most specific fact type.

Teams: {teams}
Services: {services}
People: {people}
Existing decisions mentioned: {decisions}

Return JSON: {{"facts": [...]}} — an empty list if nothing qualifies."""


def context(g: Graph, mentioned: list[dict]) -> dict:
    teams = db.rows(g, "MATCH (t:Team) RETURN t.id AS id, t.name AS name ORDER BY id")
    services = [r["id"] for r in db.rows(g, "MATCH (s:Service) RETURN s.id AS id ORDER BY id")]
    people = [f"{m['id']} ({m['name']})" for m in mentioned if m["label"] == "Person"]
    decisions = [f"{m['id']}: {m['name']}" for m in mentioned if m["label"] == "Decision"]
    return {
        "teams": ", ".join(f"{t['id']} ({t['name']})" for t in teams),
        "services": ", ".join(services),
        "people": ", ".join(people) or "none mentioned",
        "decisions": ", ".join(decisions) or "none",
    }


def parse(content: str) -> list[dict]:
    text = llm.clean(content)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return []
    try:
        facts = json.loads(match.group(0)).get("facts") or []
    except json.JSONDecodeError:
        return []
    return [f for f in facts if isinstance(f, dict) and float(f.get("confidence") or 0) >= MIN_CONFIDENCE]


async def extract(g: Graph, org: str, author: str, text: str, mentioned: list[dict]) -> list[dict]:
    if not SIGNAL.search(text) or not mentioned:
        return []
    ctx = context(g, mentioned)
    try:
        r = await llm.client().chat.completions.create(
            model=settings.fast_model,
            messages=[
                {"role": "system", "content": PROMPT.format(org=org, **ctx)},
                {"role": "user", "content": f"{author}: {text}"},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=3000,
        )
    except Exception:
        log.exception("fact extraction failed")
        return []
    return parse(r.choices[0].message.content or "")
