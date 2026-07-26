# Feishu Calendar Bot 4.0

**Manage Feishu calendar events with natural language.**

[中文部署说明](./README.md)

Feishu Calendar Bot 4.0 is a self-hosted full-stack project for Feishu and Miaoda. In an authorized Feishu group, a designated user can mention the bot and create, find, update, or cancel calendar events in ordinary language. Operations that change calendar data use interactive confirmation cards, and scheduled reminders run in the Asia/Shanghai time zone.

The current parser is designed for Chinese natural-language commands. This English README documents the project; it does not claim that English-language schedule parsing is supported.

Example commands:

- `@日程机器人 明天下午3点和客户开会一小时，提前30分钟提醒`
- `@日程机器人 我下周有什么安排`
- `@日程机器人 把周五的项目会改到下午4点`
- `@日程机器人 取消明天的体检`

This release accepts text instructions only and ignores image messages.

## Main features

- Natural-language calendar creation, search, update, and cancellation
- Batch events, recurring events, cross-day schedules, locations, colors, and reminders
- Candidate selection, conflict warnings, and interactive confirmation cards
- Daily agenda summary at 09:00 and next-morning reminder at 17:00
- A privacy-conscious operations dashboard for health, configuration, and recent activity
- Idempotent message and card processing, plus time-limited undo support

## Security and data boundary

Each deployment must use its own Feishu custom app, group, user identity, and calendar. Credentials are supplied through local or Miaoda environment variables and are not included in this repository. The bot only accepts text messages from the configured user in the configured group and only accesses the calendar explicitly granted to it.

Do not commit App Secrets, access tokens, Verification Tokens, Encrypt Keys, real group or user identifiers, logs, screenshots, or database exports.

## Requirements

- A Feishu account allowed to configure a custom app and use Miaoda
- A current authenticated `lark-cli`
- A target group chat
- A calendar shared with the bot or app identity with writer access

## Quick installation

The only software users need to prepare explicitly is the current [Feishu/Lark CLI](https://github.com/larksuite/cli). If it is not installed, run the official installer:

```bash
npx @larksuite/cli@latest install
```

Download and extract the latest 4.0 release, then run:

- Windows: `双击开始部署-Windows.bat`
- macOS: `双击开始部署-macOS.command`

The installer checks the CLI first. It then guides the user through Feishu configuration and login in the browser, detects the current user, lists available group chats and writable calendars for numbered selection, creates a new Miaoda application, writes online environment variables, uploads the source, and waits for the same release to finish.

Feishu requires the account owner to approve login, app permissions, event subscriptions, app publication, bot membership, and calendar sharing. The installer opens the relevant Feishu page and reduces these actions to the necessary confirmations. Because the public CLI deliberately masks stored secrets, the user must still paste the App Secret and Verification Token into hidden prompts; Encrypt Key is requested only when event encryption is enabled. Group IDs, user open IDs, calendar IDs, and Miaoda app IDs are discovered or created automatically.

The launchers also check the Node.js and Git runtime needed by the deployment process. A normal CLI installation environment already includes Node.js. On Windows, the launcher can invoke the system package source when Git is missing; on macOS, it opens the Apple command-line tools installer.

## Manual build and verification

```bash
npm ci
npm run type:check
npm test -- --runInBand
SKIP_ACTION_PLUGIN_INIT=true npm run build:prod
```

## Event callbacks

Configure the Feishu developer console to send events to:

```text
https://your-online-domain/api/feishu/event
```

Subscribe to:

- `im.message.receive_v1`
- `card.action.trigger`

Set the required values from `.env.example` in both the development and online environments. Keep secret values outside source control.

## Deployment acceptance

After publishing, verify the online dashboard, send a test creation command, confirm the card, and check the target calendar. Then test query, update, and cancellation. A successful build or release status alone does not prove that the bot can receive messages or write to the intended calendar.

For the complete step-by-step deployment guide, use the [Chinese README](./README.md).
