export const packageDate = '2026-07-19';
export const packageBaseName = `飞书日程机器人-妙搭部署包-${packageDate}`;
export const packageRootName = 'feishu-miaoda-calendar-bot';

export const attributionFiles = [
  'server/modules/robot/robot.module.ts',
  'server/modules/robot/robot-event.ts',
  'server/modules/robot/calendar-command.service.ts',
  'server/modules/robot/reminder.service.ts',
  'server/modules/robot/health-alert.service.ts',
];

const excludedPrefixes = [
  'artifacts/',
  'docs/',
  'src-tauri/',
  'client/src/desktop/',
  'scripts/miaoda-share/',
];

const excludedExact = new Set([
  '.env',
  '.env.local',
  '.env.desktop.local',
  'AGENTS.md',
  'PRODUCT.md',
  'README.md',
  'design-qa.md',
  'client/desktop.html',
  'client/desktop-preview.html',
  'vite.desktop.config.ts',
  'shared/desktop-agenda.ts',
  'client/src/pages/robot/DesktopConnectionCard.tsx',
  'client/src/pages/robot/DesktopConnectionCard.spec.tsx',
  'server/modules/robot/desktop-agenda.controller.ts',
  'server/modules/robot/desktop-agenda.service.ts',
  'server/modules/robot/desktop-agenda.service.spec.ts',
  'server/modules/robot/desktop-device.guard.ts',
  'server/modules/robot/desktop-device.guard.spec.ts',
  'server/modules/robot/desktop-device-store.service.ts',
  'server/modules/robot/desktop-device-store.service.spec.ts',
  'server/modules/robot/case-trigger.controller.ts',
  'server/modules/robot/case-trigger.service.ts',
  'server/modules/robot/case-trigger.spec.ts',
  'server/modules/robot/case-trigger.types.ts',
  'server/capabilities/send_feishu_schedule_group_notification_1.json',
]);

export const forbiddenPathParts = [
  '/.git/',
  '/node_modules/',
  '/dist/',
  '/src-tauri/',
  '/client/src/desktop/',
];

export const forbiddenFileNames = new Set([
  '.env',
  '.env.local',
  '.env.desktop.local',
  '.DS_Store',
]);

export function shouldInclude(path) {
  if (excludedExact.has(path)) return false;
  if (/^\.env(?:\.|$)/.test(path) && path !== '.env.example') return false;
  return !excludedPrefixes.some((prefix) => path.startsWith(prefix));
}
