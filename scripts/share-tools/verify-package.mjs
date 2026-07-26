import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  attributionFiles,
  forbiddenFileNames,
  forbiddenPathParts,
} from './package-config.mjs';

const requiredFiles = [
  '.env.example',
  '.spark/meta.json',
  'PACKAGE-MANIFEST.md',
  'README.md',
  'package-lock.json',
  'package.json',
  'server/app.module.ts',
  'server/modules/robot/robot.module.ts',
  'client/src/pages/robot/DashboardPage.tsx',
  'scripts/share-tools/verify-package.mjs',
  '先打开我.html',
  '给Codex的一句话.txt',
  '双击开始部署-Windows.bat',
  '双击开始部署-macOS.command',
  '部署助手/cli.mjs',
  '部署助手/lib/core.mjs',
  '部署助手/lib/deploy.mjs',
  '部署助手/test/wizard.spec.mjs',
];

const forbiddenExactPaths = new Set([
  'client/desktop.html',
  'client/desktop-preview.html',
  'vite.desktop.config.ts',
  'shared/desktop-agenda.ts',
  'client/src/pages/robot/DesktopConnectionCard.tsx',
  'server/modules/robot/desktop-agenda.controller.ts',
  'server/modules/robot/desktop-agenda.service.ts',
  'server/modules/robot/desktop-device.guard.ts',
  'server/modules/robot/desktop-device-store.service.ts',
  'server/modules/robot/case-trigger.controller.ts',
  'server/modules/robot/case-trigger.service.ts',
  'server/modules/robot/case-trigger.types.ts',
  'server/capabilities/send_feishu_schedule_group_notification_1.json',
]);

const forbiddenBinaryExtensions = /\.(?:png|jpe?g|gif|webp|bmp|ico)$/i;

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function isText(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function normalizeRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadSecrets(root) {
  if (!root) return [];
  const values = new Map();
  for (const filename of ['.env', '.env.local', '.env.desktop.local']) {
    const path = join(root, filename);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!/(?:SECRET|TOKEN|KEY|APP_ID|CHAT_ID|OPEN_ID|CALENDAR_ID)/.test(key)) {
        continue;
      }
      const value = unquote(rawValue.trim());
      if (value.length < 6 || /^(?:replace_|your_|cli_your|oc_your|ou_your)/.test(value)) {
        continue;
      }
      values.set(key, value);
    }
  }
  return [...values].map(([key, value]) => ({ key, value }));
}

export function scanText(text, secrets = []) {
  const findings = [];
  const userRootMarker = `/${'Users'}/`;
  const personalMarkers = [
    ['阿洛', '一号'].join(''),
    ['aluo', '-1'].join(''),
    ['A01', ' 飞书自动化'].join(''),
    ['A1', ' 飞书CLI'].join(''),
  ];
  if (text.includes(userRootMarker)) findings.push('absolute-user-path');
  if (personalMarkers.some((marker) => text.toLowerCase().includes(marker.toLowerCase()))) {
    findings.push('personal-marker');
  }
  for (const secret of secrets) {
    if (secret.value && text.includes(secret.value)) {
      findings.push(`secret:${secret.key}`);
    }
  }
  return findings;
}

function validatePackageJson(root, findings) {
  const value = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const script of Object.keys(value.scripts ?? {})) {
    if (script.startsWith('desktop:')) findings.push(`desktop-script:${script}`);
  }
  for (const dependency of [
    ...Object.keys(value.dependencies ?? {}),
    ...Object.keys(value.devDependencies ?? {}),
  ]) {
    if (dependency.startsWith('@tauri-apps/')) {
      findings.push(`desktop-dependency:${dependency}`);
    }
  }
}

function validateAttributions(root, findings) {
  for (const path of attributionFiles) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      findings.push(`missing-attribution-file:${path}`);
      continue;
    }
    const source = readFileSync(absolute, 'utf8');
    const count = source.match(/\/\/ 刘梦阳律师/g)?.length ?? 0;
    if (count !== 1) findings.push(`attribution-count:${path}:${count}`);
  }
}

function validateJsonMetadata(root, files, findings) {
  const inspect = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item) => inspect(item, path));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'createdBy' && item !== 0 && item !== '') {
        findings.push(`personal-metadata:${path}:createdBy`);
      }
      inspect(item, path);
    }
  };
  for (const absolute of files) {
    const path = normalizeRelative(root, absolute);
    if (!path.startsWith('server/capabilities/') || !path.endsWith('.json')) {
      continue;
    }
    try {
      inspect(JSON.parse(readFileSync(absolute, 'utf8')), path);
    } catch {
      findings.push(`invalid-capability-json:${path}`);
    }
  }
}

function validateFoolproofEntrypoints(root, findings) {
  const welcomePath = join(root, '先打开我.html');
  const codexPath = join(root, '给Codex的一句话.txt');
  const windowsPath = join(root, '双击开始部署-Windows.bat');
  const macosPath = join(root, '双击开始部署-macOS.command');
  if (![welcomePath, codexPath, windowsPath, macosPath].every(existsSync)) return;

  const welcome = readFileSync(welcomePath, 'utf8');
  if (/<script|localStorage|sessionStorage|type=["']password/i.test(welcome)) {
    findings.push('unsafe-welcome-page');
  }
  const codex = readFileSync(codexPath, 'utf8');
  if (!/标准输入/.test(codex) || !/不回显.*密钥/s.test(codex)) {
    findings.push('unsafe-codex-prompt');
  }
  if (!/部署助手\\cli\.mjs/.test(readFileSync(windowsPath, 'utf8'))) {
    findings.push('invalid-windows-launcher');
  }
  if (!/部署助手\/cli\.mjs/.test(readFileSync(macosPath, 'utf8'))) {
    findings.push('invalid-macos-launcher');
  }
  if ((statSync(macosPath).mode & 0o111) === 0) {
    findings.push('macos-launcher-not-executable');
  }

  try {
    const output = execFileSync(
      process.execPath,
      [join(root, '部署助手', 'cli.mjs'), '--check', '--json'],
      { encoding: 'utf8', timeout: 15_000 },
    );
    const value = JSON.parse(output.trim());
    if (typeof value.node !== 'boolean' || typeof value.git !== 'boolean' || typeof value.larkCli !== 'boolean') {
      findings.push('invalid-wizard-self-check');
    }
  } catch {
    findings.push('wizard-self-check-failed');
  }
}

export function verifyPackage(packageRoot, { secretSourceRoot } = {}) {
  const root = resolve(packageRoot);
  const findings = [];
  for (const path of requiredFiles) {
    if (!existsSync(join(root, path))) findings.push(`missing-required:${path}`);
  }

  const secrets = loadSecrets(secretSourceRoot);
  const files = listFiles(root);
  for (const absolute of files) {
    const path = normalizeRelative(root, absolute);
    const normalized = `/${path}/`;
    if (forbiddenExactPaths.has(path)) findings.push(`forbidden-path:${path}`);
    if (
      forbiddenPathParts.some((part) => normalized.includes(part)) ||
      /(?:^|\/)(?:backups?|logs?)(?:\/|$)/i.test(path)
    ) {
      findings.push(`forbidden-path:${path}`);
    }
    if (forbiddenFileNames.has(basename(path)) && path !== '.env.example') {
      findings.push(`forbidden-file:${path}`);
    }
    if (forbiddenBinaryExtensions.test(path)) {
      findings.push(`forbidden-binary:${path}`);
    }

    const buffer = readFileSync(absolute);
    if (!isText(buffer)) continue;
    for (const finding of scanText(buffer.toString('utf8'), secrets)) {
      findings.push(`${finding}:${path}`);
    }
  }

  validatePackageJson(root, findings);
  validateAttributions(root, findings);
  validateJsonMetadata(root, files, findings);
  validateFoolproofEntrypoints(root, findings);

  const uniqueFindings = [...new Set(findings)].sort();
  return {
    ok: uniqueFindings.length === 0,
    fileCount: files.length,
    findings: uniqueFindings,
  };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const result = verifyPackage(process.argv[2] ?? '.');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
