# Knowing-Doing deployment

The API, SQLite product database, and MySQL Lab are deployed separately:

- `/home/ubuntu/knowing-doing-current` is an immutable release symlink.
- `/home/ubuntu/knowing-doing-data/zhixing-product.db` is the SQLite product database.
- The `zhixing-lab-mysql` container owns the `zhixing-lab-mysql-data` Docker volume and only binds `127.0.0.1:13306`.
- `/etc/knowing-doing/backend.env` contains production secrets and is never committed.
- `case-builder-agent` binds only `127.0.0.1:3102` on the host. It is the
  OpenHands/Docker build boundary; failed Builder resources are retained for 24
  hours, while successful Builder scratch resources are removed immediately.

## GitHub Actions secrets

Configure these repository secrets before expecting a push to restart the server:

`DEPLOY_HOST=119.45.243.102`, `DEPLOY_USER=ubuntu`, `DEPLOY_PORT=22`, and
`DEPLOY_SSH_KEY` containing the dedicated private key whose public key is in the
server user's `~/.ssh/authorized_keys`.

Runtime secrets are installed by the workflow into `/etc/knowing-doing/backend.env`
with mode `0600`. The required runtime secrets are `LAB_TOKEN_SECRET`,
`WORKSPACE_RUNNER_TOKEN`, `LAB_MYSQL_RUNNER_PASSWORD`,
`LAB_MYSQL_ADMIN_PASSWORD`, and `ZHIXING_MODEL_API_KEY`. The optional model
defaults are `ZHIXING_MODEL_BASE_URL=https://api.deepseek.com` and
`ZHIXING_MODEL_NAME=deepseek-flash`.

## Enable the OpenHands Builder after smoke verification

Keep the repository variable `CASE_BUILDER_ENABLED=false` until the image and
manual smoke gate have passed. First add these Actions secrets and deploy once
with the flag still disabled:

`CASE_BUILDER_TOKEN`, `ENVIRONMENT_RUNTIME_SIGNING_KEY`,
`CASE_BUILDER_OPENHANDS_IMAGE`, `CASE_BUILDER_OPENHANDS_COMMAND`, and
`CASE_BUILDER_MYSQL_ROOT_PASSWORD`. The image value must be pinned with
`@sha256:` and the image must include OpenHands, Docker CLI/Compose, a MySQL
client, and Python tooling. `CASE_BUILDER_LLM_BASE_URL`,
`CASE_BUILDER_LLM_API_KEY`, and `CASE_BUILDER_LLM_MODEL` are optional overrides;
when omitted, the deployment reuses the configured DeepSeek endpoint/key/model.

`CASE_BUILDER_OPENHANDS_COMMAND` is deployment-owned code, not a browser or API
input. It reads `/workspace/request.json`, writes exactly one
`/workspace/manifest.json`, and must build its runtime image with all supplied
`zhixing.*` labels. For a MySQL request it must use the supplied
`mysqlContract` unchanged: the case-specific database, schema, deterministic
seed profile, fault SQL, starter EXPLAIN, reference index, and
`zhixing.mysql-contract-fingerprint` label are all checked again by the
service. The Agent must never print credentials, write host paths into the
manifest, or expose a runtime port.

Use [the OpenHands extension recipe](../case-builder-agent/Dockerfile.openhands)
to create the task image from a digest-pinned OpenHands base. Publish it to a
private registry and use the resulting @sha256: reference for
CASE_BUILDER_OPENHANDS_IMAGE; the Agent explicitly sets its task entrypoint
to sh so an upstream OpenHands entrypoint cannot bypass the deployment-owned
wrapper.

The workflow writes separate mode-0600 files for the backend, Workspace Runner,
and Case Builder. The signing key is shared only between the backend and
Workspace Runner; browsers never receive it, Docker image names, manifests,
reference repairs, or raw Docker inspection output.

Run the protected `OpenHands Builder smoke` workflow with confirmation `RUN`
after that deployment. It temporarily starts the loopback-only Builder,
submits one bounded Python build, and stops the service again; it fails unless
the Agent returns a server-checked digest-pinned runtime artifact. Only after
it passes should you set `CASE_BUILDER_ENABLED=true` and deploy again. This is
intentionally manual so pull requests never create model cost.

The production host remains a deliberately accepted high-privilege Builder
location: a Docker socket grants host-equivalent capability. Loopback-only
exposure, authentication, command allowlists, no-network final runtimes, and
redacted logs reduce exposure but do not replace a dedicated Builder host. The
adapter endpoint is configurable so it can be moved later.

The server-side `ubuntu` account must have passwordless `sudo` for the deployment
commands and access to the Docker socket. The workflow does not print or commit
runtime values. Model and Zhihu keys are never written to the repository.

The workflow tests the frontend, backend, and workspace-runner packages on every
pull request and push. A push to `main`
then uploads that exact commit, builds a new immutable release on the server,
runs the explicit SQLite migration command, switches the release symlink, and
restarts the service. The server no longer needs to fetch the repository from
GitHub.

## One-time data setup

Upload the consistent SQLite backup as `zhixing-product.db`, upload the MySQL dump
as `zhixing-lab.sql`, and create a 0600 `mysql.env` containing
`MYSQL_ROOT_PASSWORD`, `LAB_MYSQL_RUNNER_PASSWORD`, and
`LAB_MYSQL_ADMIN_PASSWORD`. After the first release is available, run
`deploy/bootstrap-mysql.sh` on the server. It imports only the three Lab schemas;
it does not import MySQL system users or expose port 3306.
