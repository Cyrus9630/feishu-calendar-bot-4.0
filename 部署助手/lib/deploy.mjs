import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  buildEnvSetArgs,
  parseCreateApp,
  parseRelease,
  safeProjectDirectory,
} from './core.mjs';
import { runCommand } from './process.mjs';

const excludedTopLevel = new Set([
  '.git',
  'node_modules',
  'dist',
  '部署助手',
  '先打开我.html',
  '给Codex的一句话.txt',
  '双击开始部署-Windows.bat',
  '双击开始部署-macOS.command',
  '部署结果-不含密钥.md',
]);

export async function createMiaodaApp({ runner = runCommand, name = '飞书日程机器人' }) {
  const result = await runner(
    'lark-cli',
    [
      'apps',
      '+create',
      '--name',
      name,
      '--app-type',
      'full_stack',
      '--description',
      '飞书群内中文日程管理与提醒机器人',
      '--as',
      'user',
      '--json',
    ],
  );
  return parseCreateApp(result.stdout);
}

export async function initializeProject({ runner = runCommand, appId, destination }) {
  const target = await safeProjectDirectory(destination);
  await runner(
    'lark-cli',
    [
      'apps',
      '+init',
      '--app-id',
      appId,
      '--dir',
      target,
      '--template',
      'nestjs-react-fullstack',
      '--as',
      'user',
      '--json',
    ],
  );
  const gitDirectory = join(target, '.git');
  const stat = await lstat(gitDirectory).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error('妙搭项目初始化完成，但没有找到 Git 仓库，已停止复制源码。');
  }
  return target;
}

function normalizedRelative(source, path) {
  return relative(source, path).split(sep).join('/');
}

function shouldCopy(source, path) {
  const rel = normalizedRelative(source, path);
  if (!rel) return true;
  const top = rel.split('/')[0];
  return (
    !excludedTopLevel.has(top) &&
    !top.startsWith('部署结果-不含密钥') &&
    !rel.startsWith('release-work/')
  );
}

export async function copyShareSource({ source, destination }) {
  const gitDirectory = join(destination, '.git');
  const gitStat = await lstat(gitDirectory).catch(() => null);
  if (!gitStat?.isDirectory()) {
    throw new Error('目标不是本次新建的妙搭 Git 项目，已停止复制源码。');
  }

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const from = join(directory, entry.name);
      if (!shouldCopy(source, from)) continue;
      const rel = normalizedRelative(source, from);
      const to = join(destination, ...rel.split('/'));
      if (entry.isSymbolicLink()) {
        throw new Error(`分享包含符号链接，已停止复制：${rel}`);
      }
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        await visit(from);
      } else if (entry.isFile()) {
        await mkdir(join(to, '..'), { recursive: true });
        await copyFile(from, to);
      }
    }
  }

  await visit(source);
  return destination;
}

export async function setOnlineEnvironment({ runner = runCommand, appId, values }) {
  const written = [];
  for (const [key, rawValue] of Object.entries(values)) {
    const value = String(rawValue ?? '');
    if (key === 'FEISHU_ENCRYPT_KEY' && value === '') continue;
    await runner('lark-cli', buildEnvSetArgs(appId, key), {
      stdin: `${value}\n`,
      secrets: [value],
    });
    written.push(key);
  }
  return written;
}

export async function pushSource({ runner = runCommand, destination }) {
  await runner('git', ['add', '-A'], { cwd: destination });
  const status = await runner('git', ['status', '--porcelain'], { cwd: destination });
  if (status.stdout.trim()) {
    await runner(
      'git',
      [
        '-c',
        'user.name=日程机器人部署助手',
        '-c',
        'user.email=calendar-bot@local.invalid',
        'commit',
        '-m',
        'feat: deploy independent calendar bot',
      ],
      { cwd: destination },
    );
  }
  await runner('git', ['push', 'origin', 'HEAD:sprint/default'], { cwd: destination });
}

export async function publishAndWait({
  runner = runCommand,
  appId,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 18,
}) {
  const createdResult = await runner(
    'lark-cli',
    [
      'apps',
      '+release-create',
      '--app-id',
      appId,
      '--branch',
      'sprint/default',
      '--as',
      'user',
      '--json',
    ],
  );
  let release = parseRelease(createdResult.stdout);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (release.status === 'finished') {
      if (!release.onlineUrl) throw new Error('发布已完成，但没有返回 online_url。');
      return release;
    }
    if (release.status === 'failed') {
      throw new Error(`妙搭发布失败：${release.errorSummary || '请在妙搭发布记录中查看失败步骤。'}`);
    }
    if (release.status !== 'publishing') {
      throw new Error(`妙搭返回未知发布状态：${release.status}`);
    }
    await wait(20_000);
    const queriedResult = await runner(
      'lark-cli',
      [
        'apps',
        '+release-get',
        '--app-id',
        appId,
        '--release-id',
        release.releaseId,
        '--as',
        'user',
        '--json',
      ],
    );
    release = parseRelease(queriedResult.stdout);
  }
  throw new Error(`妙搭发布仍在进行（release_id: ${release.releaseId}），请稍后重试查询。`);
}
