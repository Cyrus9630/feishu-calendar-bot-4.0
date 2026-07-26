export const EVENT_COLORS = {
  红色: 0xf54a45,
  橙色: 0xff8800,
  黄色: 0xffc60a,
  绿色: 0x34c724,
  蓝色: 0x3370ff,
  紫色: 0x7b67ee,
  灰色: 0x8f959e,
} as const;

export type EventColorName = keyof typeof EVENT_COLORS;
export type ScheduleAction = 'create' | 'update' | 'cancel' | 'help';

export interface RawScheduleCommand {
  action?: string;
  title?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  color?: string;
  location?: string;
  reminder_minutes?: string;
}

export interface NormalizedScheduleCommand {
  action: ScheduleAction;
  title: string;
  dateText: string;
  startText: string;
  endText: string;
  durationMinutes: number;
  color: { name: EventColorName; rgb: number };
  colorExplicit: boolean;
  location: string;
  reminderMinutes: number[];
}

const COLOR_ALIASES: Record<string, EventColorName> = {
  红: '红色', 红色: '红色', 标红: '红色', 红标: '红色',
  橙: '橙色', 橙色: '橙色', 标橙: '橙色', 橙标: '橙色',
  黄: '黄色', 黄色: '黄色', 标黄: '黄色', 黄标: '黄色',
  绿: '绿色', 绿色: '绿色', 标绿: '绿色', 绿标: '绿色',
  蓝: '蓝色', 蓝色: '蓝色', 标蓝: '蓝色', 蓝标: '蓝色',
  紫: '紫色', 紫色: '紫色', 标紫: '紫色', 紫标: '紫色',
  灰: '灰色', 灰色: '灰色', 标灰: '灰色', 灰标: '灰色',
};

export function normalizeColor(input: string) {
  const normalized = input.trim();
  if (!normalized) return { name: '蓝色' as const, rgb: EVENT_COLORS.蓝色 };
  const tokens = normalized
    .split(/[、,，/\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const names = [...new Set(tokens.map((token) => COLOR_ALIASES[token]).filter(Boolean))];
  if (names.length > 1) throw new Error('检测到多个颜色，请只保留一种');
  if (names.length === 0) {
    throw new Error('暂支持红、橙、黄、绿、蓝、紫、灰七种颜色');
  }
  const name = names[0];
  return { name, rgb: EVENT_COLORS[name] };
}

function normalizeAction(input: string | undefined): ScheduleAction {
  const value = (input || 'create').trim().toLowerCase();
  if (['create', '创建', '新增', '添加'].includes(value)) return 'create';
  if (['update', '修改', '调整', '改'].includes(value)) return 'update';
  if (['cancel', '取消', '删除'].includes(value)) return 'cancel';
  if (['help', '帮助', '怎么用', '使用说明'].includes(value)) return 'help';
  throw new Error('未识别要执行的操作，请使用创建、修改、取消或帮助');
}

function normalizeReminders(input: string | undefined): number[] {
  if (!input?.trim()) return [30];
  const values = input
    .split(/[、,，\s]+/)
    .map(Number)
    .filter(Number.isFinite);
  if (values.length === 0 || values.some((value) => value < 0)) {
    throw new Error('提醒时间无法识别，请使用分钟数');
  }
  return [...new Set(values)].sort((a, b) => b - a);
}

export function normalizeScheduleCommand(
  raw: RawScheduleCommand,
): NormalizedScheduleCommand {
  const duration = Number(raw.duration_minutes || 0);
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error('日程时长必须是有效分钟数');
  }
  return {
    action: normalizeAction(raw.action),
    title: (raw.title || '').trim(),
    dateText: (raw.date || '').trim(),
    startText: (raw.start_time || '').trim(),
    endText: (raw.end_time || '').trim(),
    durationMinutes: duration || 60,
    color: normalizeColor(raw.color || ''),
    colorExplicit: !!raw.color?.trim(),
    location: (raw.location || '').trim(),
    reminderMinutes: normalizeReminders(raw.reminder_minutes),
  };
}

export function getMissingCommandFields(
  command: NormalizedScheduleCommand,
): string[] {
  if (command.action === 'help') return [];
  const missing: string[] = [];
  if (!command.title) missing.push('事项');
  return missing;
}

export function hasExplicitSourceTime(
  sourceText: string,
  extractedTime: string,
): boolean {
  const value = normalizeTimeEvidence(extractedTime);
  return (
    value.length > 0 && normalizeTimeEvidence(sourceText).includes(value)
  );
}

function normalizeTimeEvidence(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[：、]/g, ':')
    .replace(/时/g, '点')
    .replace(/([零〇一二两三四五六七八九十\d]+)点([零〇一二两三四五六七八九十\d]+)(?:分)?/g, '$1:$2')
    .replace(/([零〇一二两三四五六七八九十\d]+):(\d+)分/g, '$1:$2')
    .trim();
}

export type HelpTopic =
  | 'overview'
  | 'create'
  | 'update'
  | 'cancel'
  | 'query';

const HELP_TOPIC_ALIASES: Record<string, HelpTopic> = {
  创建: 'create',
  新增: 'create',
  添加: 'create',
  修改: 'update',
  调整: 'update',
  删除: 'cancel',
  取消: 'cancel',
  查询: 'query',
  日程: 'query',
};

export function parseHelpTopic(text: string): HelpTopic | null {
  const value = text.trim();
  if (/^(帮助|怎么用|使用说明|help)$/i.test(value)) return 'overview';
  const match =
    value.match(/^(?:帮助|怎么用|使用说明|help)[\s:：]*(.+)$/i) ||
    value.match(/^(.+?)[\s]*(?:帮助|怎么用)$/i);
  if (!match) return null;
  return HELP_TOPIC_ALIASES[match[1].trim()] || null;
}

export function isHelpText(text: string): boolean {
  return parseHelpTopic(text) !== null;
}
