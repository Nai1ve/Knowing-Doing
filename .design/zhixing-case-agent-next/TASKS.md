# Build Tasks: Case Agent Capability To Practice

Generated from: `docs/zhixing-case-agent/README.md`
Date: 2026-09-10

## P1: Capability And Exercise Contract

- [ ] **Introduce V2 exercise interpretation**: Add the capability resolver, V2 exercise schema, and environment interpreter boundary while preserving V1 learning cases. _Modifies: environment registry, case schemas, product types; reuses current runtime adapter._
- [ ] **Move Python policy into its interpreter**: Make file and command validation template-owned, then run existing Python workspace and MySQL Lab regression tests. _Modifies: case workspace service; no new UI._
- [ ] **Persist a compatible spec version**: Add the narrow migration and repository mapping without rewriting historical cases. Covers: V1 read compatibility and absent private reference solution in APIs.

## P2: Python List Vertical Slice

- [ ] **Expose the list capability through a real route node**: Resolve `python.collections.list` to the available Python environment and show a workspace action only for that supported node. _Modifies: capability catalog and route-node creation; reuses current learning workspace UI._
- [ ] **Generate a list practice case**: Use the staged builder to output a list-specific public spec and private reference solution from the frozen context. Covers: model repair, environment substitution rejection, and provider labeling.
- [ ] **Preflight generated cases in a temporary runner**: Verify starter failure and reference success before a case becomes ready. Covers: timeout, cleanup, retry, restart recovery, and real failure presentation.

## P3: Article Input

- [ ] **Freeze selected Zhihu article content**: Create a server-owned source snapshot from a visible SourceItem before case generation. Covers: ownership, checksum reuse, content bounds, and extraction failure.
- [ ] **Show article provenance on the case**: Add a compact, on-demand source card to the case view. Covers: loading, failed extraction, external link, and no full-text prefetch.

## P4: Dynamic MySQL Case Material

- [ ] **Add the MySQL exercise interpreter**: Materialize registered schema, seed, fault, and query templates into an isolated temporary Lab. _Depends on: P1 interpreter contract._
- [ ] **Preflight a wrong-index slow-query case**: Prove that the initial query is problematic and the private solution changes the observable plan/result. Covers: temporary Lab cleanup and fixed-case regression.
- [ ] **Dispatch dynamic MySQL practice safely**: Route generated MySQL case IDs to the MySQL adapter without sending them into the fixed manifest/token path.

## P5: Environment Expansion

- [ ] **Add Go as the second real template**: Deliver registry entry, interpreter, runner image, fixture/model case, preflight, and browser acceptance as one vertical slice.
- [ ] **Add Java, Rust, and C++ one at a time**: Repeat the same admission suite; do not mark a capability available before real Runner preflight passes.
- [ ] **Add Redis and Kafka as topology templates**: Validate lifecycle and resource envelopes separately from language templates. _Depends on: a stable single-runtime template workflow._

## Review

- [ ] **Performance and concurrency review per phase**: Inspect generated SQL with `EXPLAIN QUERY PLAN`, validate worker claim fences and duplicate request behavior, then document any remaining risk before merging.
- [ ] **Milestone verification**: Run backend/frontend checks as applicable, perform the phase's real runtime acceptance path, commit the milestone, and rebuild CodeGraph.
