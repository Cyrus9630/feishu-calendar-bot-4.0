# GitHub 首页口语化介绍实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 README 首页开头改成更口语的产品介绍，同时准确保留安装边界。

**架构：** 只修改 README 的首屏文案，不改动功能、安装器或后续部署手册。通过关键词检查、文风检查和差异审查验证文案完整性，再提交并推送到公开仓库。

**技术栈：** Markdown、Git、Node.js 文风检查脚本。

---

## 文件结构

- 修改：`README.md`，承担 GitHub 首页中文介绍和安装入口说明。
- 创建：`docs/superpowers/specs/2026-07-29-conversational-readme-intro-design.md`，记录用户确认的文案方向和事实边界。
- 创建：`docs/superpowers/plans/2026-07-29-conversational-readme-intro.md`，记录实施及验证步骤。

### 任务 1：修改 README 首页介绍

**文件：**
- 修改：`README.md:1`

- [x] **步骤 1：记录修改前关键词检查**

运行：

```bash
rg -n '能聊天就会用|会双击就能装|不需要记固定命令|不需要手工查找' README.md
```

预期：无匹配，命令退出状态为 1。

- [x] **步骤 2：替换首页首屏文案**

将原有一句式副标题和首段替换为以下内容：

```markdown
**能聊天就会用，会双击就能装。**

在飞书群里 @日程机器人，直接说“明天下午 3 点和客户开会”“把周五的项目会改到下午 4 点”即可，不需要记固定命令。机器人会根据你说的时间和事项，协助创建、查询、修改或取消日程；涉及写入或删除时，再通过交互卡片确认。

安装也不用先学部署。下载公开版并解压后，Windows 双击 `双击开始部署-Windows.bat`，macOS 双击 `双击开始部署-macOS.command`；登录飞书后，按编号选择群聊和可写日历即可，不需要手工查找群聊 ID、用户 open_id、日历 ID 或妙搭应用 ID。飞书要求账号本人完成的登录授权、应用权限、版本发布、机器人入群和日历共享仍需手工确认，其余部署步骤由向导完成。
```

- [x] **步骤 3：验证必需信息已经出现**

运行：

```bash
rg -n '能聊天就会用，会双击就能装|不需要记固定命令|不需要手工查找群聊 ID|仍需手工确认' README.md
```

预期：四组内容均在 README 前 20 行内匹配。

- [x] **步骤 4：运行 Markdown 文风检查**

运行：

```bash
node '/Users/aluo-1/Documents/Codex/2026-07-23/法律文风技能/skill/legal-writing-style/scripts/style-check.mjs' README.md
```

预期：命令成功完成；如果脚本提示旧版 README 中既存内容，人工确认本次新增段落没有绝对化、虚假穷尽或模型化表达。

- [x] **步骤 5：审查差异**

运行：

```bash
git diff --check
git diff -- README.md docs/superpowers
```

预期：`git diff --check` 无输出；差异仅包含已确认的首页文案、设计说明和实现计划。

- [x] **步骤 6：提交文案**

运行：

```bash
git add README.md docs/superpowers/specs/2026-07-29-conversational-readme-intro-design.md docs/superpowers/plans/2026-07-29-conversational-readme-intro.md
git commit -m "docs: simplify calendar bot introduction"
```

预期：生成一个文档提交，工作树恢复干净。

### 任务 2：发布并核验 GitHub 首页

**文件：**
- 修改：远端分支 `main`

- [ ] **步骤 1：将文档分支快进合并到 main**

运行：

```bash
git -C '/Users/aluo-1/Documents/GitHub私人源码/feishu-calendar-bot-4.0' merge --ff-only docs/conversational-readme
```

预期：本地 `main` 快进到新文档提交，不产生合并提交。

- [ ] **步骤 2：推送公开仓库**

运行：

```bash
git -C '/Users/aluo-1/Documents/GitHub私人源码/feishu-calendar-bot-4.0' push origin main
```

预期：`origin/main` 更新到新文档提交。

- [ ] **步骤 3：核验远端 README**

运行：

```bash
curl -fsSL 'https://raw.githubusercontent.com/Cyrus9630/feishu-calendar-bot-4.0/main/README.md'
```

预期：响应内容包含“能聊天就会用，会双击就能装”“不需要记固定命令”和“仍需手工确认”。
