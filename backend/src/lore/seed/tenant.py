from lore import db
from lore.embeddings import embed_missing
from lore.seed.load import load


def dataset(tenant: str):
    if tenant == "acme":
        from lore.seed.acme import build as build_acme

        return build_acme(db.now_ms())
    from lore.seed.build import build

    return build(db.now_ms())


async def seed(tenant: str) -> dict:
    """(Re)load a tenant's demo data, then embed it for vector search."""
    g = db.brain(tenant)
    stats = load(g, dataset(tenant))
    stats["embedded"] = await embed_missing(g)
    return stats
