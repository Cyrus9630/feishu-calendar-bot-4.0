# 飞书日程机器人 4.0

**能聊天就会用，会双击就能装。**

[English introduction](./README_EN.md)

用起来不用学指令。在飞书群里 @日程机器人，直接说“明天下午 3 点和客户开会”“把周五的项目会改到下午 4 点”即可，不需要记固定命令。机器人会根据你说的时间和事项，协助创建、查询、修改或取消日程；涉及写入或删除时，再通过交互卡片确认。

装起来也不用研究一串技术 ID。准备好飞书 CLI，下载公开版并解压后，Windows 双击 `双击开始部署-Windows.bat`，macOS 双击 `双击开始部署-macOS.command`；登录飞书后，按编号选择群聊和可写日历即可，不需要手工查找群聊 ID、用户 open_id、日历 ID 或妙搭应用 ID。飞书平台要求账号本人完成的登录授权、应用权限、版本发布、机器人入群和日历共享仍需手工确认，除此之外的部署步骤由向导完成。

例如：

- `@日程机器人 明天下午3点和客户开会一小时，提前30分钟提醒`
- `@日程机器人 我下周有什么安排`
- `@日程机器人 把周五的项目会改到下午4点`
- `@日程机器人 取消明天的体检`

飞书日程机器人 4.0 是一个可以独立部署的妙搭全栈项目，日程提醒按中国标准时间执行。

本项目仅处理文字日程指令，不处理图片消息。每个部署者必须使用自己的飞书企业自建应用、目标群、用户和日历；源码包不包含原作者的账号、密钥、日志或运行数据。

## 核心能力

- 自然语言创建、查询、修改和取消日程；
- 支持批量日程、重复日程、跨日时间、地点、颜色和提醒设置；
- 候选日程选择、冲突提示和交互卡片确认；
- 每日 09:00 当日日程汇总和 17:00 次日早间提醒；
- 运行状态、环境变量完整性和最近操作的脱敏看板；
- 消息幂等、卡片回调幂等和有限时间内的一键撤销。

## 适用边界

机器人只处理指定用户在指定群内发送的 @文字消息，并只读写已明确授权给机器人的目标日历。部署前必须配置飞书应用权限、事件回调、日历编辑权限和妙搭环境变量。公开源码不等于共享任何现成账号或线上实例。

---

以下为完整部署说明。

## 快速安装

安装者只需先准备好[飞书 CLI](https://github.com/larksuite/cli)，不需要自己创建妙搭项目，也不需要查找群聊 ID、用户 open_id、日历 ID或妙搭应用 ID。

尚未安装飞书 CLI 时，在终端运行官方安装命令：

```bash
npx @larksuite/cli@latest install
```

安装完成后：

1. 从 GitHub Release 下载 4.0 公开版源码压缩包并解压；
2. Windows 双击 `双击开始部署-Windows.bat`；macOS 双击 `双击开始部署-macOS.command`，首次被系统拦截时右键选择“打开”；
3. 飞书 CLI 尚未完成配置或登录时，根据自动打开的浏览器页面登录并授权；
4. 从向导列出的群聊和可写日历中输入编号选择，不需要复制任何技术 ID；
5. 在自动打开的飞书应用页面复制 App Secret、Verification Token，并在启用事件加密时复制 Encrypt Key；这些内容通过隐藏输入接收；
6. 核对群聊和日历名称，输入一次“开始部署”；向导将自动创建妙搭应用、设置线上变量、上传源码并等待发布；
7. 按向导自动打开的飞书页面完成权限、事件订阅、应用版本发布、机器人入群和日历共享。

飞书要求账号本人确认登录授权、应用权限和版本发布，安装器不会绕过这些确认。除这些平台必要操作外，安装器负责其余部署步骤。App Secret、Verification Token 和 Encrypt Key 不会写入源码、说明文件、命令参数或部署报告。

如果自动安装没有完成，可以把整个解压文件夹拖进 Codex，再发送 `给Codex的一句话.txt` 中的内容。后面的详细手册主要用于故障排查，正常快速安装通常不需要手工执行命令。

## 一、你会得到什么

部署成功后，群成员可以通过 @机器人发送中文文字日程指令。机器人能够创建、查询、修改和取消日程，处理确认卡片，并按中国标准时间推送日程提醒。云端管理页用于查看健康状态和脱敏后的最近操作，不提供直接修改日程的按钮。

本包不包含 Windows 日程悬浮窗。

## 二、准备条件

开始前准备：

1. 已安装的当前版本飞书 CLI；
2. 一个能够配置企业自建应用并使用妙搭的飞书账号；
3. 一个专门用于测试的飞书群；
4. 一份当前用户具有 `owner` 或 `writer` 权限、愿意授权给机器人的日历。

快速安装入口会检查 Node.js 和 Git。在正常的飞书 CLI 安装环境中，安装者通常不需要单独处理；Windows 缺少 Git 时入口会尝试调用系统软件源安装，macOS 缺少 Git 时会调起 Apple 命令行工具安装提示。

需要手工排查时，先确认 CLI 已登录：

```bash
lark-cli auth status --json --verify
```

未登录时，按 CLI 给出的验证链接完成用户授权。不要把授权链接、验证码或令牌转发给无关人员。

## 三、创建接收者自己的妙搭应用

创建一个新的全栈应用，并保存返回的 `app_...` 妙搭应用 ID：

```bash
lark-cli apps +create --name "飞书日程机器人" --app-type full_stack \
  --description "飞书群内中文日程管理与提醒机器人" --as user
```

把新应用初始化到一个新的空目录：

```bash
lark-cli apps +init --app-id app_your_miaoda_app_id \
  --dir ./feishu-calendar-bot-app --template nestjs-react-fullstack --as user
```

保留新目录里的 `.git` 和远程仓库配置。将本源码包根目录下的文件复制到该目录，替换新建应用的默认脚手架文件。只在这个新建应用目录中操作，不要覆盖已有业务项目。

进入新应用目录后执行：

```bash
npm ci
npm run type:check
npm test -- --runInBand
SKIP_ACTION_PLUGIN_INIT=true npm run build:prod
```

四项均成功后再继续。

## 四、创建飞书企业自建应用

在[飞书开放平台](https://open.feishu.cn/app)创建企业自建应用，并启用“机器人”能力。应用机器人与群自定义 Webhook 机器人不是同一种产品；本项目必须使用能够接收消息事件的应用机器人。

在权限管理中根据实际功能申请下列能力：

- 接收群内 @机器人的文字消息；
- 以应用身份发送、回复和更新群消息及交互卡片；
- 读取日历和日程；
- 创建、修改和删除日程；
- 获取用户 open_id 所需的最小通讯录字段权限。

权限页面显示的中文名称和 scope 可能随飞书版本调整，应以接收者后台当期页面和接口报错给出的缺失权限为准。飞书官方说明：[消息 API 与接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/introduction?lang=zh-CN)、[日历访问控制](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/calendar-v4/calendar-acl/create)。

权限和事件配置修改后，需要创建并发布一个飞书应用版本才能对组织内用户生效。

## 五、准备日历和标识

你需要准备以下值：

| 变量 | 含义 | 获取提示 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 飞书企业自建应用 App ID | 开放平台“凭证与基础信息” |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | 同上；只写入妙搭秘密环境变量 |
| `CHAT_ID` | 目标群 chat_id | 从群信息或消息事件中取得 |
| `TARGET_OPEN_ID` | 日历所属用户 open_id | 从消息事件或通讯录接口取得 |
| `TARGET_CALENDAR_ID` | 机器人实际读写的日历 ID | 从日历列表/日历信息接口取得 |
| `BOT_OPEN_ID` | 应用机器人的 open_id | 机器人信息或接收消息事件中的 mention |
| `BOT_NAME` | 群内显示名称 | 建议填“日程机器人” |
| `FEISHU_VERIFICATION_TOKEN` | 事件 Verification Token | 开放平台“事件与回调”配置 |
| `FEISHU_ENCRYPT_KEY` | 事件 Encrypt Key | 开启事件加密时必填 |

把应用机器人加入目标群，并确保它可以在群内发言。把目标日历共享给应用/机器人对应身份并授予 `writer`（编辑者）权限；只有普通查看权限时，健康检查可能通过读取但无法创建或修改日程。

## 六、配置妙搭环境变量

参考包内 `.env.example`，在妙搭应用的 dev 和 online 环境分别设置变量。不要把真实值写入 `.env.example`，也不要提交 `.env` 或 `.env.local`。

可以在妙搭管理页中逐项填写，也可以用 CLI。使用 CLI 设置 online 环境属于真实写入，确认应用 ID 和变量名后再执行；秘密值优先从仅本机保存的文件读取，避免出现在命令历史中：

```bash
lark-cli apps +env-set --app-id app_your_miaoda_app_id \
  --environment online --key FEISHU_APP_SECRET --value @./app-secret.txt --yes
```

对 `.env.example` 中每个变量分别设置。查询是否已经配置时不要显示 value：

```bash
lark-cli apps +env-list --app-id app_your_miaoda_app_id \
  --environment online --as user
```

## 七、配置事件与回调

本项目使用妙搭云端公开路由接收飞书事件。发布一次妙搭应用取得 online URL 后，在飞书开放平台“事件与回调”中选择“将事件发送至开发者服务器”，把请求地址设置为：

```text
https://your-online-domain/api/feishu/event
```

至少订阅：

- 接收消息：`im.message.receive_v1`；
- 卡片交互回调：`card.action.trigger`。

事件验证使用 `FEISHU_VERIFICATION_TOKEN`；如后台开启加密策略，同时设置 `FEISHU_ENCRYPT_KEY`。官方说明：[接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/introduction?lang=zh-CN)、[事件/回调安全校验](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview)。

## 八、提交源码并发布妙搭

在接收者自己的妙搭源码目录检查变更，提交到 `sprint/default` 并推送：

```bash
git status --short
git add .
git commit -m "feat: deploy independent calendar bot"
git push origin sprint/default
```

发起妙搭发布：

```bash
lark-cli apps +release-create --app-id app_your_miaoda_app_id --as user
```

保存返回的 `release_id`，然后查询同一次发布：

```bash
lark-cli apps +release-get --app-id app_your_miaoda_app_id \
  --release-id release_your_release_id --as user
```

只有状态为 `finished` 才表示本轮源码已经上线；`publishing` 需要稍后继续查询，`failed` 应按 `error_logs` 修复。妙搭应用的编辑/管理地址不能代替这次发布返回的 `online_url`。

## 九、验收

按以下顺序测试：

1. 登录妙搭 online URL，确认“日程机器人运行面板”能打开；
2. 调用或打开健康检查，确认凭据、消息监听、日历和定时任务没有缺项；
3. 在目标群发送：`@日程机器人 明天下午3点 测试日程 30分钟`；
4. 在确认卡片中确认创建；
5. 到目标日历检查标题、日期、时间和颜色；
6. 再发送查询、修改和取消测试，确认都只作用于接收者自己的日历；
7. 测试结束后，在群内通过机器人确认取消测试日程。

## 十、常见问题

### 机器人收不到消息

确认应用已经发布版本、机器人已加入目标群、订阅了 `im.message.receive_v1`，并核对 `BOT_OPEN_ID`、`CHAT_ID`。只开消息发送权限不能让机器人接收事件。

### 机器人能回复但不能创建日程

确认 `TARGET_CALENDAR_ID` 属于预期日历，并且机器人/应用身份对该日历拥有 `writer` 权限。若返回 `no calendar access_role`，应修复日历共享关系，而不是反复更换密钥。

### 卡片按钮没有反应

确认配置了 `card.action.trigger` 回调，Verification Token 与 Encrypt Key 和飞书后台一致，且回调地址使用当前发布的 online 域名。

### 发布后仍是旧版本

确认源码已经提交并推送到远端 `sprint/default`；妙搭发布读取的是远端分支，不是本地未提交文件。必须以本次 `release_id` 查询结果为准。

## 十一、安全约定

- 不要向任何人发送 App Secret、访问令牌、Verification Token、Encrypt Key 或验证码；
- 不要把 `.env`、`.env.local`、日志、二维码和数据库导出加入 Git 或分享包；
- 管理看板只应开放给应用管理员或明确的组织范围；
- 群、用户和日历 ID 虽不是密码，也属于组织标识，不应发布到公开仓库；
- 收到权限不足时按最小权限补齐，不要为了省事开通无关的全部权限。
