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

## Zhihu OAuth over the fixed server IP

This release uses the exact callback
`http://119.45.243.102/api/auth/oauth/zhihu/callback`. Register that complete
value in the Zhihu application; the frontend never supplies a redirect URI.
Add `ZHIHU_OAUTH_APP_ID`, `ZHIHU_OAUTH_APP_KEY`,
`OAUTH_TOKEN_ENCRYPTION_KEY`, and the application-approved
`ZHIHU_OAUTH_SCOPES` as Actions secrets. Then enable the repository variables
`SIGNED_DEVICE_SESSION_ENABLED` and `ZHIHU_OAUTH_ENABLED` first. After both
are verified, set `ZHIHU_LOGIN_REQUIRED=true` to enforce the login gate; enable
`ZHIHU_SOURCE_SYNC_ENABLED` only when source sync is ready.

OAuth remains disabled by default. Because this callback is intentionally HTTP,
the backend additionally requires `ALLOW_INSECURE_OAUTH_CALLBACK=true`; session
cookies cannot use the Secure attribute on this deployment. If Zhihu rejects a
public HTTP callback, leave OAuth disabled. Do not proxy tokens through the
frontend or weaken state validation.

Practice Card v2 and Mixed Gym are controlled independently with the repository
variables `PRACTICE_CARD_V2_ENABLED` and `MIXED_GYM_ENABLED`.

## Enable the OpenHands Builder

The current workflow enables the Builder by default. Set the repository
variable `CASE_BUILDER_ENABLED=false` only when it needs to be paused. Add
these Actions secrets before deploying:

`CASE_BUILDER_TOKEN`, `ENVIRONMENT_RUNTIME_SIGNING_KEY`, and
`CASE_BUILDER_MYSQL_ROOT_PASSWORD`. `CASE_BUILDER_LLM_BASE_URL`,
`CASE_BUILDER_LLM_API_KEY`, and `CASE_BUILDER_LLM_MODEL` are optional overrides;
when omitted, the deployment reuses the configured DeepSeek endpoint/key/model.

The deployment host keeps a Git checkout at `/home/ubuntu/knowing-doing-repo`,
fetches `main`, verifies the exact commit SHA received from Actions, and
archives that commit into the immutable release directory. The repository is
public, so the default HTTPS remote needs no GitHub token. If the repository is
made private later, replace `ZHIXING_REPO_URL` in the deploy command and
configure a read-only GitHub credential on the host.

When the Builder is enabled, build [the OpenHands extension recipe](../case-builder-agent/Dockerfile.openhands)
directly on the deployment host with
`deploy/setup-case-builder-agent.sh`. The script uses the public Git checkout,
the digest-pinned OpenHands base, and writes a local digest-pinned image
reference into the root-owned Agent environment. GitHub Actions does not build
or publish this image; it only deploys the product services around the
server-owned Docker/OpenHands environment. The fixed deployment-owned command reads
`/workspace/request.json`, writes exactly one `/workspace/manifest.json`, and
must never print credentials, write host paths into the manifest, or expose a
runtime port. Run `deploy/setup-docker-environment.sh` once for the
server-managed Python/Go workspace images and the Node wrapper images. The
production deploy script only checks those local images and starts them; it does
not pull or build Docker images. `CASE_BUILDER_OPENHANDS_BASE_IMAGE` is an
optional setup-script environment variable; when omitted, the script uses the
tracked digest-pinned default.

After the runtime env files are installed, run these commands on the host (the
commit argument may be omitted to use `origin/main`):

```sh
bash deploy/setup-docker-environment.sh <commit>
bash deploy/setup-case-builder-agent.sh <commit>
```

The workflow writes separate mode-0600 files for the backend, Workspace Runner,
and Case Builder. The signing key is shared only between the backend and
Workspace Runner; browsers never receive it, Docker image names, manifests,
reference repairs, or raw Docker inspection output.

Run the protected `OpenHands Builder smoke` workflow with confirmation `RUN`
after that deployment. It temporarily starts the loopback-only Builder,
submits one bounded Python build, and stops the service again; it fails unless
the Agent returns a server-checked digest-pinned runtime artifact. This is
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
pull request and push. A push to `main` then connects to the server, clones or
fetches the public repository, verifies that exact commit, builds a new
immutable release on the server, runs the explicit SQLite migration command,
switches the release symlink, and restarts the service.

## One-time data setup

Upload the consistent SQLite backup as `zhixing-product.db`, upload the MySQL dump
as `zhixing-lab.sql`, and create a 0600 `mysql.env` containing
`MYSQL_ROOT_PASSWORD`, `LAB_MYSQL_RUNNER_PASSWORD`, and
`LAB_MYSQL_ADMIN_PASSWORD`. After the first release is available, run
`deploy/bootstrap-mysql.sh` on the server. It imports only the three Lab schemas;
it does not import MySQL system users or expose port 3306.
