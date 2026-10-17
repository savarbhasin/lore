"""Acme Robotics: a small second tenant used to demonstrate per-tenant isolation."""

from lore.seed.build import DAY_MS, Dataset, file_id

GH = "https://github.com/acme-robotics/fleet"


def build(now_ms: int) -> Dataset:
    ds = Dataset(now=now_ms)

    def ago(days: float) -> int:
        return int(now_ms - days * DAY_MS)

    ds.node("Repo", "repo:fleet", name="acme-robotics/fleet", url=GH)
    for tid, name in [("team-fleet", "Fleet"), ("team-vision", "Vision")]:
        ds.node("Team", tid, name=name, channel=f"#{tid}")
    people = [("ada", "Ada Okafor", "team-fleet"), ("ben", "Ben Carter", "team-fleet"), ("cleo", "Cleo Park", "team-fleet"),
              ("dan", "Dan Ruiz", "team-vision"), ("eve", "Eve Adler", "team-vision"), ("finn", "Finn Lund", "team-vision")]
    for pid, name, team in people:
        ds.node("Person", pid, name=name, title="Engineer", handle=f"@{pid}", joined=ago(500))
        ds.edge("MEMBER_OF", pid, team, valid_from=ago(500))
    services = [("dispatch", "team-fleet", ["telemetry"], ["services/dispatch/planner.py"]),
                ("telemetry", "team-fleet", [], ["services/telemetry/ingest.py"]),
                ("perception", "team-vision", ["telemetry"], ["services/perception/detector.py"]),
                ("mapper", "team-vision", ["perception"], ["services/mapper/slam.py"])]
    for sid, team, deps, files in services:
        ds.node("Service", sid, name=sid, tier=0, text=f"Acme {sid} service")
        ds.edge("OWNS", team, sid, valid_from=ago(500))
        ds.edge("IN_REPO", sid, "repo:fleet")
        for f in files:
            ds.node("File", file_id(f), name=f, path=f, url=f"{GH}/blob/main/{f}")
            ds.edge("PART_OF", file_id(f), sid)
    for sid, _, deps, _ in services:
        for d in deps:
            ds.edge("DEPENDS_ON", sid, d)
    prs = [(11, "dispatch: smarter route batching", "ada", "ben", "dispatch", "services/dispatch/planner.py", 30),
           (12, "telemetry: compress frames", "cleo", "ada", "telemetry", "services/telemetry/ingest.py", 20),
           (13, "perception: new detector weights", "dan", "eve", "perception", "services/perception/detector.py", 10),
           (14, "mapper: loop closure fix", "finn", "dan", "mapper", "services/mapper/slam.py", 5)]
    for n, title, author, reviewer, sid, f, days in prs:
        pid = f"PR-{n}"
        ds.node("PR", pid, name=f"PR #{n}", number=n, title=title, state="merged", ts=ago(days + 1),
                merged_at=ago(days), url=f"{GH}/pull/{n}")
        ds.edge("AUTHORED", author, pid, ts=ago(days))
        ds.edge("REVIEWED", reviewer, pid, ts=ago(days))
        ds.edge("TOUCHES", pid, file_id(f))
        ds.edge("MODIFIES", pid, sid)
    ds.node("Decision", "D-1", name="D-1", title="Telemetry frames are compressed with zstd",
            text="All robot telemetry is zstd-compressed before upload to save LTE bandwidth.", status="active",
            ts=ago(20), url="https://wiki.acme.dev/decisions/D-1")
    ds.edge("DECIDED", "cleo", "D-1", ts=ago(20))
    ds.edge("GOVERNS", "D-1", file_id("services/telemetry/ingest.py"))
    ds.edge("GOVERNS", "D-1", "telemetry")
    return ds
