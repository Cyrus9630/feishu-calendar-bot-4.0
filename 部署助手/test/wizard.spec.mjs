import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildEnvSetArgs,
  parseCreateApp,
  parseRelease,
  redactSecrets,
  safeProjectDirectory,
  validateValue,
} from '../lib/core.mjs';
import { queryBotOpenId } from '../lib/feishu.mjs';
import {
  copyShareSource,
  publishAndWait,
  setOnlineEnvironment,
} from '../lib/deploy.mjs';

test('校验接收者标识但不接受示例或猜测值', () => {
  assert.equal(validateValue('FEISHU_APP_ID', 'cli_ab12'), 'cli_ab12');
  assert.equal(validateValue('CHAT_ID', 'oc_ab12'), 'oc_ab12');
  assert.equal(validateValue('TARGET_OPEN_ID', 'ou_ab12'), 'ou_ab12');
  assert.equal(
    validateValue('TARGET_CALENDAR_ID', 'example@group.calendar.feishu.cn'),
    'example@group.calendar.feishu.cn',
  );
  assert.throws(() => validateValue('CHAT_ID', 'wrong'), /chat_id/);
  assert.throws(() => validateValue('TARGET_OPEN_ID', '?'), /安全退出/);
});

test('秘密遮盖与 CLI JSON 解析只返回必要字段', () => {
  assert.equal(redactSecrets('x=secret-123', ['secret-123']), 'x=***');
  assert.deepEqual(
    parseCreateApp('{"data":{"app":{"app_id":"app_123"}}}'),
    { appId: 'app_123' },
  );
  assert.deepEqual(
    parseRelease('{"data":{"release_id":"release_123","status":"publishing"}}'),
    { releaseId: 'release_123', status: 'publishing', onlineUrl: '' },
  );
  assert.deepEqual(
    parseRelease('{"data":{"release":{"release_id":"release_123","status":"finished","online_url":"https://example.invalid"}}}'),
    {
      releaseId: 'release_123',
      status: 'finished',
      onlineUrl: 'https://example.invalid',
    },
  );
});

test('妙搭秘密环境变量使用标准输入而不是命令参数', () => {
  const args = buildEnvSetArgs('app_123', 'FEISHU_APP_SECRET');
  assert.deepEqual(args, [
    'apps',
    '+env-set',
    '--app-id',
    'app_123',
    '--environment',
    'online',
    '--key',
    'FEISHU_APP_SECRET',
    '--value',
    '-',
    '--yes',
    '--as',
    'user',
    '--json',
  ]);
  assert.equal(args.includes('secret-value'), false);
});

test('只能使用不存在的新项目目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calendar-wizard-'));
  const fresh = join(root, 'new-project');
  assert.equal(await safeProjectDirectory(fresh), fresh);
  await mkdir(fresh);
  await assert.rejects(() => safeProjectDirectory(fresh), /已经存在/);
});

test('自动查询机器人 open_id，且错误不包含 App Secret', async () => {
  const calls = [];
  const secret = 'secret-never-print';
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/tenant_access_token/internal')) {
      return {
        ok: true,
        json: async () => ({ code: 0, tenant_access_token: 'tenant-token' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ code: 0, bot: { open_id: 'ou_bot123' } }),
    };
  };

  assert.equal(
    await queryBotOpenId({ appId: 'cli_ab12', appSecret: secret, fetchImpl }),
    'ou_bot123',
  );
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.headers.Authorization, /^Bearer /);

  const failingFetch = async () => ({
    ok: true,
    json: async () => ({ code: 10003, msg: `bad ${secret}` }),
  });
  await assert.rejects(
    () => queryBotOpenId({ appId: 'cli_ab12', appSecret: secret, fetchImpl: failingFetch }),
    (error) => !error.message.includes(secret) && error.message.includes('***'),
  );
});

test('测试夹具不会把秘密写入临时文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calendar-wizard-fixture-'));
  const path = join(root, 'report.md');
  await writeFile(path, '# 部署结果\n不含配置值\n', 'utf8');
  assert.doesNotMatch(await readFile(path, 'utf8'), /secret-never-print/);
});

test('复制源码时保留新项目 Git 并排除部署工具和缓存', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calendar-wizard-copy-'));
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  await mkdir(join(source, 'server'), { recursive: true });
  await mkdir(join(source, '.git'), { recursive: true });
  await mkdir(join(source, '部署助手'), { recursive: true });
  await mkdir(join(source, 'node_modules'), { recursive: true });
  await mkdir(join(destination, '.git'), { recursive: true });
  await writeFile(join(source, 'server', 'app.ts'), 'export {}\n');
  await writeFile(join(source, '.git', 'source-only'), 'no');
  await writeFile(join(source, '部署助手', 'cli.mjs'), 'no');
  await writeFile(join(source, 'node_modules', 'cache'), 'no');
  await writeFile(join(source, '先打开我.html'), 'no');
  await writeFile(join(destination, '.git', 'config'), 'preserve');

  await copyShareSource({ source, destination });

  assert.equal(await readFile(join(destination, 'server', 'app.ts'), 'utf8'), 'export {}\n');
  assert.equal(await readFile(join(destination, '.git', 'config'), 'utf8'), 'preserve');
  await assert.rejects(() => readFile(join(destination, '部署助手', 'cli.mjs')));
  await assert.rejects(() => readFile(join(destination, 'node_modules', 'cache')));
  await assert.rejects(() => readFile(join(destination, '先打开我.html')));
});

test('线上环境变量逐项通过标准输入写入', async () => {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: '{"code":0}', stderr: '' };
  };
  await setOnlineEnvironment({
    runner,
    appId: 'app_123',
    values: {
      FEISHU_APP_ID: 'cli_ab12',
      FEISHU_APP_SECRET: 'secret-value',
      FEISHU_ENCRYPT_KEY: '',
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.stdin, 'secret-value\n');
  assert.equal(calls[1].args.includes('secret-value'), false);
  assert.equal(JSON.stringify(calls).includes('"stdin":"secret-value\\n"'), true);
});

test('发布轮询只在 finished 时返回线上地址', async () => {
  const outputs = [
    '{"data":{"release_id":"release_1","status":"publishing"}}',
    '{"data":{"release":{"release_id":"release_1","status":"publishing"}}}',
    '{"data":{"release":{"release_id":"release_1","status":"finished","online_url":"https://bot.example"}}}',
  ];
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    return { code: 0, stdout: outputs.shift(), stderr: '' };
  };
  let waits = 0;
  const result = await publishAndWait({
    runner,
    appId: 'app_123',
    wait: async () => { waits += 1; },
    maxAttempts: 3,
  });

  assert.equal(result.onlineUrl, 'https://bot.example');
  assert.equal(result.releaseId, 'release_1');
  assert.equal(waits, 2);
  assert.equal(calls[0].args.includes('+release-create'), true);
  assert.equal(calls[1].args.includes('+release-get'), true);
});

test('发布失败时给出简短可执行错误', async () => {
  const outputs = [
    '{"data":{"release_id":"release_2","status":"publishing"}}',
    '{"data":{"release":{"release_id":"release_2","status":"failed","error_logs":[{"step":"build","error_log":"type check failed"}]}}}',
  ];
  const runner = async () => ({ code: 0, stdout: outputs.shift(), stderr: '' });
  await assert.rejects(
    () => publishAndWait({ runner, appId: 'app_123', wait: async () => {}, maxAttempts: 2 }),
    /build：type check failed/,
  );
});
