# ZhiXing Gym API

The API provides learner-owned dynamic Gym environments. A roadmap card is
designed into a constrained case, materialized into a server-owned runtime,
and registered with the scheduler only after its preflight succeeds.

The MySQL runtime connects to a platform-provided MySQL 8 instance. Each
dynamic case receives its own schema. The browser never receives database
credentials, a container identifier, or a host port.

## Local Development

Copy `.env.example` to `.env` and provide local MySQL runner and admin
credentials. Start an empty local MySQL instance:

```bash
docker compose -f docker-compose.local.yml up -d mysql
docker compose -f docker-compose.local.yml ps
```

Apply the product SQLite migrations and start the API:

```bash
npm run db:migrate
npm run dev
```

The API listens on `127.0.0.1:3001` by default. A dynamic MySQL schema is
created only when a learner builds a Gym from a current plan unit. The
materialization and preflight services own its reset lifecycle.

## Dynamic Gym Flow

1. A learner selects the current lab unit from the roadmap.
2. The Case Design Agent selects a permitted environment profile and emits a
   constrained case design.
3. The server validates the design, materializes only registered assets, and
   runs a preflight.
4. The scheduler registers the resulting dynamic case and creates or resumes a
   learner-owned practice run.

Only registered dynamic case IDs can be scheduled. Static MySQL case IDs and
the former `/api/lab/*` entry points are intentionally unavailable.

## Local Reset

To reset local product state, first stop the API and inspect the targets:

```bash
npm run product:reset-local -- --include-mysql
```

After checking the SQLite files, resume directory, and local Docker volume,
run:

```bash
npm run product:reset-local -- --apply --include-mysql
npm run db:migrate
```

This removes local product state and the local MySQL volume. It does not
create a fixed schema or seed a fixed case; new schemas are created through
the dynamic Gym flow.

## Safety and Concurrency

The scheduler holds one active run per dynamic case and returns a FIFO queue
ticket for concurrent starts. Session execution is serialized and idempotent
by client request ID. Lease expiry closes sessions and releases the runtime.

SQL is parsed and checked against the dynamic case manifest. Cross-schema
access, multi-statements, filesystem/network access, instance configuration,
and unregistered tables are rejected. Dynamic case materialization uses
server-owned schema, seed, fault, query, and reference-repair registries; the
Agent does not supply arbitrary DDL or runtime configuration.

## Verification

```bash
npm test
npm run build
```

The test suite covers dynamic registration, queueing, session isolation, SQL
policy, preflight, and product-level case construction. Run MySQL integration
validation against the configured local instance before production rollout.
