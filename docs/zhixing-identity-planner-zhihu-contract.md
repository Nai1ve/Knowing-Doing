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
  exit, and a hard maximum of six user turns. The initial direction counts as
  the first turn.
- Early exit requires a clear direction, evidence across at least two distinct
  capability dimensions, and at least one concrete experience or resume
  signal.
- Requirements calibration keeps its hard maximum of five turns.

## First implementation slice

- Backend: assessment v2 reliability, baseline 0-6 persistence, conservative
  evaluation fallback, official Zhihu envelope/search mapping, and tests.
- Frontend: six-turn progress, clear automatic-recovery states, and tests.
- Deferred behind separate follow-up slices: mandatory login gate, remote PDF
  parsing, favorites pagination, research routing, and production flag changes.

## Rollout flags

The first slice introduces `PLANNER_ASSESSMENT_V2_ENABLED`. Existing identity,
OAuth, source-sync, Practice Card, and Mixed Gym flags retain their current
behavior until their dedicated slices are accepted.
