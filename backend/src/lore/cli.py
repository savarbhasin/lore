import argparse
import asyncio
import inspect
import json
import sys

from lore import db


def cmd_seed(args):
    from lore.seed.tenant import seed

    stats = asyncio.run(seed(args.tenant))
    print(f"seeded {db.brain_key(args.tenant)}: {stats['nodes']} nodes, {stats['edges']} relationships, "
          f"{stats['embedded']} embedded")


def cmd_tool(args):
    from lore.tools import graph as G

    fn = getattr(G, args.name, None)
    if fn is None:
        sys.exit(f"unknown tool {args.name}")
    kwargs = json.loads(args.json or "{}")
    result = fn(db.brain(args.tenant), **kwargs)
    if inspect.iscoroutine(result):
        result = asyncio.run(result)
    if not args.full:
        result = {"data": result["data"], "sources": [s["url"] for s in result["sources"]]}
    print(json.dumps(result, indent=2, default=str))


def cmd_check_text(args):
    from lore.seed.generate import main as check_main

    check_main(["--merge"] if args.merge else [])


def cmd_sentry_error(args):
    """Raise a real error into Sentry, tagged with a Northwind service, to drive the alert -> incident loop."""
    import sentry_sdk

    from lore.config import settings

    if not settings.sentry_dsn:
        sys.exit("set SENTRY_DSN in graph-hack/.env (Sentry project -> Settings -> Client Keys)")
    sentry_sdk.init(dsn=settings.sentry_dsn, environment="production", traces_sample_rate=0)
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("service", args.service)
        try:
            raise TimeoutError(args.message)
        except TimeoutError as e:
            event_id = sentry_sdk.capture_exception(e)
    sentry_sdk.flush(timeout=10)
    print(f"sent Sentry event {event_id} (service={args.service}). If your alert rule fires on new issues, "
          f"Lore opens an incident in a few seconds.")


def cmd_mcp(args):
    from lore.mcp_server import create_server

    create_server(args.tenant).run("stdio")


def main():
    p = argparse.ArgumentParser(prog="lore")
    p.add_argument("--tenant", default="northwind")
    sub = p.add_subparsers(required=True)

    s = sub.add_parser("seed", help="(re)load a tenant's demo data")
    s.set_defaults(func=cmd_seed)

    t = sub.add_parser("tool", help="call a graph tool, e.g. lore tool who_knows '{\"entity_id\": \"payments-api\"}'")
    t.add_argument("name")
    t.add_argument("json", nargs="?")
    t.add_argument("--full", action="store_true", help="include evidence subgraph and cypher")
    t.set_defaults(func=cmd_tool)

    e = sub.add_parser("sentry-error", help="send a real error to Sentry to test the alert webhook")
    e.add_argument("--service", default="checkout")
    e.add_argument("--message", default="payment capture timed out after 2000ms waiting for payments-api")
    e.set_defaults(func=cmd_sentry_error)

    m = sub.add_parser("mcp", help="serve the tenant's MCP server over stdio")
    m.set_defaults(func=cmd_mcp)

    g = sub.add_parser("check-text", help="validate and merge seed text data files")
    g.add_argument("--merge", action="store_true", help="merge chunks into final JSON files")
    g.set_defaults(func=cmd_check_text)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
