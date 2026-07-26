import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const validators = {
  FEISHU_APP_ID: {
    pattern: /^cli_[A-Za-z0-9]+$/,
    hint: 'App ID 应以 cli_ 开头，请从飞书开放平台“凭证与基础信息”复制。',
  },
  CHAT_ID: {
    pattern: /^oc_[A-Za-z0-9_-]+$/,
    hint: 'chat_id 应以 oc_ 开头，请从目标群消息事件中取得。',
  },
  TARGET_OPEN_ID: {
    pattern: /^ou_[A-Za-z0-9_-]+$/,
    hint: 'open_id 应以 ou_ 开头，请从消息事件或通讯录接口取得。',
  },
  BOT_OPEN_ID: {
    pattern: /^ou_[A-Za-z0-9_-]+$/,
    hint: '机器人 open_id 应以 ou_ 开头。',
  },
  TARGET_CALENDAR_ID: {
    pattern: /^\S{6,}$/,
    hint: '日历 ID 不能为空或包含空格，请从飞书日历接口取得。',
  },
};

const requiredSecrets = new Set([
  'FEISHU_APP_SECRET',
  'FEISHU_VERIFICATION_TOKEN',
]);

export function validateValue(key, rawValue, { allowEmpty = false } = {}) {
  const value = String(rawValue ?? '').trim();
  if (value === '?') {
    throw new Error('已安全退出：请改用 Codex 路径协助取得必要标识。');
  }
  if (!value) {
    if (allowEmpty || key === 'FEISHU_ENCRYPT_KEY') return '';
    throw new Error(`${key} 不能为空。`);
  }
  if (requiredSecrets.has(key)) return value;
  const validator = validators[key];
  if (validator && !validator.pattern.test(value)) {
    throw new Error(validator.hint);
  }
  return value;
}

export function redactSecrets(text, secrets = []) {
  let result = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      result = result.replaceAll(secret, '***');
    }
  }
  return result;
}

export function conciseError(error, secrets = []) {
  const message = error instanceof Error ? error.message : String(error ?? '未知错误');
  return redactSecrets(message, secrets).replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function parseJsonOutput(output, label) {
  const text = String(output ?? '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`${label}没有返回可识别的 JSON。`);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`${label}返回的 JSON 无法解析。`);
  }
}

export function selectNumberedItem(items, rawValue) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('没有可选择的项目。');
  }
  const raw = String(rawValue ?? '').trim();
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > items.length) {
    throw new Error(`请输入 1 到 ${items.length} 之间的编号。`);
  }
  return items[value - 1];
}

export function parseCreateApp(output) {
  const value = parseJsonOutput(output, '创建妙搭应用');
  const appId = value?.data?.app?.app_id ?? value?.data?.app_id ?? value?.app_id;
  if (!appId || !String(appId).startsWith('app_')) {
    throw new Error('创建妙搭应用成功，但没有读到 app_id。');
  }
  return { appId: String(appId) };
}

export function parseRelease(output) {
  const value = parseJsonOutput(output, '妙搭发布');
  const release = value?.data?.release ?? value?.data ?? value;
  const releaseId = release?.release_id ? String(release.release_id) : '';
  const status = release?.status ? String(release.status) : '';
  const onlineUrl = release?.online_url ? String(release.online_url) : '';
  const logs = Array.isArray(release?.error_logs) ? release.error_logs : [];
  const errorSummary = logs
    .map((item) => [item?.step, item?.error_log].filter(Boolean).join('：'))
    .filter(Boolean)
    .join('；')
    .slice(0, 500);
  if (!releaseId || !status) throw new Error('妙搭发布返回缺少 release_id 或 status。');
  return { releaseId, status, onlineUrl, ...(errorSummary ? { errorSummary } : {}) };
}

export function buildEnvSetArgs(appId, key) {
  return [
    'apps',
    '+env-set',
    '--app-id',
    appId,
    '--environment',
    'online',
    '--key',
    key,
    '--value',
    '-',
    '--yes',
    '--as',
    'user',
    '--json',
  ];
}

export async function safeProjectDirectory(path) {
  const target = resolve(path);
  try {
    await access(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return target;
    throw error;
  }
  throw new Error(`目标目录已经存在，部署助手不会覆盖：${target}`);
}
