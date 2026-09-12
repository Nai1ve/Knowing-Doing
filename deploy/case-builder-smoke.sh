#!/usr/bin/env bash
set -Eeuo pipefail

# Deliberately invoked only by the protected manual GitHub workflow. It verifies
# one real, bounded Python build without printing credentials, manifests, model
# output, or Docker details. The wrapper may run it before the product feature
# flag is enabled, so the smoke remains an actual release gate.
agent_env="${CASE_BUILDER_AGENT_ENV:-/home/ubuntu/knowing-doing-data/case-builder-agent.env}"
agent_url="${CASE_BUILDER_AGENT_URL:-http://127.0.0.1:3102}"

if [ ! -f "$agent_env" ]; then
  echo 'Case Builder agent configuration is missing.' >&2
  exit 1
fi

token="$(sed -n 's/^CASE_BUILDER_TOKEN=//p' "$agent_env" | tail -n 1)"
if [ -z "$token" ]; then
  echo 'Case Builder token is not configured.' >&2
  exit 1
fi

health="$(curl --fail --silent --show-error --max-time 10 "$agent_url/health")"
node -e "const value = JSON.parse(process.argv[1]); if (!value.ready || !value.imagePinned || value.simulated) process.exit(1)" "$health" || {
  echo 'Case Builder health gate failed (it must be ready, digest-pinned, and non-simulated).' >&2
  exit 1
}

build_id="smoke-$(node -e 'console.log(require("node:crypto").randomUUID())')"
attempt_id="smoke-$(node -e 'console.log(require("node:crypto").randomUUID())')"
payload="$(CASE_BUILDER_SMOKE_BUILD_ID="$build_id" CASE_BUILDER_SMOKE_ATTEMPT_ID="$attempt_id" node -e '
  process.stdout.write(JSON.stringify({
    buildId: process.env.CASE_BUILDER_SMOKE_BUILD_ID,
    attemptId: process.env.CASE_BUILDER_SMOKE_ATTEMPT_ID,
    protocolVersion: 1,
    runtimeKind: "docker_workspace",
    card: { title: "Python smoke build", completionStandard: "pytest passes", knowledgeCard: {}, learnerProfile: [] },
    learnerProfile: [],
    environment: { capabilityKey: "python.testing", environmentKey: "python-pytest-v1", environmentVersion: "1", displayName: "Python pytest", agentSummary: "Create a minimal offline pytest environment." },
    successCriteria: { commandKeys: ["pytest_quiet"], successSignals: ["pytest"] },
    limits: { maxRepairRounds: 0, timeoutMs: 600000, maxLogBytes: 16384 }
  }))
')"

created="$(curl --fail --silent --show-error --max-time 20 \
  -H 'content-type: application/json' -H "x-case-builder-token: $token" \
  --data "$payload" "$agent_url/internal/v1/environment-builds")"
task_id="$(node -e 'const value = JSON.parse(process.argv[1]); if (!value.taskId) process.exit(1); process.stdout.write(value.taskId)' "$created")"

for _attempt in $(seq 1 120); do
  result="$(curl --fail --silent --show-error --max-time 20 -H "x-case-builder-token: $token" "$agent_url/internal/v1/environment-builds/$task_id")"
  status="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.status || "")' "$result")"
  if [ "$status" = 'succeeded' ]; then
    node -e 'const value = JSON.parse(process.argv[1]); const manifest = value.manifest; if (!manifest || manifest.runtimeKind !== "docker_workspace" || !manifest.environment?.runtimeImageDigest || !manifest.resources?.some((item) => item.kind === "image" && item.role === "runtime_artifact")) process.exit(1)' "$result"
    echo 'OpenHands Python smoke build passed.'
    exit 0
  fi
  if [ "$status" = 'failed' ] || [ "$status" = 'cancelled' ]; then
    code="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.failure?.code || "case_builder_smoke_failed")' "$result")"
    echo "OpenHands Python smoke build failed: $code" >&2
    exit 1
  fi
  sleep 5
done

curl --silent --show-error --max-time 10 -H 'content-type: application/json' -H "x-case-builder-token: $token" --data '{}' "$agent_url/internal/v1/environment-builds/$task_id/cancel" >/dev/null || true
echo 'OpenHands Python smoke build timed out and was cancelled.' >&2
exit 1
