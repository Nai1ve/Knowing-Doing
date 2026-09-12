#!/usr/bin/env python3
"""Deployment-owned OpenHands environment build command.

The Node Case Builder service owns the HTTP protocol and Docker task limits.
This command owns only the work performed inside the digest-pinned OpenHands
task image.  OpenHands may create the proposed Python starter/reference files
and run bounded checks; this wrapper creates the final labelled runtime image
and emits the manifest consumed by the product-side validators.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlparse
from pathlib import Path
from typing import Any


WORKSPACE = Path("/workspace")
REQUEST_PATH = Path(os.environ.get("CASE_BUILDER_REQUEST", str(WORKSPACE / "request.json")))
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_FILE_BYTES = 2 * 1024 * 1024
ALLOWED_FILE_SUFFIXES = (".py", ".json", ".md", ".txt")
SAFE_TOKEN = re.compile(r"^[A-Za-z0-9_.-]+$")
SECRET_PATTERN = re.compile(
    r"(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|password|token)\s*[=:]\s*|authorization\s*[=:]\s*(?:bearer\s+)?)\S+",
    re.IGNORECASE,
)


def clean(value: Any, limit: int = 2_000) -> str:
    text = str(value or "").replace("\x00", "")
    text = SECRET_PATTERN.sub("[redacted]", text)
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


def fail(code: str, message: str) -> "NoReturn":
    print(f"case_builder_{code}: {clean(message)}", file=sys.stderr)
    raise SystemExit(1)


def load_request() -> dict[str, Any]:
    try:
        value = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
    except Exception as error:  # pragma: no cover - exercised in the image
        fail("request_invalid", str(error))
    if not isinstance(value, dict):
        fail("request_invalid", "构建请求必须是 JSON 对象")
    return value


def require_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail("request_invalid", f"{name} 不能为空")
    return value.strip()


def safe_relative_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or not value or len(value) > 180:
        fail("asset_invalid", "Agent 生成了越界文件路径")
    if not value.endswith(ALLOWED_FILE_SUFFIXES):
        fail("asset_invalid", "Agent 生成了不受支持的文件类型")
    return value


def read_asset_files(directory: Path, required: bool) -> list[dict[str, str]]:
    if not directory.exists():
        if required:
            fail("asset_missing", f"缺少 Agent 资产目录: {directory.name}")
        return []
    files: list[dict[str, str]] = []
    total = 0
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = safe_relative_path(path.relative_to(directory).as_posix())
        content = path.read_text(encoding="utf-8")
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            fail("asset_invalid", "Agent 生成的单个文件超过大小限制")
        total += size
        if total > MAX_TOTAL_FILE_BYTES:
            fail("asset_invalid", "Agent 生成的文件总量超过大小限制")
        files.append({"path": relative, "content": content})
    if required and not files:
        fail("asset_missing", f"Agent 资产目录为空: {directory.name}")
    return files


def run_command(args: list[str], *, cwd: Path | None = None, timeout: int = 120, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        fail("command_timeout", "构建命令超时")
    if result.returncode != 0:
        fail("command_failed", clean(result.stderr or result.stdout))
    return result


def docker_inspect(reference: str) -> dict[str, Any]:
    result = run_command(["docker", "image", "inspect", reference], timeout=30)
    try:
        image = json.loads(result.stdout)[0]
    except Exception as error:
        fail("runtime_image_invalid", str(error))
    if not isinstance(image, dict) or not isinstance(image.get("Id"), str):
        fail("runtime_image_invalid", "Docker 未返回有效镜像元数据")
    return image


def base_image_for(runtime_kind: str) -> str:
    if runtime_kind == "mysql_lab":
        return "mysql:8.4"
    return os.environ.get("CASE_BUILDER_PYTHON_BASE_IMAGE", "python:3.13-slim")


def render_digits(alias: str) -> str:
    values = " UNION ALL ".join(f"SELECT {number} AS n" if number == 0 else f"SELECT {number}" for number in range(10))
    return f"({values}) AS {alias}"


def render_mysql_seed(contract: dict[str, Any]) -> str:
    database = require_string(contract.get("database"), "mysqlContract.database")
    row_count = contract.get("seed", {}).get("rowCount")
    distribution = contract.get("seed", {}).get("distribution")
    schema_sql = require_string(contract.get("schemaSql"), "mysqlContract.schemaSql")
    if not re.fullmatch(r"zhixing_dynamic_[a-f0-9]{12,64}", database) or not isinstance(row_count, int) or not 1_000 <= row_count <= 1_000_000:
        fail("request_invalid", "MySQL 案例契约无效")
    if distribution not in ("uniform", "skewed"):
        fail("request_invalid", "MySQL 种子分布无效")
    include_status = bool(re.search(r"\bstatus\b", schema_sql, re.IGNORECASE))
    digit_count = 6 if row_count > 100_000 else 5
    aliases = "abcdef"[:digit_count]
    digits = [render_digits(letter) for letter in aliases]
    sequence = " CROSS JOIN ".join(digits)
    number_expression = "(" + " + ".join(f"{letter}.n * {10 ** position}" for position, letter in enumerate(reversed(aliases))) + " + 1)"
    user_expression = f"MOD({number_expression} - 1, 20) + 1" if distribution == "skewed" else f"MOD({number_expression} - 1, 10000) + 1"
    if include_status:
        columns = "id, user_id, status, created_at, total_cents"
        values = f"{number_expression}, {user_expression}, CASE WHEN MOD(FLOOR(({number_expression} - 1) / 10000), 5) = 0 THEN 'PAID' ELSE 'PENDING' END, TIMESTAMP('2026-08-01 00:00:00') + INTERVAL MOD({number_expression} - 1, 86400) SECOND, MOD({number_expression}, 10000) + 100"
    else:
        columns = "id, user_id, created_at, total_cents"
        values = f"{number_expression}, {user_expression}, TIMESTAMP('2026-08-01 00:00:00') + INTERVAL MOD({number_expression} - 1, 86400) SECOND, MOD({number_expression}, 10000) + 100"
    return "\n".join(
        [
            f"CREATE DATABASE IF NOT EXISTS `{database}`;",
            f"USE `{database}`;",
            f"{schema_sql.rstrip(';')};",
            f"INSERT INTO orders ({columns}) SELECT {values} FROM {sequence} WHERE {number_expression} <= {row_count};",
        ]
    )


def write_mysql_context(request: dict[str, Any], context: Path) -> None:
    contract = request.get("mysqlContract")
    if not isinstance(contract, dict):
        fail("request_invalid", "MySQL 构建缺少服务端契约")
    context.mkdir(parents=True, exist_ok=True)
    (context / "init.sql").write_text(render_mysql_seed(contract), encoding="utf-8")
    (context / "Dockerfile").write_text(
        "FROM mysql:8.4\nCOPY init.sql /docker-entrypoint-initdb.d/001_zhixing.sql\n",
        encoding="utf-8",
    )


def write_python_context(context: Path) -> None:
    context.mkdir(parents=True, exist_ok=True)
    base_image = base_image_for("docker_workspace")
    (context / "Dockerfile").write_text(
        f"FROM {base_image}\n"
        "RUN pip install --no-cache-dir pytest==8.4.1\n"
        "WORKDIR /workspace\n",
        encoding="utf-8",
    )


def build_runtime_image(request: dict[str, Any], context: Path) -> tuple[str, str, dict[str, Any]]:
    build_id = require_string(request.get("buildId"), "buildId")
    attempt_id = require_string(request.get("attemptId"), "attemptId")
    environment = request.get("environment")
    if not isinstance(environment, dict):
        fail("request_invalid", "环境目录信息无效")
    runtime_kind = require_string(request.get("runtimeKind"), "runtimeKind")
    environment_key = require_string(environment.get("environmentKey"), "environment.environmentKey")
    environment_version = require_string(environment.get("environmentVersion"), "environment.environmentVersion")
    contract = request.get("mysqlContract") if runtime_kind == "mysql_lab" else None
    contract_fingerprint = contract.get("materializationFingerprint") if isinstance(contract, dict) else None
    source_hash = hashlib.sha256((REQUEST_PATH.read_bytes() + (context / "Dockerfile").read_bytes()).replace(b"\r\n", b"\n")).hexdigest()
    tag = f"zhixing-runtime-{hashlib.sha256(build_id.encode()).hexdigest()[:12]}-{hashlib.sha256(attempt_id.encode()).hexdigest()[:12]}:v1"
    labels = [
        "--label", f"zhixing.case-build={build_id}",
        "--label", f"zhixing.case-attempt={attempt_id}",
        "--label", "zhixing.protocol-version=1",
        "--label", "zhixing.resource-role=runtime_artifact",
        "--label", f"zhixing.runtime-kind={runtime_kind}",
        "--label", f"zhixing.environment-key={environment_key}",
        "--label", f"zhixing.environment-version={environment_version}",
        "--label", f"zhixing.runtime-source-digest=sha256:{source_hash}",
    ]
    if isinstance(contract_fingerprint, str):
        labels.extend(["--label", f"zhixing.mysql-contract-fingerprint={contract_fingerprint}"])
    run_command(["docker", "build", "--pull=false", "-t", tag, *labels, str(context)], timeout=600)
    image = docker_inspect(tag)
    digest = image["Id"]
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest, re.IGNORECASE):
        fail("runtime_image_invalid", "Docker 镜像 ID 不是 sha256 digest")
    reference = f"{tag}@{digest}"
    return digest, reference, image


def wait_for_mysql(container: str, password: str) -> None:
    for _ in range(45):
        result = subprocess.run(
            ["docker", "exec", "-e", f"MYSQL_PWD={password}", container, "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "--silent"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode == 0:
            return
        subprocess.run(["sleep", "1"], check=False)
    fail("mysql_preflight_timeout", "MySQL 运行时未能在限定时间内就绪")


def run_mysql_preflight(request: dict[str, Any], image_reference: str, image_digest: str) -> None:
    contract = request.get("mysqlContract")
    if not isinstance(contract, dict):
        fail("request_invalid", "MySQL 构建缺少服务端契约")
    database = require_string(contract.get("database"), "mysqlContract.database")
    query = require_string(contract.get("starterExplain"), "mysqlContract.starterExplain").replace("?", "1")
    reference_sql = require_string(contract.get("referenceSql"), "mysqlContract.referenceSql")
    container = f"zhixing-case-preflight-{hashlib.sha256(require_string(request.get('attemptId'), 'attemptId').encode()).hexdigest()[:16]}"
    password = secrets.token_urlsafe(24)
    labels = [
        "--label", f"zhixing.case-build={require_string(request.get('buildId'), 'buildId')}",
        "--label", f"zhixing.case-attempt={require_string(request.get('attemptId'), 'attemptId')}",
        "--label", "zhixing.protocol-version=1",
        "--label", "zhixing.resource-role=preflight",
    ]
    try:
        run_command(["docker", "run", "-d", "--rm", "--name", container, *labels, "-e", f"MYSQL_ROOT_PASSWORD={password}", image_reference], timeout=60)
        wait_for_mysql(container, password)
        explain = run_command(["docker", "exec", "-e", f"MYSQL_PWD={password}", container, "mysql", "-h", "127.0.0.1", "-uroot", "--database", database, "--batch", "--raw", "-e", f"EXPLAIN {query}"], timeout=30)
        if len(explain.stdout.strip().splitlines()) < 2:
            fail("mysql_preflight_failed", "初始 EXPLAIN 未返回数据")
        run_command(["docker", "exec", "-e", f"MYSQL_PWD={password}", container, "mysql", "-h", "127.0.0.1", "-uroot", "--database", database, "--batch", "--raw", "-e", reference_sql], timeout=30)
        verified = run_command(["docker", "exec", "-e", f"MYSQL_PWD={password}", container, "mysql", "-h", "127.0.0.1", "-uroot", "--database", database, "--batch", "--raw", "-e", f"EXPLAIN {query}"], timeout=30)
        if len(verified.stdout.strip().splitlines()) < 2:
            fail("mysql_preflight_failed", "参考索引后的 EXPLAIN 未返回数据")
    finally:
        subprocess.run(["docker", "rm", "-f", container], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


def run_python_preflight(request: dict[str, Any], starter: list[dict[str, str]], reference: list[dict[str, str]]) -> None:
    if not starter or not reference:
        fail("asset_missing", "Python 环境缺少 starter 或 reference 资产")
    root = WORKSPACE / ".python-preflight"
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    def materialize(items: list[dict[str, str]]) -> None:
        for item in items:
            target = root / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(item["content"], encoding="utf-8")

    materialize(starter)
    first = subprocess.run(["python3", "-m", "pytest", "-q"], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=120)
    if first.returncode == 0:
        fail("python_starter_did_not_fail", "Python starter 未产生预期失败")
    shutil.rmtree(root)
    root.mkdir(parents=True)
    materialize(starter)
    materialize(reference)
    second = subprocess.run(["python3", "-m", "pytest", "-q"], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=120)
    if second.returncode != 0:
        fail("python_reference_preflight_failed", clean(second.stderr or second.stdout))
    shutil.rmtree(root)


def openhands_task(request: dict[str, Any]) -> None:
    base_url = os.environ.get("CASE_BUILDER_LLM_BASE_URL", "")
    api_key = os.environ.get("CASE_BUILDER_LLM_API_KEY", "")
    model = os.environ.get("CASE_BUILDER_LLM_MODEL", "")
    if not base_url or not api_key or not model:
        fail("llm_not_configured", "OpenHands LLM 配置不完整")
    try:
        from pydantic import SecretStr
        from openhands.sdk import Conversation, LLM
        from openhands.tools.preset.default import get_default_agent
    except Exception as error:  # pragma: no cover - image dependency guard
        fail("sdk_unavailable", str(error))

    runtime_kind = require_string(request.get("runtimeKind"), "runtimeKind")
    environment = request.get("environment")
    card = request.get("card")
    diagnostic = request.get("repairDiagnostic")
    prompt = (
        "You are the isolated Zhixing environment build agent. Work only inside /workspace. "
        "Read /workspace/request.json, which is a server-frozen request. Never print or copy credentials, tokens, or secrets. "
        "Do not modify files outside /workspace and do not contact any public service except the configured LLM. "
        "Do not write /workspace/manifest.json; the deployment wrapper owns that file. "
        f"The runtime kind is {runtime_kind}; the environment is {json.dumps(environment, ensure_ascii=False)}. "
        f"The learner card is frozen in request.json: {json.dumps(card, ensure_ascii=False)[:12_000]}. "
    )
    if diagnostic:
        prompt += f"A previous independent preflight reported this safe diagnostic; repair it without changing the server contract: {json.dumps(diagnostic, ensure_ascii=False)}. "
    if runtime_kind == "docker_workspace":
        prompt += (
            "Create the public initial files under /workspace/starter and the private reference repair under /workspace/reference. "
            "Use only .py, .json, .md, or .txt files. The starter must fail the server-declared pytest check and the reference overlay must pass it. "
            "Run pytest against both states before finishing. Keep the reference solution minimal and do not place it in starter. "
        )
    else:
        prompt += (
            "This is a MySQL case. Read mysqlContract from request.json unchanged. "
            "Use the Docker CLI and MySQL client to validate the case-specific database, seed shape, initial EXPLAIN, and reference index in a temporary container. "
            "Do not alter schemaSql, faultSql, starterExplain, referenceSql, database, rowCount, distribution, or their fingerprint. "
            "You may write short non-secret notes under /workspace, but do not write credentials into files. "
        )
    prompt += "When the checks are complete, use the finish action and do not wait for human approval."

    model_reference = model
    if "/" not in model:
        provider = "deepseek" if "deepseek.com" in (urlparse(base_url).hostname or "") else "openai"
        model_reference = f"{provider}/{model}"
    try:
        llm = LLM(model=model_reference, api_key=SecretStr(api_key), base_url=base_url, timeout=300, num_retries=1)
        agent = get_default_agent(llm, cli_mode=True)
        conversation = Conversation(agent=agent, workspace=str(WORKSPACE), max_iteration_per_run=36, persistence_dir=str(WORKSPACE / ".openhands-state"), delete_on_close=True, visualizer=None)
        try:
            conversation.send_message(prompt)
            conversation.run()
        finally:
            conversation.close()
    except Exception as error:
        fail("agent_failed", clean(error))


def main() -> None:
    request = load_request()
    runtime_kind = require_string(request.get("runtimeKind"), "runtimeKind")
    if runtime_kind not in ("mysql_lab", "docker_workspace"):
        fail("request_invalid", "runtimeKind 不受支持")
    (WORKSPACE / "starter").mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "reference").mkdir(parents=True, exist_ok=True)
    openhands_task(request)
    starter = read_asset_files(WORKSPACE / "starter", required=runtime_kind == "docker_workspace")
    reference = read_asset_files(WORKSPACE / "reference", required=runtime_kind == "docker_workspace")
    if runtime_kind == "docker_workspace":
        run_python_preflight(request, starter, reference)
    context = WORKSPACE / "runtime-context"
    if context.exists():
        shutil.rmtree(context)
    if runtime_kind == "mysql_lab":
        write_mysql_context(request, context)
    else:
        write_python_context(context)
    digest, reference_image, image = build_runtime_image(request, context)
    if runtime_kind == "mysql_lab":
        run_mysql_preflight(request, reference_image, digest)
    environment = request["environment"]
    contract = request.get("mysqlContract") if runtime_kind == "mysql_lab" else None
    labels = {
        "zhixing.case-build": require_string(request.get("buildId"), "buildId"),
        "zhixing.case-attempt": require_string(request.get("attemptId"), "attemptId"),
        "zhixing.protocol-version": "1",
        "zhixing.resource-role": "runtime_artifact",
        "zhixing.runtime-kind": runtime_kind,
        "zhixing.runtime-image-digest": digest,
        "zhixing.environment-key": require_string(environment.get("environmentKey"), "environment.environmentKey"),
        "zhixing.environment-version": require_string(environment.get("environmentVersion"), "environment.environmentVersion"),
    }
    if isinstance(contract, dict):
        labels["zhixing.mysql-contract-fingerprint"] = require_string(contract.get("materializationFingerprint"), "mysqlContract.materializationFingerprint")
    manifest: dict[str, Any] = {
        "protocolVersion": 1,
        "runtimeKind": runtime_kind,
        "environment": {
            "key": labels["zhixing.environment-key"],
            "version": labels["zhixing.environment-version"],
            "baseImageDigest": docker_inspect(base_image_for(runtime_kind))["Id"],
            "runtimeImageDigest": digest,
            "runtimeImageRef": reference_image,
        },
        "starterFiles": starter,
        "referenceFiles": reference,
        "verification": {
            "commandKeys": request.get("successCriteria", {}).get("commandKeys", []),
            "successSignals": request.get("successCriteria", {}).get("successSignals", []),
        },
        "resources": [{"kind": "image", "id": digest, "name": reference_image.split("@", 1)[0], "role": "runtime_artifact", "labels": labels}],
    }
    if runtime_kind == "mysql_lab" and isinstance(contract, dict):
        manifest["mysql"] = {
            "contractFingerprint": require_string(contract.get("materializationFingerprint"), "mysqlContract.materializationFingerprint"),
            "initializationSql": [require_string(contract.get("schemaSql"), "mysqlContract.schemaSql"), require_string(contract.get("faultSql"), "mysqlContract.faultSql")],
            "starterExplain": require_string(contract.get("starterExplain"), "mysqlContract.starterExplain"),
            "referenceSql": [require_string(contract.get("referenceSql"), "mysqlContract.referenceSql")],
        }
    (WORKSPACE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
