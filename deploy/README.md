# Knowing-Doing deployment

The API, SQLite product database, and MySQL Lab are deployed separately:

- `/home/ubuntu/knowing-doing-current` is an immutable release symlink.
- `/home/ubuntu/knowing-doing-data/zhixing-product.db` is the SQLite product database.
- The `zhixing-lab-mysql` container owns the `zhixing-lab-mysql-data` Docker volume and only binds `127.0.0.1:13306`.
- `/etc/knowing-doing/backend.env` contains production secrets and is never committed.

## GitHub Actions secrets

Configure these repository secrets before expecting a push to restart the server:

`DEPLOY_HOST=119.45.243.102`, `DEPLOY_USER=ubuntu`, `DEPLOY_PORT=22`, and
`DEPLOY_SSH_KEY` containing the dedicated private key whose public key is in the
server user's `~/.ssh/authorized_keys`.

Runtime secrets are installed by the workflow into `/etc/knowing-doing/backend.env`
with mode `0600`. Configure the names listed in
`deploy/github-actions-secrets.example`, especially `LAB_TOKEN_SECRET`,
`ZHIXING_MODEL_API_KEY`, and `ZHIXING_MODEL_NAME`. The workflow does not print or
commit these values. The model and Zhihu keys are never written to the repository.

The workflow tests both packages on every pull request and push. A push to `main`
then fetches that commit on the server, builds a new release, runs the explicit
SQLite migration command, switches the release symlink, and restarts the service.

## One-time data setup

Upload the consistent SQLite backup as `zhixing-product.db`, upload the MySQL dump
as `zhixing-lab.sql`, and create a 0600 `mysql.env` containing
`MYSQL_ROOT_PASSWORD`, `LAB_MYSQL_RUNNER_PASSWORD`, and
`LAB_MYSQL_ADMIN_PASSWORD`. After the first release is available, run
`deploy/bootstrap-mysql.sh` on the server. It imports only the three Lab schemas;
it does not import MySQL system users or expose port 3306.
