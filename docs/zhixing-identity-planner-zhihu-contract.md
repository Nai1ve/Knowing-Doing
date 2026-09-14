# Identity, Planner Assessment v2, and Zhihu platform contract

This document freezes the first implementation slice of the authenticated
planning and Zhihu integration work. It is intentionally narrower than the
full product rollout so backend and frontend work can proceed independently.

## Identity boundary

- A device session is a bootstrap/CSRF mechanism, not a permanent user
  identity.
- A production learner is resolved through a stable
  `(provider, provider_user_id)` account binding.
- OAuth access tokens, token hashes, display names, and profile URLs must never
  be used as a provider user id.
- Business routes will eventually require an authenticated session; the first
  slice keeps the existing rollout flag behavior unchanged.

## Zhihu transport boundary

- `https://openapi.zhihu.com` is used only for OAuth authorization and token
  exchange.
- `https://developer.zhihu.com` is used for data APIs.
- Data API requests include `Authorization: Bearer <Access Secret>` and
  `X-Request-Timestamp`.
- Requests for an authorized learner additionally include `X-OAuth-Token`.
- Data API responses use the official `Code`, `Message`, and `Data` envelope.
  Product adapters expose camelCase DTOs and never expose provider credentials
  or raw responses.

## Planner assessment v2

- The service, not the model, owns question count, dimension coverage, type,
  difficulty, and stable identifiers.
- The model supplies question content for server-created slots.
- An assessment contains 12-15 questions across 4-5 dimensions. Every
  dimension has at least two questions and the complete set covers foundation,
  applied, advanced, and scenario questions.
- Invalid model output is normalized and validated per question. Valid
  questions are preserved, one repair call may fill invalid slots, and a safe
  deterministic fallback fills any remaining slots.
- A reachable model must not leave the learner blocked in
  `assessment_preparing` solely because of invalid structured output.
- Rubrics and reference answers remain private until the assessment is
  terminal and the review endpoint is explicitly called.

## Conversation limits

- Baseline discovery has a minimum of two user turns, an evidence-driven early
  exit, and a hard maximum of three user turns. The initial direction counts as
  the first turn.
- Early exit requires a clear direction, evidence across at least two distinct
  capability dimensions, and at least one concrete experience or resume
  signal.
- Requirements calibration keeps its hard maximum of five turns.

> The three-turn ceiling replaces the earlier six-turn contract frozen before
> this slice. `planning_sessions.baseline_turn_count` CHECK constraint is
> rebuilt to `0..3` (migration 060) and the agent planner clamps at three.

## First implementation slice

- Backend: assessment v2 reliability, baseline 0-3 persistence, conservative
  evaluation fallback, official Zhihu envelope/search mapping, and tests.
- Frontend: three-turn progress, clear automatic-recovery states, and tests.
- Deferred behind separate follow-up slices: mandatory login gate, remote PDF
  parsing, favorites pagination, research routing, and production flag changes.

## Logout contract (completion plan P2)

- `POST /api/auth/logout` revokes the current `learner_sessions` row, clears
  the device cookie, and makes the old cookie unusable: the next authenticated
  request with that cookie returns `401`.
- The response returns `200` with a success body on successful revocation, and
  `200` (idempotent) when the session is already absent. It must never echo the
  encrypted token or provider credentials.
- Disconnecting a Zhihu provider deletes the encrypted access token but keeps a
  de-identified snapshot for sources already referenced by Practice Cards.

## Research object model (completion plan P0)

- `ResearchProvider`: `user_source | zhihu_search | global_search |
  question_recommendation | direct_answer`.
- `ResearchQuery` is the persisted request record (provider, query, status,
  timestamps). Cache records dedupe by `(provider, query fingerprint)`.
- `ResearchCandidate` is the normalized candidate: canonical URL + content hash
  for dedupe, provider, query id, fetched-at, summary, credibility, relevance,
  and retrieval evidence. Private content stays private; only a de-identified
  digest ever leaves the research boundary.
- The Practice Card Generator receives at most two `SourceDigestContract`
  values (no full text, no private fields). A card with no adopted sources is a
  pure route card.

## Rollout flags

The first slice introduces `PLANNER_ASSESSMENT_V2_ENABLED`. Existing identity,
OAuth, source-sync, Practice Card, and Mixed Gym flags retain their current
behavior until their dedicated slices are accepted.
