# P6 发布检查清单 —— 金丝雀滚动发布

> 目标：把 Wave 1 + Wave 2 的集成分支，以**金丝雀（备用端口）→ 正式切换 → 分阶段开启 Flag** 的方式发布，
> 每一步都有验证命令和回滚命令。参照 `docs/zhixing-completion-plan.md` §9 的发布顺序与本清单。
> 制定日期：2026-09-15。

## 0. 部署拓扑与端口分配

| 角色 | 生产 | 金丝雀 | 说明 |
| --- | --- | --- | --- |
| 后端 API（systemd） | `knowing-doing.service` → `:3001` | `knowing-doing-canary.service` → `:3002` | 同一个共享产品库 |
| 前端静态（nginx） | `:80` → `knowing-doing-current/frontend/dist` | `:8082` → `knowing-doing-canary/frontend/dist` | nginx 代理 `/api/` |
| 路径 | `current` 软链 → `releases/<commit>` | `canary` 软链 → `releases/<commit>` | 由部署脚本管理 |
| Workspace Runner | `docker compose` → `:3101` | 共享 | 金丝雀复用 |
| Case Builder Agent | `docker compose` → `:3102` | 共享 | 金丝雀复用（smoke 直接打 3102） |

共享数据：`/home/ubuntu/knowing-doing-data/zhixing-product.db`（迁移由任一部署写入，均为追加式）。
金丝雀**不开放 OAuth**：`config.ts` 将 `PUBLIC_ORIGIN` / OAuth 回调硬编码为生产主机，
因此真实 OAuth 在"分阶段开启 Flag"阶段于生产上验证（符合计划 P2 验收"受保护环境完成一次"）。

## 1. 发布前置（仓库侧，一次性）

- [ ] **1.1 合并并推送**
  ```bash
  git checkout codex/completion-integration
  git push origin codex/completion-integration
  # 确认无误后合并到 main 并推送
  git checkout main && git merge --no-ff codex/completion-integration -m "Release: completion wave 1+2 (P0-P5)"
  git push origin main
  ```
  记录推送后的 commit SHA（下称 `$SHA`）。

- [ ] **1.2 确认 CI 检查全绿**：`ci.yml` 的 Frontend / Backend / Workspace runner / Case Builder 四个检查 job 通过
  （构建 + 单测，它们不触发部署）。

- [ ] **1.3 暂停 CI 自动部署**（金丝雀先行，避免 CI 直接切生产）：
  - 在 GitHub → Settings → Secrets 中把 `DEPLOY_SSH_KEY` 置空（或临时改名），
    让 `Deploy to server` job 的 `if: env.DEPLOY_SSH_KEY != ''` 跳过。
  - 记录该 job 当前是否会自动部署，以便恢复。

- [ ] **1.4 服务器数据备份**（金丝雀会写共享库迁移，先留退路）：
  ```bash
  ssh <host> 'sqlite3 /home/ubuntu/knowing-doing-data/zhixing-product.db ".backup /home/ubuntu/knowing-doing-data/zhixing-product.db.pre-p6"'
  ssh <host> 'ls -l /home/ubuntu/knowing-doing-data/zhixing-product.db.pre-p6'
  ```

## 2. 金丝雀部署（备用端口 :3002 / :8082）

- [ ] **2.1 服务器暂存发布并启动金丝雀**（不触碰生产 symlink/systemd/nginx）：
  ```bash
  ssh <host> "ZHIXING_CANARY_ONLY=1 bash -s -- '$SHA'" < deploy/deploy-remote.sh
  ```
  脚本会：拉取归档 → 解压到 `releases/$SHA` → `npm ci && npm run build`（前后端）→
  `db:migrate`（共享库）→ 拉起共享 Docker → 把 `knowing-doing-canary` 指向 `releases/$SHA` →
  安装并启动 `knowing-doing-canary.service`（:3002）→ 健康检查 `GET :3002/api/product/runtime-status`。

- [ ] **2.2 安装金丝雀前端 nginx 块（:8082）**：
  ```bash
  ssh <host> 'sudo install -m 0644 /home/ubuntu/knowing-doing-current/deploy/nginx-canary.conf /etc/nginx/sites-enabled/canary && sudo nginx -t && sudo systemctl reload nginx'
  ```
  （`nginx-canary.conf` 已随发布进入 release 目录；也可直接 `scp deploy/nginx-canary.conf <host>:/tmp/`。）

## 3. 金丝雀验收（全部在 :3002 / :8082，flags 全关）

- [ ] **3.1 API 健康与会话引导**
  ```bash
  curl -fsS http://127.0.0.1:3002/api/product/runtime-status      # 预期 200
  curl -si http://127.0.0.1:3002/api/auth/session                  # 预期 401 session_required
  curl -si -c /tmp/canary.cookies -X POST http://127.0.0.1:3002/api/auth/session   # 预期 201，Set-Cookie + csrfToken
  ```

- [ ] **3.2 Planner 三轮基线与诊断**：浏览器打开 `http://119.45.243.102:8082`（用**独立浏览器 profile / 隐身窗口**，避免与生产同域 Cookie 混淆）
  → 建会话 → 对话到第 3 轮自动进入测评 → 答题 → 确认需求 → 生成路线。
  验证：进度显示"第 n/3 轮"；未确认需求时点"生成路线"应看到服务端 blockers / `409`。

- [ ] **3.3 PDF 上传解析**：在规划页上传一个真实可文本化的 PDF →
  等待状态流转 waiting → processing → complete（或可重试失败）；不出现供应商 task id / 下载 URL / 原始错误体。

- [ ] **3.4 Builder smoke**（直接打内部 Agent，端口无关，指向金丝雀发布目录）：
  ```bash
  ssh <host> 'cd /home/ubuntu/knowing-doing-canary/deploy && ZHIXING_APP_ROOT=/home/ubuntu/knowing-doing-canary bash run-case-builder-smoke.sh'
  ```
  预期：Python/MySQL 案例构建 → Manifest → 后端验证 → 受控 SQL 执行 → 租约回收，全部通过。

- [ ] **3.5 实践卡 / Mixed Gym 无来源降级**：生成一个实践卡，无 OAuth/来源时应正常产出"纯路线卡"
  （0 来源），不报错；Mixed Gym 入口按 `LEGACY_CASE_FLOW_ENABLED=true` 保持旧流程可用。

- [ ] **3.6 迁移核对**（金丝雀已写库）：
  ```bash
  ssh <host> 'sqlite3 /home/ubuntu/knowing-doing-data/zhixing-product.db "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 6; SELECT sql FROM sqlite_master WHERE name=\"planning_sessions\";"'
  ```
  预期：最新迁移含 `060_planning_sessions_baseline_three`、`064_oauth_state_learner_session`、`065_research_service`；
  `planning_sessions` 的 `baseline_turn_count` CHECK 为 `BETWEEN 0 AND 3`。

- [ ] **3.7 服务重启韧性**：`sudo systemctl restart knowing-doing-canary` 后再走一次 3.2 的一小段，
  确认恢复/重试路径正常（P1 的 `recoverFailedAssessment`）。

> 金丝雀全部通过才进入第 4 步；任一失败 → 见 §7 回滚，修复后重新金丝雀。

## 4. 正式切换（Promote）

- [ ] **4.1 恢复自动部署**：把 `DEPLOY_SSH_KEY` 恢复原值（CI 下次运行即走正式切换）。
- [ ] **4.2 触发正式部署**（两种任选其一）：
  - CI：`Actions` → 重新运行 Deploy workflow（或 push 一个空提交）；或
  - 服务器手动：`ssh <host> "bash -s -- '$SHA'" < deploy/deploy-remote.sh`（不带 `ZHIXING_CANARY_ONLY`）。
- [ ] **4.3 验证生产**
  ```bash
  curl -fsS http://127.0.0.1:3001/api/product/runtime-status
  curl -fsS -o /dev/null -w '%{http_code}\n' http://119.45.243.102/
  ssh <host> 'readlink /home/ubuntu/knowing-doing-current'   # 预期 .../releases/$SHA
  ```
- [ ] **4.4 清理金丝雀**（正式切换稳定后再清）
  ```bash
  ssh <host> 'sudo systemctl disable --now knowing-doing-canary; sudo rm -f /etc/nginx/sites-enabled/canary; sudo systemctl reload nginx; sudo rm -f /home/ubuntu/knowing-doing-canary'
  ```

## 5. 分阶段开启 Feature Flag（每步"改 var → 部署 → 验证 → 不合格回滚"）

Flag 以 **GitHub 仓库变量（Actions vars）** 为准：CI 部署会把它写进 `/etc/knowing-doing/backend.env`，
并用其中的 `VITE_*` 值**重新构建前端**（前端 UI 门禁是构建期嵌入的）。因此：
- 涉及前端门禁的 Flag（OAuth / Source sync / Practice Card V2 / Mixed Gym / Legacy）→ 走 CI 部署。
- 纯后端 Flag（`SIGNED_DEVICE_SESSION_ENABLED`、`ZHIHU_LOGIN_REQUIRED`、`ZHIHU_RESEARCH_ENABLED`、`PLANNER_ASSESSMENT_V2_ENABLED`）→
  可直接改服务器 `backend.env` + `systemctl restart knowing-doing`，但**务必随后同步回仓库变量**，否则下次 CI 部署会覆盖。

每步验证通过才进入下一步；任一步失败 → 仅回滚该步（见每步"回滚"行），其余已开 Flag 保持不变。

- [ ] **Step 1：`SIGNED_DEVICE_SESSION_ENABLED=true`**
  - 改仓库变量 → CI 部署（或 `ssh` 改 env + restart）。
  - 验证：`POST /api/auth/session` 返回 201 + `Set-Cookie`；带 Cookie 访问业务 API 200；无 Cookie 访问业务 API 401。
  - 回滚：置回 `false` → 部署/重启。生产 `identityMode` 回到 `shared_demo`。

- [ ] **Step 2：`ZHIHU_OAUTH_ENABLED=true`**（依赖 Step 1）
  - 前置：确认 `ZHIHU_OAUTH_APP_ID/APP_KEY/OAUTH_TOKEN_ENCRYPTION_KEY` 已配置且回调已在知乎侧注册
    （`http://119.45.243.102/api/auth/oauth/zhihu/callback`）。
  - 验证：**真实 OAuth smoke** —— 浏览器设置页发起连接 → 知乎授权 → 回调成功；`GET /api/auth/connections` 返回
    `connected`；两个不同知乎账号在两个浏览器中来源/路线/卡片完全隔离；
    重放/过期 OAuth state 返回 `oauth_state_invalid`。
  - 回滚：`ZHIHU_OAUTH_ENABLED=false` → 部署；已存在来源保持只读，Token 不外泄。

- [ ] **Step 3：`ZHIHU_LOGIN_REQUIRED=true`**（依赖 Step 2）
  - 验证：未登录访问业务 API → `session_required` / 路由回 `/auth`；登录后可完整走通。
  - 回滚：置回 `false`。

- [ ] **Step 4：`ZHIHU_SOURCE_SYNC_ENABLED=true` + `ZHIHU_RESEARCH_ENABLED=true`**（依赖 Step 2；RESEARCH 依赖 SOURCE_SYNC，校验已内置）
  - 验证：登录后收藏夹按 cursor 同步；生成实践卡时最多展示 **2 条真实来源**（`PracticeCardSources` 区域），
    不暴露全文/私有内容；无来源卡正常降级；重复生成同一计划单元不重复请求外部平台（幂等缓存）。
  - 回滚：任一 Flag 置回 `false`（RESEARCH 依赖 SOURCE_SYNC，先关 RESEARCH 再关 SOURCE_SYNC）。

- [ ] **Step 5：`PRACTICE_CARD_V2_ENABLED=true`**
  - 验证：新卡片为 V2 结构（`hints`/`references`/`explanations` 私有字段不落前端公开 DTO），题面不泄答案。
  - 回滚：置回 `false`。

- [ ] **Step 6：`MIXED_GYM_ENABLED=true`**（依赖 Step 5）
  - 验证：知识题两次尝试后进入 MySQL/Python Runtime；完成/反思/能力证据回写正常。
  - 回滚：置回 `false`，保留旧 Case Flow。

- [ ] **Step 7（观察期后）：关闭旧入口** `LEGACY_CASE_FLOW_ENABLED=false`
  - 仅在 Step 6 稳定观察一段时间后执行；验证旧案例入口不再展示，Gym 流程可用。
  - 回滚：置回 `true`。

## 6. 浏览器全链路验收（计划 §9 路径，正式环境）

```text
首次打开 → 登录/授权 → 上传 PDF 简历 → Planner 三轮内进入测评 → 分批回答、刷新、完成或放弃
→ 确认需求并生成路线 → 自动生成带来源的 Practice Card → 知识题两次尝试 → MySQL 或 Python Runtime
→ 反思、完成、能力证据回写 → 退出 → 旧 Cookie 失效(401)
```
逐项勾选，任一项失败按所属 Flag 回滚。

## 7. 回滚策略（计划 §9）

- 数据迁移**只追加/可恢复重建**，不删除历史学习证据（`zhixing-product.db.pre-p6` 备份兜底）。
- 任一外部能力故障 → 关闭对应 Flag，不影响既有路线和卡片读取。
- Builder 异常 → 关闭 `CASE_BUILDER_ENABLED`，回退 Legacy Case Flow。
- OAuth 异常 → 已存在来源保持只读，不从前端暴露或转发 Token；必要时 `ZHIHU_OAUTH_ENABLED=false`。
- 代码级快速回退：`ln -sfn releases/<旧SHA> knowing-doing-current && sudo systemctl restart knowing-doing`
  （迁移不回退，但旧代码对已迁移库兼容——这正是"先 flags 全关部署迁移"的目的）。

## 8. 收尾

- [ ] 更新 `docs/zhixing-identity-planner-zhihu-rollout.md` 与完成计划的状态标记。
- [ ] 确认 `deploy/backend.env.example`、仓库变量、`/etc/knowing-doing/backend.env` 三者一致。
- [ ] 清理金丝雀残留（§4.4）与 `.pre-p6` 备份之外不再需要的临时文件。
