# 迁移与恢复手册

覆盖三个场景：**整机迁移**（换服务器）、**从每日备份恢复**（灾难恢复）、**Docker 部署迁移**。
最后附恢复演练记录与复检方法。

## 0. 这套部署由什么组成

| 组件 | 位置 | 在 git 里？ | 迁移方式 |
|------|------|------------|----------|
| 代码 | 项目目录 | ✅ | `git clone` |
| `config.env` | 项目目录 | ❌（含网页登录密码） | 随备份走 / 手工拷贝 |
| `data/` | 项目目录 | ❌（全部会话与消息） | 随备份走 / 手工拷贝 |
| 中转与模型配置 | 服务用户 `~/.claude/settings.json` | ❌（**含中转令牌**） | 单独拷贝或到新机用 ⚙ 面板重配 |
| CLI 本机会话 transcript | `~/.claude/projects/` | ❌ | 需要 `/resume` 导入历史的话一并拷 |
| systemd 单元 | `/etc/systemd/system/claude-phone.service` | 例子在 `systemd/*.example` | 用 `install-service.sh` 重新生成 |
| 每日备份组件 | `/usr/local/bin/claude-phone-backup` + timer 单元 | 例子在 `bin/backup.sh` + `systemd/*.example` | 到新机重装（见 2.6） |
| Caddy 站点（TLS + BasicAuth） | `/etc/caddy/` | ❌ | 拷配置或重建；密码哈希用 `bin/sync-caddy-auth.sh` 重新生成 |

> 关键认知：**每日备份只含 `data/` + `config.env`**。中转令牌在 `~/.claude/settings.json`
> 里，不在备份里——恢复后还要单独恢复中转配置（拷 `~/.claude` 或 ⚙ 面板重填）。

## 1. 新机前置条件

- Node.js ≥ 18（本项目零 npm 依赖，装好 Node 即可）
- Claude Code CLI：`npm install -g @anthropic-ai/claude-code`
- 可选：Caddy（对外 TLS + BasicAuth）；纯内网/隧道访问可不装

## 2. 场景 A：整机迁移（裸机 → 裸机）

```bash
# ── 旧机 ──
sudo systemctl stop claude-phone          # 停写，保证数据一致
cd <项目目录>
tar -czf /tmp/cp-move.tar.gz data config.env
tar -czf /tmp/claude-home.tar.gz -C ~ .claude   # 中转配置 + CLI transcript（含令牌，妥善传输）

# ── 传输（示例 scp，注意两个包都含敏感内容）──
scp /tmp/cp-move.tar.gz /tmp/claude-home.tar.gz 新机:/tmp/

# ── 新机 ──
git clone <本仓库> && cd claude-phone
tar -xzf /tmp/cp-move.tar.gz              # 还原 data/ + config.env
tar -xzf /tmp/claude-home.tar.gz -C ~     # 还原 ~/.claude
chmod 600 config.env
sudo ./install-service.sh                 # 生成并启用 systemd 单元
```

装完检查三件事：

1. **单元里必须有 `KillMode=process`**（`systemctl cat claude-phone | grep KillMode`）。
   没有它，重启服务会连带杀死后台任务——旧版本单元没这一行，务必确认。
2. `config.env` 里 `WORK_DIR`、`CLAUDE_BIN` 的路径在新机是否仍然成立。
3. `data/hook-settings.json` **不用带也不用改**——服务每次启动按当前环境重新生成。

对外访问（可选）：迁 Caddy 配置或重建站点，DNS 切到新机 IP；
BasicAuth 与网页共用密码，改动用 `./bin/sync-caddy-auth.sh` 同步。

每日备份组件重装：

```bash
sudo cp bin/backup.sh /usr/local/bin/claude-phone-backup
sudo chmod +x /usr/local/bin/claude-phone-backup
# 按需修改 example 里的路径（CLAUDE_PHONE_DIR 指向新机项目目录）
sudo cp systemd/claude-phone-backup.service.example /etc/systemd/system/claude-phone-backup.service
sudo cp systemd/claude-phone-backup.timer.example   /etc/systemd/system/claude-phone-backup.timer
sudo systemctl daemon-reload && sudo systemctl enable --now claude-phone-backup.timer
```

验证清单（迁移和恢复通用）：

```bash
systemctl status claude-phone --no-pager          # active (running)
curl -su 用户:密码 http://127.0.0.1:7681/api/health # ok:true
CLI_PROBE_MODEL=<网页在用的模型 id> node bin/cli-probe.js   # CLI 契约探针
# 最后：手机打开网页发一条消息冒烟
```

> 中转按模型分账号池，探针必须用 `CLI_PROBE_MODEL` 指定你实际在用的模型才有代表性
> （详见 README「升级 Claude Code CLI」一节）。

## 3. 场景 B：从每日备份恢复（灾难恢复）

备份在 `/var/backups/claude-phone/claude-phone-<日期>.tar.gz`（每天 04:12，留 14 天，600 权限）。
**先把备份拷到机器外才谈得上灾难恢复**——同盘备份只防误删，不防整机丢失。

```bash
# 新机完成上面第 1 节前置 + git clone 后：
cd claude-phone
tar -xzf /path/to/claude-phone-<日期>.tar.gz    # 展开出 data/ 和 config.env
chmod 600 config.env
# 中转配置不在备份里：拷旧机 ~/.claude，或先启动后在 ⚙ 面板重填中转 URL/令牌
sudo ./install-service.sh
```

然后跑上一节的验证清单。

**令牌处置**：备份包里有网页登录密码和全部对话内容。若备份文件曾经过不受控的
渠道（网盘、邮件、他人机器），视为泄露：改 `config.env` 的 `AUTH_PASS`（并跑
`bin/sync-caddy-auth.sh`），中转令牌若一并迁移过也建议在中转后台轮换。

## 4. 场景 C：Docker 部署迁移

带走三样：`./data`、`config.env`、`claude-home` 卷（中转配置在卷里）。

```bash
# 旧机导出 claude-home 卷
docker run --rm -v claude-phone_claude-home:/src -v /tmp:/out alpine \
  tar -czf /out/claude-home.tar.gz -C /src .
# 新机导入
docker volume create claude-phone_claude-home
docker run --rm -v claude-phone_claude-home:/dst -v /tmp:/in alpine \
  tar -xzf /in/claude-home.tar.gz -C /dst
# ./data 和 config.env 直接拷目录，然后
docker compose up -d --build      # 国内网络加速见 docker/README.md
```

注意事项见 `docker/README.md`：宿主 systemd 实例与容器**不要共用**同一个 `./data`。

## 5. 恢复演练记录

**2026-07-26 已完成一次真实演练**：取当日备份解包到临时目录，验证
`config.env` 完整、`sessions.json` 可解析且 8 个会话与线上一致、8 个消息文件
齐全、抽样消息文件逐行 JSON 可解析；演练目录含敏感内容，验证后即销毁。

建议每季度重复一次（约 1 分钟）：

```bash
sudo sh -c '
set -e
D=$(mktemp -d); chmod 700 "$D"
tar -xzf "$(ls -t /var/backups/claude-phone/*.tar.gz | head -1)" -C "$D"
test -f "$D/config.env"
python3 -c "import json;print(\"会话数:\",len(json.load(open(\"$D/data/sessions.json\"))))"
ls "$D/data/messages" | wc -l
rm -rf "$D"; echo "演练通过，临时目录已销毁"
'
```
