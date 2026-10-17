"""Northwind: a fictional payments company. Hand-authored org + the planted storylines.

All times are expressed as "days ago" (floats) and converted against the seed's NOW, so
"the deploy 40 minutes ago" stays 40 minutes ago whenever the seed is (re)loaded.

Planted arcs the demo relies on:
  A1  INC-142 double charges -> D-09 idempotency keys (ADR-007)
  A2  INC-203 spring-sale latency -> D-17 pool fixed at 32 (ADR-012) + D-21 retry cap (ADR-015)
  A3  PLAT-311 cost push -> PR #482 shrinks the payments-api pool 32 -> 4, deployed 40 min ago
  A4  Priya (author of D-17) is out of office; Arjun is the next-best expert
  A5  Notifications moved Platform -> Growth 110 days ago (ownership history)
  A6  Red herrings: fraud-check deploy (3d), redis-cache incident (2d), checkout copy deploy (3h)
"""

ORG = {
    "name": "Northwind",
    "github": "https://github.com/savarbhasin/northwind-platform",
    "repo_dir": "northwind-platform",  # local checkout next to backend/, used to link PRs to real commits
    "slack": "https://northwind.slack.com/archives",
    "wiki": "https://wiki.northwind.dev",
    "jira": "https://northwind.atlassian.net/browse",
}

MIN = 1 / 1440
HOUR = 1 / 24

TEAMS = [
    ("team-checkout", "Checkout", "#team-checkout"),
    ("team-payments", "Payments", "#team-payments"),
    ("team-ledger", "Ledger", "#team-ledger"),
    ("team-platform", "Platform", "#team-platform"),
    ("team-growth", "Growth", "#team-growth"),
    ("team-identity", "Identity", "#team-identity"),
]

# id, name, title, team, joined (days ago)
PEOPLE = [
    ("priya", "Priya Raman", "Staff Engineer", "team-payments", 1400),
    ("arjun", "Arjun Mehta", "Senior Engineer", "team-payments", 1100),
    ("sofia", "Sofia Alvarez", "Engineer", "team-payments", 700),
    ("dev", "Dev Patel", "Engineer", "team-payments", 260),
    ("lena", "Lena Fischer", "Engineering Manager", "team-payments", 1200),
    ("maya", "Maya Chen", "Engineering Manager", "team-checkout", 1000),
    ("rohan", "Rohan Gupta", "Senior Engineer", "team-checkout", 900),
    ("tom", "Tom Becker", "Engineer", "team-checkout", 600),
    ("aisha", "Aisha Khan", "Engineer", "team-checkout", 500),
    ("kenji", "Kenji Sato", "Engineer", "team-checkout", 380),
    ("nora", "Nora Lindqvist", "Tech Lead", "team-ledger", 1300),
    ("samir", "Samir Haddad", "Senior Engineer", "team-ledger", 800),
    ("ines", "Inês Costa", "Engineer", "team-ledger", 450),
    ("raj", "Raj Malhotra", "Engineer", "team-ledger", 300),
    ("ananya", "Ananya Rao", "Engineering Manager", "team-platform", 1500),
    ("meera", "Meera Iyer", "Senior SRE", "team-platform", 950),
    ("oliver", "Oliver Grant", "SRE", "team-platform", 640),
    ("zara", "Zara Ahmed", "SRE", "team-platform", 420),
    ("lucas", "Lucas Moreau", "Platform Engineer", "team-platform", 560),
    ("kabir", "Kabir Singh", "Platform Engineer", "team-platform", 42),
    ("emma", "Emma Wilson", "Engineering Manager", "team-growth", 880),
    ("diego", "Diego Santos", "Engineer", "team-growth", 610),
    ("fatima", "Fatima Noor", "Engineer", "team-growth", 330),
    ("jack", "Jack O'Brien", "Engineer", "team-growth", 210),
    ("chloe", "Chloe Martin", "Senior Engineer", "team-growth", 1250),
    ("wei", "Wei Zhang", "Tech Lead", "team-identity", 1150),
    ("hana", "Hana Kim", "Engineer", "team-identity", 520),
    ("omar", "Omar Farouk", "Engineer", "team-identity", 470),
    ("julia", "Julia Novak", "Engineer", "team-identity", 190),
]

# Chloe was on Platform (owning notifications) until the move 110 days ago.
MEMBERSHIP_HISTORY = [
    ("chloe", "team-platform", 1250, 110),
    ("chloe", "team-growth", 110, None),
]

OOO = {"priya": (1.2, -6.0)}  # from 1.2 days ago until 6 days from now

# id, team, tier, description, depends_on, files
SERVICES = [
    ("web-frontend", "team-checkout", 1, "Customer-facing storefront (Next.js)", ["api-gateway"],
     ["services/web_frontend/app.py", "services/web_frontend/checkout_page.py"]),
    ("api-gateway", "team-platform", 0, "Edge routing, auth, rate limits", ["checkout", "catalog", "identity-api", "search"],
     ["services/api_gateway/routes.py", "services/api_gateway/ratelimit.py"]),
    ("checkout", "team-checkout", 0, "Order placement and payment orchestration",
     ["cart", "pricing", "payments-api", "inventory", "notifications"],
     ["services/checkout/app.py", "services/checkout/retry.py", "services/checkout/clients/payments.py",
      "services/checkout/handlers/place_order.py", "services/checkout/tests/test_place_order.py"]),
    ("cart", "team-checkout", 1, "Shopping cart state", ["redis-cache", "pricing"],
     ["services/cart/app.py", "services/cart/store.py"]),
    ("pricing", "team-checkout", 1, "Prices, discounts, taxes", ["catalog"],
     ["services/pricing/app.py", "services/pricing/discounts.py"]),
    ("catalog", "team-growth", 1, "Product catalog", ["postgres-main"],
     ["services/catalog/app.py", "services/catalog/models.py"]),
    ("search", "team-growth", 2, "Product search", ["catalog"],
     ["services/search/app.py", "services/search/indexer.py"]),
    ("inventory", "team-checkout", 1, "Stock reservations", ["postgres-main"],
     ["services/inventory/app.py", "services/inventory/reservations.py"]),
    ("payments-api", "team-payments", 0, "Payment authorization and capture",
     ["payment-router", "fraud-check", "ledger", "postgres-payments", "redis-cache"],
     ["services/payments_api/app.py", "services/payments_api/db/pool.py", "services/payments_api/handlers/capture.py",
      "services/payments_api/handlers/refund.py", "services/payments_api/idempotency.py",
      "services/payments_api/config.py", "services/payments_api/tests/test_capture.py",
      "services/payments_api/tests/test_pool.py"]),
    ("payment-router", "team-payments", 0, "Routes payments to PSPs", ["stripe-adapter"],
     ["services/payment_router/app.py", "services/payment_router/routing.py"]),
    ("stripe-adapter", "team-payments", 1, "Stripe PSP integration", [],
     ["services/stripe_adapter/client.py"]),
    ("fraud-check", "team-payments", 1, "Real-time fraud scoring", ["redis-cache"],
     ["services/fraud_check/app.py", "services/fraud_check/model.py"]),
    ("ledger", "team-ledger", 0, "Double-entry ledger", ["postgres-ledger", "kafka"],
     ["services/ledger/app.py", "services/ledger/outbox.py", "services/ledger/models.py",
      "services/ledger/handlers/post_entry.py", "services/ledger/tests/test_outbox.py"]),
    ("refunds", "team-ledger", 1, "Refund workflows", ["ledger", "payments-api"],
     ["services/refunds/app.py", "services/refunds/workflow.py"]),
    ("notifications", "team-growth", 2, "Order and payment notifications", ["email-sender", "kafka"],
     ["services/notifications/app.py", "services/notifications/consumer.py", "services/notifications/templates.py"]),
    ("email-sender", "team-growth", 2, "Transactional email delivery", [],
     ["services/email_sender/app.py", "services/email_sender/smtp.py"]),
    ("identity-api", "team-identity", 0, "Users, sessions, tokens", ["postgres-main", "redis-cache"],
     ["services/identity_api/app.py", "services/identity_api/tokens.py"]),
    ("auth", "team-identity", 0, "OAuth / login flows", ["identity-api"],
     ["services/auth/app.py", "services/auth/oauth.py"]),
    ("postgres-payments", "team-platform", 0, "Postgres cluster for payments", [],
     ["infra/terraform/postgres_payments.tf"]),
    ("postgres-ledger", "team-platform", 0, "Postgres cluster for ledger", [],
     ["infra/terraform/postgres_ledger.tf"]),
    ("postgres-main", "team-platform", 0, "Shared Postgres cluster", [],
     ["infra/terraform/postgres_main.tf"]),
    ("redis-cache", "team-platform", 1, "Shared Redis cache", [],
     ["infra/terraform/redis_cache.tf", "infra/helm/redis-cache/values.yaml"]),
    ("kafka", "team-platform", 0, "Event bus", [],
     ["infra/terraform/kafka.tf"]),
    ("feature-flags", "team-platform", 2, "Feature flag service", [],
     ["services/feature_flags/app.py"]),
]

# Notifications was owned by Platform until 110 days ago.
OWNERSHIP_HISTORY = [
    ("team-platform", "notifications", 900, 110),
    ("team-growth", "notifications", 110, None),
]

# Who tends to work on what (used to generate filler history with realistic expertise).
AFFINITY = {
    "payments-api": {"priya": 6, "arjun": 5, "sofia": 2, "dev": 2},
    "payment-router": {"arjun": 3, "sofia": 3, "priya": 1},
    "stripe-adapter": {"sofia": 3, "dev": 2},
    "fraud-check": {"sofia": 5, "dev": 2},
    "checkout": {"rohan": 5, "tom": 3, "aisha": 2, "kenji": 2, "arjun": 1},
    "cart": {"tom": 3, "kenji": 3},
    "pricing": {"aisha": 4, "tom": 1},
    "inventory": {"kenji": 3, "aisha": 2},
    "web-frontend": {"aisha": 3, "kenji": 2},
    "catalog": {"diego": 4, "fatima": 2},
    "search": {"fatima": 4, "jack": 2},
    "notifications": {"chloe": 6, "jack": 2, "diego": 1},
    "email-sender": {"chloe": 3, "jack": 3},
    "ledger": {"nora": 6, "samir": 4, "ines": 2},
    "refunds": {"samir": 4, "raj": 3, "ines": 2},
    "identity-api": {"wei": 5, "hana": 3, "omar": 2},
    "auth": {"omar": 4, "julia": 2, "wei": 2},
    "api-gateway": {"lucas": 4, "meera": 2},
    "postgres-payments": {"meera": 4, "oliver": 2, "priya": 1},
    "postgres-ledger": {"meera": 3, "zara": 2},
    "postgres-main": {"oliver": 3, "zara": 3},
    "redis-cache": {"oliver": 4, "zara": 2},
    "kafka": {"lucas": 3, "zara": 3, "nora": 1},
    "feature-flags": {"lucas": 3},
}

DECISIONS = [
    {
        "id": "D-09", "title": "Idempotency keys on every payment capture",
        "text": "All capture calls from payments-api to the payment-router must carry an idempotency key derived "
                "from order_id + attempt. Retries without a key are rejected.",
        "days": 237, "by": ["priya"], "approved": ["lena"], "status": "active",
        "doc": "ADR-007", "thread": "T-pay-idem", "motivated_by": "INC-142",
        "governs": ["services/payments_api/idempotency.py", "services/payments_api/handlers/capture.py"],
    },
    {
        "id": "D-17", "title": "payments-api DB pool fixed at 32 connections",
        "text": "payments-api keeps a Postgres pool of 32 connections per pod and must never drop below 24. "
                "At 8 we exhausted the pool during the Spring Sale (INC-203) and checkout p99 went past 3s. "
                "Any change needs sign-off from Payments.",
        "days": 146, "by": ["priya"], "approved": ["arjun", "lena"], "status": "active",
        "doc": "ADR-012", "thread": "T-pay-pool", "motivated_by": "INC-203",
        "governs": ["services/payments_api/db/pool.py", "services/payments_api/config.py"],
    },
    {
        "id": "D-21", "title": "Checkout -> payments retries capped at 3 with jitter",
        "text": "checkout retries payment capture at most 3 times with full-jitter exponential backoff. "
                "Unbounded retries amplified INC-203 into a retry storm.",
        "days": 145, "by": ["rohan", "arjun"], "approved": ["maya"], "status": "active",
        "doc": "ADR-015", "thread": "T-inc-203", "motivated_by": "INC-203",
        "governs": ["services/checkout/retry.py", "services/checkout/clients/payments.py"],
    },
    {
        "id": "D-24", "title": "Notifications moves from Platform to Growth",
        "text": "Growth takes ownership of notifications and email-sender. Chloe moves with the service.",
        "days": 110, "by": ["ananya", "emma"], "approved": [], "status": "active",
        "doc": None, "thread": "T-leads-notif", "motivated_by": None,
        "governs": [],
    },
    {
        "id": "D-30", "title": "Ledger writes go through a Kafka outbox",
        "text": "Ledger entries are written with a transactional outbox and published to Kafka; consumers "
                "must be idempotent.",
        "days": 200, "by": ["nora"], "approved": ["samir"], "status": "active",
        "doc": "ADR-018", "thread": None, "motivated_by": None,
        "governs": ["services/ledger/outbox.py"],
    },
    {
        "id": "D-12", "title": "Fraud scores cached in Redis for 10 minutes",
        "text": "fraud-check caches scores in redis-cache with a 10 minute TTL to keep p99 under 40ms.",
        "days": 190, "by": ["sofia"], "approved": ["priya"], "status": "active",
        "doc": None, "thread": None, "motivated_by": None,
        "governs": ["services/fraud_check/model.py"],
    },
]

DOCS = [
    ("ADR-007", "adr", "ADR-007: Idempotency keys on payment capture", 236, "priya", ["payments-api"],
     "Context: INC-142 double-charged 312 customers when capture was retried after PSP timeouts. "
     "Decision: every capture carries an idempotency key (order_id + attempt). The router dedupes on it. "
     "Consequences: retries are safe; keys are stored 72h in postgres-payments."),
    ("ADR-012", "adr", "ADR-012: payments-api connection pool sizing", 146, "priya", ["payments-api", "postgres-payments"],
     "Context: During the Spring Sale (INC-203) payments-api ran with POOL_SIZE=8. Requests queued for a "
     "connection, capture latency hit 2.8s and checkout p99 went past 3s. Decision: POOL_SIZE=32 per pod, "
     "never below 24; postgres-payments max_connections raised to 800. Consequences: ~600 connections at peak; "
     "cost is accepted. Changing this requires Payments sign-off."),
    ("ADR-015", "adr", "ADR-015: Bounded retries from checkout to payments", 145, "rohan", ["checkout", "payments-api"],
     "Context: during INC-203 checkout retried capture without bound, multiplying load on a saturated "
     "payments-api. Decision: max 3 attempts, full jitter, 250ms base. Relies on D-09 idempotency keys."),
    ("ADR-018", "adr", "ADR-018: Ledger transactional outbox", 200, "nora", ["ledger", "kafka"],
     "Ledger entries are committed with an outbox row and relayed to Kafka by the outbox worker. "
     "Consumers dedupe on entry_id."),
    ("PM-142", "postmortem", "Postmortem INC-142: duplicate charges", 235, "priya", ["payments-api", "checkout"],
     "Root cause: PR #121 added capture retries on PSP timeout without idempotency. 312 customers were "
     "charged twice. Fix: PR #127 idempotency keys. Follow-up: ADR-007."),
    ("PM-203", "postmortem", "Postmortem INC-203: checkout latency during Spring Sale", 144, "arjun",
     ["checkout", "payments-api", "postgres-payments"],
     "Impact: checkout p99 3.4s for 47 minutes, 9% of orders failed. Root cause: payments-api pool of 8 "
     "connections exhausted; threads blocked waiting for connections; checkout retried without bound. "
     "Fix: PR #301 pool 8->32, PR #305 retry cap. Detection signal: payments-api db_pool_wait_ms > 500."),
    ("RB-07", "runbook", "Runbook: payments-api connection pool exhaustion", 140, "arjun", ["payments-api"],
     "Symptoms: checkout p99 up, payments-api capture latency up, db_pool_wait_ms high, postgres-payments CPU "
     "normal. Steps: 1) check recent deploys touching services/payments_api/db/pool.py or POOL_SIZE; "
     "2) compare POOL_SIZE with ADR-012 (32); 3) revert or redeploy with POOL_SIZE=32; 4) page Payments."),
    ("RB-11", "runbook", "Runbook: notifications backlog", 58, "chloe", ["notifications", "email-sender"],
     "Check consumer lag on the notifications topic, scale consumers, verify email-sender SMTP quota."),
    ("DD-03", "design", "Design: Postgres cost reduction (PLAT-311)", 11, "ananya", ["postgres-payments", "postgres-main"],
     "RDS spend is up 38% QoQ, driven by connection-heavy instance classes. Proposal: reduce per-service "
     "connection pools, introduce PgBouncer in Q4."),
]

INCIDENTS = [
    {"id": "INC-142", "title": "Customers double-charged on retried captures", "severity": "SEV1",
     "days": 240, "duration_h": 5, "affects": ["payments-api", "checkout"], "caused_by": "PR-121",
     "resolved_by": ["PR-127"], "postmortem": "PM-142", "commander": "priya",
     "symptoms": "duplicate charges, capture retries, PSP timeouts"},
    {"id": "INC-203", "title": "Checkout p99 > 3s during Spring Sale", "severity": "SEV1",
     "days": 150, "duration_h": 0.8, "affects": ["checkout", "payments-api", "postgres-payments"],
     "caused_by": "PR-288", "resolved_by": ["PR-301", "PR-305"], "postmortem": "PM-203", "commander": "arjun",
     "symptoms": "checkout p99 latency, payments-api capture latency, db_pool_wait_ms high, retry storm"},
    {"id": "INC-260", "title": "Order emails delayed by 2 hours", "severity": "SEV3",
     "days": 60, "duration_h": 2.5, "affects": ["notifications", "email-sender"], "caused_by": None,
     "resolved_by": ["PR-402"], "postmortem": None, "commander": "chloe",
     "symptoms": "consumer lag, email backlog"},
    {"id": "INC-288", "title": "Token refresh failures on mobile", "severity": "SEV2",
     "days": 20, "duration_h": 1.5, "affects": ["identity-api", "auth"], "caused_by": None,
     "resolved_by": ["PR-455"], "postmortem": None, "commander": "wei",
     "symptoms": "401s, token refresh errors"},
    {"id": "INC-301", "title": "redis-cache latency spike", "severity": "SEV3",
     "days": 2, "duration_h": 0.5, "affects": ["redis-cache", "fraud-check", "cart"], "caused_by": None,
     "resolved_by": ["PR-479"], "postmortem": None, "commander": "oliver",
     "symptoms": "redis latency, cache evictions"},
]

TICKETS = [
    ("PAY-88", "Make capture retries safe (idempotency)", 238, "priya", "done", ["payments-api"], "INC-142"),
    ("PAY-131", "Raise payments-api pool after INC-203", 149, "priya", "done", ["payments-api"], "INC-203"),
    ("CHK-77", "Bound checkout capture retries", 148, "rohan", "done", ["checkout"], "INC-203"),
    ("PLAT-311", "Reduce Postgres connection count (RDS cost)", 12, "ananya", "in_progress",
     ["postgres-payments", "postgres-main", "payments-api"], None),
    ("GRW-40", "Take over notifications on-call", 109, "emma", "done", ["notifications"], None),
]

# Planted PRs. merged = days ago; deployed = days ago (None = not deployed separately).
PLANTED_PRS = [
    {"n": 121, "title": "payments-api: retry capture on PSP timeout", "author": "sofia", "reviewers": ["dev"],
     "service": "payments-api", "files": ["services/payments_api/handlers/capture.py"], "merged": 242, "deployed": 241.9,
     "body": "Retries capture up to 3 times when the PSP times out."},
    {"n": 127, "title": "payments-api: idempotency keys on capture", "author": "priya", "reviewers": ["arjun", "sofia"],
     "service": "payments-api", "files": ["services/payments_api/idempotency.py", "services/payments_api/handlers/capture.py"],
     "merged": 239, "deployed": 238.9, "body": "Fixes INC-142. Adds idempotency keys (order_id+attempt). PAY-88."},
    {"n": 288, "title": "payments-api: trim pool to 8 after migration", "author": "dev", "reviewers": ["sofia"],
     "service": "payments-api", "files": ["services/payments_api/db/pool.py"], "merged": 158, "deployed": 157.9,
     "body": "Post-migration cleanup, 8 connections looked like plenty in staging."},
    {"n": 301, "title": "payments-api: raise DB pool 8 -> 32", "author": "priya", "reviewers": ["arjun"],
     "service": "payments-api", "files": ["services/payments_api/db/pool.py", "services/payments_api/config.py"],
     "merged": 149.9, "deployed": 149.85, "body": "Mitigates INC-203. PAY-131. See ADR-012 for sizing rationale."},
    {"n": 305, "title": "checkout: cap capture retries at 3 with full jitter", "author": "rohan", "reviewers": ["arjun", "tom"],
     "service": "checkout", "files": ["services/checkout/retry.py", "services/checkout/clients/payments.py"],
     "merged": 148, "deployed": 147.9, "body": "Follow-up to INC-203. CHK-77. ADR-015."},
    {"n": 402, "title": "notifications: scale consumers and add lag alert", "author": "chloe", "reviewers": ["jack"],
     "service": "notifications", "files": ["services/notifications/consumer.py"], "merged": 59.8, "deployed": 59.7,
     "body": "Fixes INC-260."},
    {"n": 455, "title": "identity-api: fix refresh token clock skew", "author": "wei", "reviewers": ["hana"],
     "service": "identity-api", "files": ["services/identity_api/tokens.py"], "merged": 19.9, "deployed": 19.8,
     "body": "Fixes INC-288."},
    {"n": 476, "title": "fraud-check: tune model threshold 0.82 -> 0.85", "author": "sofia", "reviewers": ["dev"],
     "service": "fraud-check", "files": ["services/fraud_check/model.py"], "merged": 3.1, "deployed": 3.0,
     "body": "Reduces false positives by ~4%."},
    {"n": 479, "title": "redis-cache: raise maxmemory to 12gb", "author": "oliver", "reviewers": ["zara"],
     "service": "redis-cache", "files": ["infra/helm/redis-cache/values.yaml"], "merged": 1.95, "deployed": 1.9,
     "body": "Fixes INC-301 evictions."},
    {"n": 481, "title": "checkout: update order confirmation copy", "author": "kenji", "reviewers": ["aisha"],
     "service": "checkout", "files": ["services/checkout/handlers/place_order.py"], "merged": 3 * HOUR + 20 * MIN,
     "deployed": 3 * HOUR, "body": "Copy change requested by marketing."},
    {"n": 482, "title": "payments-api: reduce DB pool size to cut connection count (PLAT-311)", "author": "kabir",
     "reviewers": ["meera", "dev"], "service": "payments-api",
     "files": ["services/payments_api/db/pool.py", "services/payments_api/config.py"],
     "merged": 70 * MIN, "deployed": 40 * MIN,
     "body": "Part of PLAT-311 (Postgres cost). payments-api holds 32 connections per pod; most are idle off-peak. "
             "Reducing POOL_SIZE to 4 cuts ~560 connections on postgres-payments. Staging looks fine."},
]

# Planted Slack threads: id, channel, title, days ago, messages (author, minutes after start, text, mentions)
THREADS = [
    ("T-pay-idem", "#team-payments", "Double charges — making capture retries safe", 238, [
        ("lena", 0, "We double-charged 312 customers in INC-142. How do we make capture retries safe?", ["INC-142"]),
        ("priya", 6, "PR #121 retries on PSP timeout but the router can't tell a retry from a new capture. "
                     "We need idempotency keys: order_id + attempt, deduped in the router.", ["PR-121", "payment-router"]),
        ("arjun", 11, "+1. Keys should live 72h in postgres-payments so late retries still dedupe.", ["postgres-payments"]),
        ("priya", 25, "Writing it up as ADR-007. PR #127 implements it.", ["ADR-007", "PR-127"]),
    ]),
    ("T-inc-203", "#inc-203", "INC-203 checkout latency (Spring Sale)", 150, [
        ("arjun", 0, "Checkout p99 is 3.4s. payments-api capture latency 2.8s. db_pool_wait_ms is through the roof.",
         ["checkout", "payments-api"]),
        ("meera", 4, "postgres-payments CPU is 30%, the DB is fine. Connections are capped on the app side.", ["postgres-payments"]),
        ("priya", 7, "POOL_SIZE is 8 since PR #288. Threads are blocked waiting for a connection. Raising to 32 now.",
         ["PR-288", "payments-api"]),
        ("rohan", 9, "Checkout is also retrying capture with no bound, we're piling on. I'll cap retries.", ["checkout"]),
        ("arjun", 31, "Recovered after PR #301 rolled out. p99 back to 180ms.", ["PR-301"]),
    ]),
    ("T-pay-pool", "#team-payments", "How big should the payments-api pool be?", 147, [
        ("dev", 0, "Is 32 overkill? Staging is fine with 8.", ["payments-api"]),
        ("priya", 5, "Staging never sees sale traffic. At 8 we exhausted the pool in INC-203. 32 per pod, never below 24. "
                     "I'll record it as ADR-012 so nobody trims it again.", ["INC-203", "ADR-012"]),
        ("arjun", 9, "Agreed. And any pool change should get a Payments reviewer — pool.py is load-bearing.",
         ["services/payments_api/db/pool.py"]),
    ]),
    ("T-leads-notif", "#eng-leads", "Who should own notifications?", 111, [
        ("ananya", 0, "Platform shouldn't own product services. Proposal: notifications + email-sender move to Growth.",
         ["notifications", "email-sender"]),
        ("emma", 20, "Growth is happy to take them. Chloe has the most context — she'd move with it.", ["chloe"]),
        ("ananya", 45, "Done. Effective Monday. GRW-40 tracks the on-call handover.", ["GRW-40"]),
    ]),
    ("T-plat-cost", "#team-platform", "Postgres cost reduction", 12, [
        ("ananya", 0, "RDS spend is up 38% QoQ. Connection counts are the driver. PLAT-311 + DD-03 have the plan.",
         ["PLAT-311", "DD-03"]),
        ("kabir", 30, "I can take payments-api first, it holds the most connections (32 per pod).", ["payments-api"]),
        ("meera", 41, "Sounds good. Most of those are idle outside peak.", []),
    ]),
    ("T-priya-ooo", "#team-payments", "Priya OOO", 1.3, [
        ("priya", 0, "I'm out from tomorrow until next Thursday. Arjun is covering payments-api questions.", ["arjun"]),
    ]),
    ("T-pr-482", "#team-platform", "PR #482 review", 1.1, [
        ("kabir", 0, "PR #482 is up: payments-api POOL_SIZE 32 -> 4 for PLAT-311. Can someone review?", ["PR-482"]),
        ("meera", 50, "LGTM from platform side.", ["PR-482"]),
    ]),
]

# Words used for generating plausible filler history.
FILLER_VERBS = ["fix", "refactor", "add", "improve", "remove", "tune", "instrument", "harden", "clean up", "speed up"]
FILLER_THINGS = ["error handling", "metrics", "logging", "timeouts", "config parsing", "tests", "tracing spans",
                 "input validation", "health checks", "dependency versions", "feature flag", "batch size", "caching"]
FILLER_QUESTIONS = [
    "Does anyone know why {svc} {symptom}?",
    "Who can help me understand {svc}'s {thing}?",
    "Is it safe to change the {thing} in {svc}?",
    "Seeing {symptom} in {svc} on staging — expected?",
]
FILLER_SYMPTOMS = ["returns 503s on deploy", "logs a warning on startup", "is slow on cold start",
                   "times out under load", "has flaky tests", "spikes memory at midnight"]
FILLER_ANSWERS = [
    "That's the {thing} — it was added on purpose, check {file}.",
    "Known issue, it's in {file}. I can pair on it.",
    "Yes, but keep an eye on the dashboards. The logic lives in {file}.",
    "It's expected during warmup. See {file} for the details.",
]
