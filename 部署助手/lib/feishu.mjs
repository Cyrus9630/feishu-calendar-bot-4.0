import { request } from 'node:https';

import { conciseError } from './core.mjs';

const baseUrl = 'https://open.feishu.cn';

function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: async () => JSON.parse(body),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const defaultFetch = typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis)
  : nodeFetch;

async function readJson(response, label, secrets) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(`${label}没有返回可识别的数据。`);
  }
  if (!response.ok || value?.code !== 0) {
    const message = value?.msg || `${label}失败（HTTP ${response.status ?? 'unknown'}）`;
    throw new Error(conciseError(message, secrets));
  }
  return value;
}

export async function queryBotOpenId({ appId, appSecret, fetchImpl = defaultFetch }) {
  const secrets = [appSecret];
  const tokenResponse = await fetchImpl(
    `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const tokenValue = await readJson(tokenResponse, '飞书应用凭据校验', secrets);
  const tenantToken = tokenValue.tenant_access_token;
  if (!tenantToken) throw new Error('飞书没有返回 tenant_access_token。');

  const botResponse = await fetchImpl(`${baseUrl}/open-apis/bot/v3/info`, {
    headers: { Authorization: `Bearer ${tenantToken}` },
  });
  const botValue = await readJson(botResponse, '读取机器人信息', [appSecret, tenantToken]);
  const openId = botValue?.bot?.open_id ?? botValue?.data?.bot?.open_id;
  if (!openId) {
    throw new Error('没有读到机器人 open_id，请确认飞书应用已经启用机器人能力。');
  }
  return String(openId);
}
