# 知行 Docker Lab API

这是三个 MySQL 练习案例共用的受控执行服务。服务只连接平台预先提供的
MySQL 8，不在应用代码中创建、销毁或启动 Docker 容器，也不向浏览器暴露数据库端口。

本地开发提供 `docker-compose.local.yml`，它只负责启动一个独立的 MySQL
8.4 实例；这是部署层的显式操作，不是 API 启动行为。

## 案例与并发模型

- `mysql-order-list-index-001`：慢查询与联合索引，schema
  `zhixing_lab_slow`，单个 `default` 会话。
- `mysql-deadlock-lock-order-001`：死锁与锁等待，schema
  `zhixing_lab_deadlock`，`tx-a`/`tx-b` 两个可交错会话。
- `mysql-deep-pagination-001`：深分页优化，schema
  `zhixing_lab_pagination`，单个 `default` 会话。

三个案例各自有一个 slot，可以同时运行。同一案例只有一个 active run，
后续 run 按 FIFO 排队。活动 run 的 token 和 revision 会绑定到案例；用户每次
刷新 run、创建会话、执行 SQL 或 reset 都会记录活动。连续 5 分钟没有活动时，
后台 reaper 会结束 run、重置案例并提升下一张票据；reset 后 revision 增加，旧
token 不能继续访问。token 仍有 20 分钟最长生命周期。

## 部署前准备

1. 使用平台提供的 MySQL 8 管理连接，人工执行
   `migrations/001_zhixing_lab_schema.sql`。应用启动不会执行 migration 或 DDL。
2. 预先创建应用账号，并只授予 runner 对三个案例 schema 的
   `SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER` 权限。admin 账号只由 reset
   路径使用。账号密码只通过环境变量注入，不进入日志或 HTTP 响应。
3. 人工确认三个 schema 的 fixture version 都是 `2026-08-28.1`，再启动 API。

权限示例（由部署人员按平台账号策略执行，不由应用执行）：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER
ON `zhixing_lab_slow`.* TO 'zhixing_lab_runner'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER
ON `zhixing_lab_deadlock`.* TO 'zhixing_lab_runner'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER
ON `zhixing_lab_pagination`.* TO 'zhixing_lab_runner'@'%';
```

本地开发时先复制 `.env.example` 为 `.env`，填写本地密码。`LAB_RUN_IDLE_TIMEOUT_MS`
默认是 300000（5 分钟）；然后启动 MySQL
容器并等待 healthcheck 通过：

```bash
docker compose -f docker-compose.local.yml up -d mysql
docker compose -f docker-compose.local.yml ps
```

使用容器内置的 MySQL 客户端人工执行 migration（不会由应用启动自动执行）：

```bash
docker compose -f docker-compose.local.yml exec -T mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' \
  < migrations/001_zhixing_lab_schema.sql
```

之后按上文权限示例创建 runner/admin 账号，再启动 API：

```bash
npm install
npm run build
npm start
```

开发模式使用 `npm run dev`，本地默认监听 `127.0.0.1:3001`；前端 Vite
默认也代理到这个端口。若 API 使用其他端口，可通过 `LAB_API_PORT` 和
`VITE_API_PROXY_TARGET` 分别覆盖。
构建会把 TypeScript 输出到 `dist`；reset 脚本
运行时优先读取构建目录外的 `fixtures`，因此不会依赖应用启动时生成文件。

## HTTP 调用示例

创建 run：

```bash
curl -X POST http://127.0.0.1:3001/api/lab/runs \
  -H 'content-type: application/json' \
  -d '{"caseId":"mysql-order-list-index-001"}'
```

创建会话并执行 SQL 时，将创建响应中的 `accessToken` 放入 Bearer header，
并把返回的 run `revision` 原样提交。每次 execute 必须提供新的稳定
`clientRequestId`；相同 run 内重复提交同一 ID 会返回同一执行结果。

## 接口范围

实现了案例健康检查、run 创建/恢复/结束、空闲 run 回收、FIFO 票据查询/取消、命名会话、
单条 SQL 执行、reset 和回放快照路由。SQL 在路由层使用 MySQL AST 校验，
只允许当前案例表的查询、EXPLAIN、DML、事务命令和索引 DDL；多语句、跨
schema、表级 DDL、实例配置、文件/网络访问都会被拒绝。

执行结果最多返回 200 行和 1 MiB 原始输出。超时会销毁当前连接；同一会话
内串行执行，死锁案例的两个命名会话可以并发执行。

## 当前验收状态

```bash
npm test
npm run build
```

当前单元测试覆盖 SQL policy、FIFO slot、三案例并发、会话串行/交错、
幂等请求和 reset revision 隔离。真实 MySQL 集成测试仍需在平台指定的
MySQL 8 上执行，覆盖索引恢复、种子回灌、死锁形成、租约过期和权限配置。
回放快照接口目前返回 `replay_not_ready`，尚未声称具备离线兜底能力。

## SQL 性能边界

健康检查只访问每个固定案例的一行 fixture metadata，不做全量数据查询。
reset 会按案例删除并重新灌入固定数据，其中订单和事件各约 100,000 行；
这是恢复实验基线的必要成本，不是用户请求路径上的查询。真实环境验收时
仍应对 reset SQL 和索引恢复执行 `EXPLAIN`/耗时检查，并确认没有额外循环
查询或跨案例访问。
