#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { conciseError, selectNumberedItem, validateValue } from './lib/core.mjs';
import { discoverTargetsWithAuthorization, ensureLarkReady } from './lib/discovery.mjs';
import {
  copyShareSource,
  createMiaodaApp,
  initializeProject,
  publishAndWait,
  pushSource,
  setOnlineEnvironment,
} from './lib/deploy.mjs';
import { queryBotOpenId } from './lib/feishu.mjs';
import { commandAvailable, openExternal, runCommand } from './lib/process.mjs';

const helperRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(helperRoot, '..');
const packageParent = resolve(packageRoot, '..');

function heading(text) {
  process.stdout.write(`\n=== ${text} ===\n`);
}

function info(text) {
  process.stdout.write(`${text}\n`);
}

async function askLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function askSecret(prompt, { optional = false } = {}) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return (await askLine(prompt)).trim();
  }
  process.stdout.write(prompt);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePromise, rejectPromise) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) rejectPromise(error);
      else resolvePromise(value.trim());
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return finish(new Error('已取消部署，没有执行发布。'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          if (value) {
            value = Array.from(value).slice(0, -1).join('');
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          value += character;
          process.stdout.write('•');
        }
      }
    };
    process.stdin.on('data', onData);
    if (optional) process.stdout.write('');
  });
}

async function askValidated(key, prompt, { secret = false, optional = false } = {}) {
  for (;;) {
    try {
      const raw = secret ? await askSecret(prompt, { optional }) : await askLine(prompt);
      return validateValue(key, raw, { allowEmpty: optional });
    } catch (error) {
      if (String(error?.message).includes('安全退出')) throw error;
      info(`请检查：${conciseError(error)}`);
    }
  }
}

function showOptions(items) {
  for (const [index, item] of items.entries()) {
    info(`${index + 1}. ${item.name}（${item.detail}）`);
  }
}

async function askNumberedItem(items, prompt) {
  for (;;) {
    try {
      return selectNumberedItem(items, await askLine(prompt));
    } catch (error) {
      info(`请检查：${conciseError(error)}`);
    }
  }
}

export async function preflight({ runner = runCommand } = {}) {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  const node = major >= 22;
  const [git, larkCli] = await Promise.all([
    commandAvailable('git', runner),
    commandAvailable('lark-cli', runner),
  ]);
  return { node, nodeVersion: process.versions.node, git, larkCli };
}

function newProjectDestination() {
  const suffix = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return join(packageParent, `飞书日程机器人-我的部署-${suffix}`);
}

function reportText({ appId, destination, onlineUrl }) {
  const callbackUrl = `${onlineUrl.replace(/\/$/, '')}/api/feishu/event`;
  return `# 飞书日程机器人部署结果（不含密钥）

- 妙搭应用 ID：\`${appId}\`
- 本地项目目录：\`${destination}\`
- 线上地址：${onlineUrl}
- 飞书事件回调地址：${callbackUrl}

## 还需在飞书完成的五件事

1. 在权限管理中申请机器人消息、卡片交互和日历读写权限。
2. 在事件与回调中填写上面的回调地址，订阅 \`im.message.receive_v1\` 和 \`card.action.trigger\`。
3. 创建并发布一个飞书应用版本，让权限和事件配置在组织内生效。
4. 把机器人加入目标群。
5. 把目标日历以可编辑权限共享给应用或机器人，再发送一条测试日程。

本报告不含 App Secret、Verification Token、Encrypt Key 或环境变量值。
`;
}

export async function runWizard({ runner = runCommand, fetchImpl = fetch } = {}) {
  heading('飞书日程机器人部署助手');
  info('飞书 CLI 准备好后，其余步骤由向导自动完成。秘密不会保存到文件或日志。');

  heading('1 / 6  检查飞书 CLI');
  const checks = await preflight({ runner });
  if (!checks.node || !checks.git || !checks.larkCli) {
    const missing = [
      !checks.node && 'Node.js 22 或更高版本',
      !checks.git && 'Git',
      !checks.larkCli && 'lark-cli',
    ].filter(Boolean);
    throw new Error(`请先安装：${missing.join('、')}。详细方法见 README.md。`);
  }
  await ensureLarkReady({ runner });
  info('飞书 CLI 配置和用户授权正常。');

  heading('2 / 6  选择群聊和日历');
  info('正在读取当前飞书用户、最近群聊和可写日历...');
  const targets = await discoverTargetsWithAuthorization({ runner });
  const { appId: FEISHU_APP_ID, userOpenId: TARGET_OPEN_ID } = targets.identity;
  if (targets.chats.length === 0) {
    throw new Error('没有发现可用群聊。请确认飞书 CLI 已获得 im 权限，并且当前用户已经加入目标群。');
  }
  if (targets.calendars.length === 0) {
    throw new Error('没有发现可写日历。请确认飞书 CLI 已获得 calendar 权限，并准备一份 owner 或 writer 权限的日历。');
  }
  info('请选择机器人工作的群聊：');
  showOptions(targets.chats);
  const selectedChat = await askNumberedItem(targets.chats, `输入群聊编号（1-${targets.chats.length}）：`);
  info('请选择机器人读写的日历：');
  showOptions(targets.calendars);
  const selectedCalendar = await askNumberedItem(
    targets.calendars,
    `输入日历编号（1-${targets.calendars.length}）：`,
  );
  const CHAT_ID = selectedChat.id;
  const TARGET_CALENDAR_ID = selectedCalendar.id;

  heading('3 / 6  准备飞书应用密钥');
  const developerUrl = `https://open.feishu.cn/app/${FEISHU_APP_ID}`;
  info(`当前飞书应用：${FEISHU_APP_ID}`);
  info('正在打开飞书开放平台。请确认已启用“机器人”能力，并从“凭证与基础信息”复制密钥。');
  if (!await openExternal(developerUrl, runner)) info(`请在浏览器打开：${developerUrl}`);
  const FEISHU_APP_SECRET = await askValidated('FEISHU_APP_SECRET', '飞书 App Secret（输入时隐藏）：', { secret: true });
  const FEISHU_VERIFICATION_TOKEN = await askValidated(
    'FEISHU_VERIFICATION_TOKEN',
    '事件 Verification Token（输入时隐藏）：',
    { secret: true },
  );
  const FEISHU_ENCRYPT_KEY = await askValidated(
    'FEISHU_ENCRYPT_KEY',
    '事件 Encrypt Key（未启用加密可直接回车）：',
    { secret: true, optional: true },
  );
  info('正在校验飞书凭据并读取机器人 open_id...');
  const BOT_OPEN_ID = await queryBotOpenId({
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    fetchImpl,
  });

  heading('4 / 6  确认部署范围');
  info(`飞书应用：${FEISHU_APP_ID}`);
  info(`目标群：${selectedChat.name}`);
  info(`当前用户：${TARGET_OPEN_ID}`);
  info(`目标日历：${selectedCalendar.name}`);
  info(`机器人：${BOT_OPEN_ID}`);
  info('App Secret 和事件密钥已收到，但不会显示或写入文件。');
  const confirmation = (await askLine('确认无误请输入“开始部署”：')).trim();
  if (confirmation !== '开始部署') {
    throw new Error('输入内容不是“开始部署”，已安全退出，没有创建妙搭应用。');
  }

  const secrets = [FEISHU_APP_SECRET, FEISHU_VERIFICATION_TOKEN, FEISHU_ENCRYPT_KEY].filter(Boolean);
  heading('5 / 6  创建并发布妙搭应用');
  info('正在创建新的妙搭应用...');
  const { appId } = await createMiaodaApp({ runner });
  const destination = newProjectDestination();
  info('正在初始化全新的项目目录...');
  await initializeProject({ runner, appId, destination });
  info('正在复制脱敏源码...');
  await copyShareSource({ source: packageRoot, destination });
  info('正在安全写入线上环境变量...');
  await setOnlineEnvironment({
    runner,
    appId,
    values: {
      FEISHU_APP_ID,
      FEISHU_APP_SECRET,
      FEISHU_VERIFICATION_TOKEN,
      FEISHU_ENCRYPT_KEY,
      CHAT_ID,
      TARGET_OPEN_ID,
      TARGET_CALENDAR_ID,
      BOT_OPEN_ID,
      BOT_NAME: '日程机器人',
      TZ: 'Asia/Shanghai',
    },
  });
  info('正在推送源码...');
  await pushSource({ runner, destination });
  info('正在发布，通常需要约 2 分钟...');
  const release = await publishAndWait({ runner, appId });

  heading('6 / 6  完成飞书设置');
  const callbackUrl = `${release.onlineUrl.replace(/\/$/, '')}/api/feishu/event`;
  info(`线上地址：${release.onlineUrl}`);
  info(`飞书事件回调地址：${callbackUrl}`);
  info('正在打开飞书开放平台。请按部署结果文件完成权限、事件、版本发布、机器人入群和日历共享。');
  if (!await openExternal(developerUrl, runner)) info(`请在浏览器打开：${developerUrl}`);
  const reportName = `部署结果-不含密钥-${new Date().toISOString().slice(0, 10)}.md`;
  const reportPath = join(packageRoot, reportName);
  await writeFile(reportPath, reportText({ appId, destination, onlineUrl: release.onlineUrl }), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }).catch(async (error) => {
    if (error?.code !== 'EEXIST') throw error;
    const alternate = join(packageRoot, `部署结果-不含密钥-${Date.now()}.md`);
    await writeFile(alternate, reportText({ appId, destination, onlineUrl: release.onlineUrl }), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  });
  info('已生成一份不含密钥的部署结果文件。请按其中五项清单完成飞书设置。');
  secrets.fill('');
  return { appId, destination, onlineUrl: release.onlineUrl, callbackUrl };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    info('用法：双击包根目录的 Windows 或 macOS 部署入口。');
    info('安装者只需先准备飞书 CLI；向导会自动发现当前用户、群聊和可写日历。');
    info('秘密不会保存。也可以先打开 先打开我.html。');
    return;
  }
  if (args.includes('--check')) {
    const result = await preflight();
    if (args.includes('--json')) info(JSON.stringify(result));
    else info(`Node.js: ${result.node ? '正常' : '需要 22+'}；Git: ${result.git ? '正常' : '缺失'}；lark-cli: ${result.larkCli ? '正常' : '缺失'}`);
    if (!result.node || !result.git || !result.larkCli) process.exitCode = 1;
    return;
  }
  await runWizard();
}

function canonicalPath(value) {
  try {
    return realpathSync(value).normalize('NFC');
  } catch {
    return resolve(value).normalize('NFC');
  }
}

const isMain =
  process.argv[1] &&
  canonicalPath(fileURLToPath(import.meta.url)) === canonicalPath(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`\n部署未完成：${conciseError(error)}\n`);
    process.stderr.write('请按提示处理后重试，或者打开“给Codex的一句话.txt”让 Codex 协助。\n');
    process.exitCode = 1;
  });
}
