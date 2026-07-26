import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildEnvSetArgs,
  parseCreateApp,
  parseRelease,
  redactSecrets,
  safeProjectDirectory,
  selectNumberedItem,
  validateValue,
} from '../lib/core.mjs';
import {
  discoverTargets,
  discoverTargetsWithAuthorization,
  ensureLarkReady,
  parseChats,
  parseWhoAmI,
  parseWritableCalendars,
} from '../lib/discovery.mjs';
import { queryBotOpenId } from '../lib/feishu.mjs';
import {
  copyShareSource,
  publishAndWait,
  setOnlineEnvironment,
} from '../lib/deploy.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

test('自动读取当前飞书应用和用户身份', () => {
  assert.deepEqual(
    parseWhoAmI('{"appId":"cli_demo","onBehalfOf":{"openId":"ou_user"}}'),
    { appId: 'cli_demo', userOpenId: 'ou_user' },
  );
  assert.deepEqual(
    parseWhoAmI('{"data":{"app_id":"cli_demo2","user":{"open_id":"ou_user2"}}}'),
    { appId: 'cli_demo2', userOpenId: 'ou_user2' },
  );
  assert.throws(() => parseWhoAmI('{"appId":"bad"}'), /当前应用或用户身份/);
});

test('只列出群聊和可写日历', () => {
  assert.deepEqual(
    parseChats('{"data":{"chats":[{"chat_id":"oc_1","name":"项目群","external":false},{"chat_id":"bad","name":"忽略"}]}}'),
    [{ id: 'oc_1', name: '项目群', detail: '内部群' }],
  );
  assert.deepEqual(
    parseWritableCalendars('{"data":{"calendar_list":[{"calendar_id":"cal_1","summary":"工作","role":"writer","type":"shared","is_deleted":false,"is_third_party":false},{"calendar_id":"cal_2","summary":"只读","role":"reader"},{"calendar_id":"cal_3","summary":"三方","role":"owner","is_third_party":true}]}}'),
    [{ id: 'cal_1', name: '工作', detail: '共享日历 · 可编辑' }],
  );
});

test('编号选择必须明确且在范围内', () => {
  assert.equal(selectNumberedItem([{ id: 'one' }, { id: 'two' }], '2').id, 'two');
  assert.throws(() => selectNumberedItem([{ id: 'one' }], '0'), /请输入 1 到 1/);
  assert.throws(() => selectNumberedItem([{ id: 'one' }], 'one'), /请输入 1 到 1/);
  assert.throws(() => selectNumberedItem([], '1'), /没有可选择的项目/);
});

test('发现流程使用当前身份、群聊和日历公开命令', async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'whoami') {
      return {
        code: 0,
        stdout: '{"appId":"cli_demo","onBehalfOf":{"openId":"ou_user"}}',
        stderr: '',
      };
    }
    if (args[0] === 'im') {
      return {
        code: 0,
        stdout: '{"data":{"chats":[{"chat_id":"oc_group","name":"项目群"}]}}',
        stderr: '',
      };
    }
    return {
      code: 0,
      stdout: '{"data":{"calendar_list":[{"calendar_id":"cal_work","summary":"工作","role":"owner"}]}}',
      stderr: '',
    };
  };

  const result = await discoverTargets({ runner });

  assert.equal(result.identity.userOpenId, 'ou_user');
  assert.equal(result.chats[0].id, 'oc_group');
  assert.equal(result.calendars[0].id, 'cal_work');
  assert.deepEqual(calls.map((call) => call.args.slice(0, 3)), [
    ['whoami'],
    ['im', '+chat-list', '--as'],
    ['calendar', 'calendars', 'list'],
  ]);
});

test('未配置或未登录时调用飞书 CLI 官方交互流程并重新验证', async () => {
  const statusCodes = [1, 0, 1, 0, 0];
  const runnerCalls = [];
  const interactiveCalls = [];
  const runner = async (command, args) => {
    runnerCalls.push({ command, args });
    return { code: statusCodes.shift(), stdout: '{}', stderr: '' };
  };
  const interactiveRunner = async (command, args) => {
    interactiveCalls.push({ command, args });
    return { code: 0 };
  };

  await ensureLarkReady({ runner, interactiveRunner });

  assert.deepEqual(interactiveCalls, [
    { command: 'lark-cli', args: ['config', 'init', '--new'] },
    {
      command: 'lark-cli',
      args: ['auth', 'login', '--domain', 'apps', '--domain', 'im', '--domain', 'calendar'],
    },
  ]);
  assert.deepEqual(runnerCalls.map((call) => call.args), [
    ['config', 'show'],
    ['config', 'show'],
    ['auth', 'status', '--json', '--verify'],
    ['auth', 'status', '--json', '--verify'],
    ['doctor'],
  ]);
});

test('配置和登录均有效时不启动交互流程', async () => {
  const interactiveCalls = [];
  const runner = async () => ({ code: 0, stdout: '{}', stderr: '' });
  await ensureLarkReady({
    runner,
    interactiveRunner: async (...args) => {
      interactiveCalls.push(args);
      return { code: 0 };
    },
  });
  assert.equal(interactiveCalls.length, 0);
});

test('资源发现权限不足时重新授权并重试一次', async () => {
  let chatAttempts = 0;
  const interactiveCalls = [];
  const runner = async (command, args) => {
    if (args[0] === 'whoami') {
      return {
        code: 0,
        stdout: '{"appId":"cli_demo","onBehalfOf":{"openId":"ou_user"}}',
        stderr: '',
      };
    }
    if (args[0] === 'im') {
      chatAttempts += 1;
      if (chatAttempts === 1) throw new Error('permission denied');
      return {
        code: 0,
        stdout: '{"data":{"chats":[{"chat_id":"oc_group","name":"项目群"}]}}',
        stderr: '',
      };
    }
    return {
      code: 0,
      stdout: '{"data":{"calendar_list":[{"calendar_id":"cal_work","summary":"工作","role":"writer"}]}}',
      stderr: '',
    };
  };

  const result = await discoverTargetsWithAuthorization({
    runner,
    interactiveRunner: async (command, args) => {
      interactiveCalls.push({ command, args });
      return { code: 0 };
    },
  });

  assert.equal(result.chats[0].id, 'oc_group');
  assert.equal(chatAttempts, 2);
  assert.equal(interactiveCalls.length, 1);
  assert.deepEqual(interactiveCalls[0].args, [
    'auth',
    'login',
    '--domain',
    'apps',
    '--domain',
    'im',
    '--domain',
    'calendar',
  ]);
});

test('双击入口首先提示安装飞书 CLI', async () => {
  const mac = await readFile(join(packageRoot, '双击开始部署-macOS.command'), 'utf8');
  const windows = await readFile(join(packageRoot, '双击开始部署-Windows.bat'), 'utf8');
  for (const source of [mac, windows]) {
    assert.ok(source.indexOf('lark-cli') >= 0);
    assert.ok(source.indexOf('lark-cli') < source.indexOf('Node.js'));
    assert.match(source, /npx @larksuite\/cli@latest install/);
    assert.match(source, /github\.com\/larksuite\/cli/);
  }
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
