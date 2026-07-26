import { parseJsonOutput } from './core.mjs';
import { runCommand, runInteractive } from './process.mjs';

const loginArgs = [
  'auth',
  'login',
  '--domain',
  'apps',
  '--domain',
  'im',
  '--domain',
  'calendar',
];

function dataFrom(output, label) {
  const value = parseJsonOutput(output, label);
  return value?.data ?? value;
}

export function parseWhoAmI(output) {
  const data = dataFrom(output, '飞书身份');
  const appId = String(data?.appId ?? data?.app_id ?? '');
  const userOpenId = String(
    data?.onBehalfOf?.openId ??
    data?.on_behalf_of?.open_id ??
    data?.user?.open_id ??
    '',
  );
  if (!appId.startsWith('cli_') || !userOpenId.startsWith('ou_')) {
    throw new Error('飞书 CLI 已登录，但没有读到当前应用或用户身份。');
  }
  return { appId, userOpenId };
}

export function parseChats(output) {
  const data = dataFrom(output, '飞书群聊列表');
  const chats = Array.isArray(data?.chats) ? data.chats : [];
  return chats
    .filter((chat) => String(chat?.chat_id ?? '').startsWith('oc_'))
    .map((chat) => ({
      id: String(chat.chat_id),
      name: String(chat.name || '未命名群聊'),
      detail: chat.external ? '外部群' : '内部群',
    }));
}

function calendarDetail(calendar) {
  const typeNames = {
    primary: '主日历',
    shared: '共享日历',
    resource: '资源日历',
    unknown: '日历',
  };
  const type = typeNames[calendar?.type] ?? '日历';
  const role = calendar?.role === 'owner' ? '管理员' : '可编辑';
  return `${type} · ${role}`;
}

export function parseWritableCalendars(output) {
  const data = dataFrom(output, '飞书日历列表');
  const calendars = Array.isArray(data?.calendar_list)
    ? data.calendar_list
    : Array.isArray(data?.items)
      ? data.items
      : [];
  return calendars
    .filter((calendar) => {
      const id = String(calendar?.calendar_id ?? '');
      const writable = calendar?.role === 'owner' || calendar?.role === 'writer';
      return id && writable && !calendar?.is_deleted && !calendar?.is_third_party;
    })
    .map((calendar) => ({
      id: String(calendar.calendar_id),
      name: String(calendar.summary_alias || calendar.summary || '未命名日历'),
      detail: calendarDetail(calendar),
    }));
}

export async function ensureLarkReady({
  runner = runCommand,
  interactiveRunner = runInteractive,
} = {}) {
  let config = await runner('lark-cli', ['config', 'show'], { allowFailure: true });
  if (config.code !== 0) {
    await interactiveRunner('lark-cli', ['config', 'init', '--new']);
    config = await runner('lark-cli', ['config', 'show'], { allowFailure: true });
    if (config.code !== 0) {
      throw new Error('飞书 CLI 应用配置尚未完成，请重新运行安装器。');
    }
  }

  let auth = await runner(
    'lark-cli',
    ['auth', 'status', '--json', '--verify'],
    { allowFailure: true },
  );
  if (auth.code !== 0) {
    await interactiveRunner('lark-cli', loginArgs);
    auth = await runner(
      'lark-cli',
      ['auth', 'status', '--json', '--verify'],
      { allowFailure: true },
    );
    if (auth.code !== 0) {
      throw new Error('飞书 CLI 用户授权尚未完成，请重新运行安装器。');
    }
  }

  const doctor = await runner('lark-cli', ['doctor'], { allowFailure: true });
  if (doctor.code !== 0) {
    throw new Error('飞书 CLI 健康检查未通过，请按上方提示修复后重新运行安装器。');
  }
}

export async function discoverTargets({ runner = runCommand } = {}) {
  const identityResult = await runner('lark-cli', ['whoami']);
  const chatResult = await runner(
    'lark-cli',
    ['im', '+chat-list', '--as', 'user', '--sort', 'active_time', '--page-size', '100', '--json'],
  );
  const calendarResult = await runner(
    'lark-cli',
    ['calendar', 'calendars', 'list', '--as', 'user', '--page-all', '--page-size', '1000', '--json'],
  );
  return {
    identity: parseWhoAmI(identityResult.stdout),
    chats: parseChats(chatResult.stdout),
    calendars: parseWritableCalendars(calendarResult.stdout),
  };
}

export async function discoverTargetsWithAuthorization({
  runner = runCommand,
  interactiveRunner = runInteractive,
} = {}) {
  try {
    return await discoverTargets({ runner });
  } catch {
    await interactiveRunner('lark-cli', loginArgs);
    return discoverTargets({ runner });
  }
}
