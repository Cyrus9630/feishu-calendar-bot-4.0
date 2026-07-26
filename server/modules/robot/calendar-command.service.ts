import { Inject, Injectable } from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { randomUUID } from 'crypto';
import type { ChineseScheduleParseOneOutput } from '@shared/plugin-types';
import { FeishuService, type CalendarEventRecord } from './feishu.service';
import {
  EVENT_COLORS,
  getMissingCommandFields,
  hasExplicitSourceTime,
  isHelpText,
  parseHelpTopic,
  normalizeScheduleCommand,
  type NormalizedScheduleCommand,
} from './schedule-command';
import {
  computeScheduleRange,
  findScheduleDateExpression,
  getShanghaiDayRangeDates,
  isRecognizedScheduleTime,
  resolveScheduleClock,
  resolveScheduleDate,
} from './schedule-time';
import type { CardRobotInput, TextRobotInput } from './robot-event';
import {
  OperationStoreService,
  stableUuid,
  type CalendarCancelPending,
  type CalendarCancelSelectionPending,
  type CalendarUpdateSelectionPending,
} from './operation-store.service';
import { CalendarActionService } from './calendar-action.service';
import type {
  CalendarEventSnapshot,
  CalendarSearchExpansionPending,
} from './calendar-action.types';
import {
  isSelectionText,
  parseBatchEnvelope,
  parseSelectionIndexes,
  type BatchCalendarAction,
} from './calendar-batch';
import {
  parseScheduleRecurrence,
  parseScheduleRecurrenceScope,
  recurringMasterEventId,
  stripScheduleRecurrence,
  truncateScheduleRecurrence,
} from './schedule-recurrence';
import { parseScheduleUpdateIntent } from './schedule-update';
import { parseScheduleQuery } from './schedule-query';
import { CalendarQueryService } from './calendar-query.service';
import { parseCrossDayScheduleRange } from './schedule-range';
import { normalizeSpokenSchedule } from './schedule-language';
import {
  parseSingleUpdateSelection,
  rankUpdateCandidates,
  updateSearchWindow,
  type StoredCalendarUpdateRequest,
} from './calendar-update-search';
import { buildCalendarSearchExpansionCard } from './calendar-update-card';
import { buildTerminalCalendarCard } from './interactive-card';

const SCHEDULE_PARSE_ID = 'chinese_schedule_parse_1';
const DEFAULT_CREATE_START_TEXT = '上午';
const HELP_TEXTS = {
  overview: [
    '日程机器人常用操作：',
    '• 创建：17号上午7点体检 黄色',
    '• 修改：把17号体检改到上午8点',
    '• 删除：取消17号体检',
    '• 查询：我明天什么安排',
    '需要细节可发送“帮助 创建”“帮助 修改”“帮助 删除”或“帮助 查询”。',
  ],
  create: [
    '创建日程：',
    '发送“17号上午7点体检 黄色”。未写日期默认今天；只写日期默认10:00；未写颜色默认蓝色。',
    '批量示例：“批量创建：17号上午体检；18号下午开会”。',
    '重复示例：“每年5月7日结婚纪念日”或“7月28日每三个月交房租”。',
  ],
  update: [
    '修改日程：',
    '发送“把17号体检改到上午8点”。未写原日期时默认查未来30天，多条候选时回复一个序号。',
    '也可回复单日程卡片发送“这个改到周三”。重复日程请说明“仅本次”“本次及后续”或“全部”。',
  ],
  cancel: [
    '删除日程：',
    '发送“取消17号体检”，并在确认卡中核对后执行。',
    '批量示例：“删除17号体检；18号开庭”。候选不唯一时，回复编号，例如“1、3、5-7”。',
  ],
  query: [
    '查询日程：',
    '可发送“我明天什么安排”“下周什么安排”或“我有哪几个红色安排”。',
    '查询只读取日历，不会创建、修改或删除日程。',
  ],
} as const;

export function calendarHelpText(text: string): string {
  const topic = parseHelpTopic(text) || 'overview';
  return HELP_TEXTS[topic].join('\n');
}

type CreateResult = 'created' | 'pending' | 'duplicate';

// 刘梦阳律师
@Injectable()
export class CalendarCommandService {
  constructor(
    @Inject() private readonly capabilityService: CapabilityService,
    private readonly feishu: FeishuService,
    private readonly store: OperationStoreService,
    private readonly actions: CalendarActionService,
    private readonly queries: CalendarQueryService,
  ) {}

  async handleText(
    input: TextRobotInput,
    reference = new Date(),
  ): Promise<void> {
    try {
      const routing = normalizeSpokenSchedule(input.text, {
        extractDuration: false,
      });
      const routingInput = { ...input, text: routing.text };
      if (isHelpText(routingInput.text)) {
        await this.reply(input, calendarHelpText(routingInput.text), 'help');
        return;
      }
      const query = parseScheduleQuery(routingInput.text, reference);
      if (query) {
        await this.queries.reply(input.messageId, query);
        return;
      }
      if (isSelectionText(routingInput.text)) {
        const pending =
          await this.store.getLatestPendingCancellationSelection(reference);
        if (!pending) {
          await this.reply(
            input,
            '没有找到仍有效的删除候选清单。请重新发送删除指令，收到编号清单后再发送序号。',
            'cancel-selection-missing',
          );
          return;
        }
        await this.selectCancellations(
          input,
          pending.action,
          pending.replyMessageId,
        );
        return;
      }
      const batch = parseBatchEnvelope(routingInput.text);
      if (batch.isBatch) {
        await this.handleBatch(
          routingInput,
          batch.action,
          batch.items,
          reference,
        );
        return;
      }
      const spoken = normalizeSpokenSchedule(input.text);
      await this.handleSingle(
        { ...input, text: spoken.text },
        reference,
        spoken.durationMinutes,
      );
    } catch (error) {
      await this.reply(
        input,
        `未执行日程操作：${this.publicError(error)}\n请修改后重新 @机器人发送。`,
        'error',
      );
    }
  }

  private async handleSingle(
    input: TextRobotInput,
    reference: Date,
    durationMinutes?: number,
  ) {
    const extracted = await this.parse(input.text);
    const raw = durationMinutes
      ? { ...extracted, duration_minutes: durationMinutes }
      : extracted;
    const command = this.normalize(raw, input.text);
    if (command.action === 'help') {
      await this.reply(input, calendarHelpText(input.text), 'help');
    } else if (command.action === 'create') {
      await this.create(input, command, reference);
    } else if (command.action === 'update') {
      await this.update(input, command, raw, reference);
    } else {
      await this.requestCancellation(input, command, reference);
    }
  }

  async confirmCancellation(
    input: TextRobotInput,
    pending: CalendarCancelPending,
  ): Promise<void> {
    if (input.text.trim() !== '确认取消') {
      await this.reply(
        input,
        '未取消日程。如需取消，请回复确认消息并发送“@日程机器人 确认取消”。',
        'cancel-not-confirmed',
      );
      return;
    }
    await this.feishu.deleteCalendarEvent(pending.eventId);
    await this.store.completePending(
      input.parentId || '',
      'success',
      'cancelled',
    );
    await this.reply(
      input,
      `已取消日程：${pending.summary}｜${pending.timeText}`,
      'cancelled',
    );
  }

  async selectCancellations(
    input: TextRobotInput,
    pending: CalendarCancelSelectionPending & { expiresAt: string },
    pendingMessageId = input.parentId || '',
  ): Promise<void> {
    const indexes = parseSelectionIndexes(
      input.text,
      pending.candidates.length,
    );
    const failures: string[] = [];
    let prompted = 0;
    for (const index of indexes) {
      const candidate = pending.candidates[index - 1];
      try {
        const event = await this.feishu.getCalendarEvent(candidate.eventId);
        if (!event) throw new Error('该日程已不存在');
        const didPrompt = await this.promptCancellation(
          input,
          event,
          `${input.messageId}:selection:${index}`,
        );
        if (didPrompt) prompted += 1;
      } catch (error) {
        failures.push(`第${index}项：${this.publicError(error)}`);
      }
    }
    await this.store.completePending(
      pendingMessageId,
      'success',
      `selected:${prompted};failed:${failures.length}`,
    );
    await this.reply(
      input,
      [
        `已选择${indexes.length}项，其中${prompted}项已生成删除确认卡。`,
        failures.length
          ? `未生成确认卡：\n${failures.join('\n')}`
          : '请在确认卡中核对后删除。',
      ].join('\n'),
      'cancel-selection',
    );
  }

  async selectUpdateCandidate(
    input: TextRobotInput,
    pending: CalendarUpdateSelectionPending & { expiresAt: string },
    pendingMessageId = input.parentId || '',
  ): Promise<void> {
    parseSingleUpdateSelection(
      input.text,
      pending.candidates.length,
    );
    const claim = await this.store.claimPending(pendingMessageId);
    if (
      claim.state !== 'claimed' ||
      claim.action.kind !== 'calendar_update_selection'
    ) {
      await this.reply(
        input,
        claim.state === 'expired'
          ? '该候选清单已过有效期，请重新发送修改指令。'
          : '该候选清单已经处理，请勿重复提交。',
        'update-selection-unavailable',
      );
      return;
    }
    const claimedPending = claim.action;
    const selectedIndex = parseSingleUpdateSelection(
      input.text,
      claimedPending.candidates.length,
    );
    const selected = claimedPending.candidates[selectedIndex];
    try {
      const event = await this.feishu.getCalendarEvent(selected.eventId);
      if (!event) {
        await this.store.completePending(
          pendingMessageId,
          'fail',
          'selected-event-missing',
        );
        await this.reply(
          input,
          '所选日程已不存在，未执行修改。请重新发送修改指令。',
          'update-selection-missing',
        );
        return;
      }
      await this.applyUpdateToEvent(input, event, claimedPending.request);
      await this.store.completePending(pendingMessageId, 'success', 'selected');
    } catch (error) {
      await this.store.completePending(
        pendingMessageId,
        'fail',
        'selection-failed',
      );
      throw error;
    }
  }

  async handleSearchExpansionAction(
    input: CardRobotInput,
    now = new Date(),
  ): Promise<void> {
    const existing = await this.store.getCardAction(input.actionId);
    if (
      !existing ||
      existing.kind !== 'calendar_search_expansion' ||
      existing.actorOpenId !== input.operatorOpenId ||
      existing.chatId !== input.chatId ||
      (existing.cardMessageId && existing.cardMessageId !== input.messageId)
    ) {
      await this.feishu.updateInteractiveCard(
        input.messageId,
        buildTerminalCalendarCard({
          title: '操作无效',
          message: '该查找操作不存在，或不属于当前用户。',
          status: 'failed',
        }),
      );
      return;
    }
    const claim = await this.store.claimCardAction(input.actionId, now);
    if (
      claim.state !== 'claimed' ||
      claim.action.kind !== 'calendar_search_expansion'
    ) {
      await this.feishu.updateInteractiveCard(
        input.messageId,
        buildTerminalCalendarCard({
          title: '无法继续查找',
          message:
            claim.state === 'expired'
              ? '该选择已过有效期，请重新发送修改指令。'
              : '该选择已经处理，请勿重复点击。',
          status: claim.state === 'expired' ? 'expired' : 'failed',
        }),
      );
      return;
    }
    const action = claim.action;
    if (input.decision === 'cancel_search') {
      await this.store.completeCardAction(
        action.actionId,
        'success',
        'cancelled',
      );
      await this.feishu.updateInteractiveCard(
        input.messageId,
        buildTerminalCalendarCard({
          title: '已取消查找',
          message: '没有修改任何飞书日程。',
          status: 'cancelled',
        }),
      );
      return;
    }
    if (input.decision !== 'search_two_years') {
      throw new Error('按钮操作与扩展查找记录不匹配');
    }
    try {
      const reference = new Date(action.request.referenceTime);
      const range = updateSearchWindow(reference, 'extended');
      const events = await this.feishu.listCalendarEvents(
        range.start,
        range.end,
      );
      const keyword = this.updateTargetKeyword(action.request);
      const matches = rankUpdateCandidates(events, keyword);
      if (matches.length === 0) {
        await this.reply(
          {
            kind: 'text',
            messageId: input.messageId,
            parentId: null,
            text: action.request.sourceText,
          },
          '未来两年内仍未找到符合条件的日程，未执行任何修改。',
          'extended-not-found',
        );
      } else {
        await this.sendUpdateCandidates(
          {
            kind: 'text',
            messageId: input.messageId,
            parentId: null,
            text: action.request.sourceText,
          },
          matches,
          action.request,
          true,
        );
      }
      await this.store.completeCardAction(
        action.actionId,
        'success',
        matches.length ? 'candidates-sent' : 'not-found',
      );
      await this.feishu.updateInteractiveCard(
        input.messageId,
        buildTerminalCalendarCard({
          title: matches.length ? '已完成两年检索' : '两年内未找到日程',
          message: matches.length
            ? '候选清单已经发送，请回复清单并选择一个序号。'
            : '没有修改任何飞书日程。',
          status: matches.length ? 'success' : 'cancelled',
        }),
      );
    } catch (error) {
      await this.store.completeCardAction(
        action.actionId,
        'fail',
        'failed',
        this.publicError(error),
      );
      throw error;
    }
  }

  private async handleBatch(
    input: TextRobotInput,
    action: BatchCalendarAction,
    items: string[],
    reference: Date,
  ) {
    const parsedItems: Array<{
      index: number;
      sourceText: string;
      command: NormalizedScheduleCommand;
      raw: ChineseScheduleParseOneOutput;
    }> = [];
    const failures: string[] = [];
    for (const [offset, item] of items.entries()) {
      const index = offset + 1;
      try {
        const spoken = normalizeSpokenSchedule(item);
        if (action === 'create' && /^(?:取消|删除)/.test(spoken.text)) {
          throw new Error('同一批次不能混合创建和取消，请分开发送');
        }
        const sourceText = `${action === 'create' ? '创建' : '删除'}${spoken.text}`;
        const extracted = await this.parse(sourceText);
        const raw = {
          ...extracted,
          action,
          ...(spoken.durationMinutes
            ? { duration_minutes: spoken.durationMinutes }
            : {}),
        } as ChineseScheduleParseOneOutput;
        const command = this.normalize(raw, spoken.text);
        if (command.action !== action) throw new Error('批量操作类型不一致');
        parsedItems.push({ index, sourceText, command, raw });
      } catch (error) {
        failures.push(`第${index}项“${item}”：${this.publicError(error)}`);
      }
    }
    if (action === 'create') {
      await this.handleBatchCreate(
        input,
        parsedItems,
        failures,
        reference,
        items.length,
      );
    } else {
      await this.handleBatchCancel(
        input,
        parsedItems,
        failures,
        reference,
        items.length,
      );
    }
  }

  private async handleBatchCreate(
    input: TextRobotInput,
    items: Array<{
      index: number;
      sourceText: string;
      command: NormalizedScheduleCommand;
    }>,
    failures: string[],
    reference: Date,
    total: number,
  ) {
    const counts: Record<CreateResult, number> = {
      created: 0,
      pending: 0,
      duplicate: 0,
    };
    for (const item of items) {
      try {
        const result = await this.create(
          { ...input, text: item.sourceText },
          item.command,
          reference,
          {
            sourceOperationId: `${input.messageId}:batch-create:${item.index}`,
            quietDuplicate: true,
          },
        );
        counts[result] += 1;
      } catch (error) {
        failures.push(`第${item.index}项：${this.publicError(error)}`);
      }
    }
    await this.reply(
      input,
      [
        `批量创建处理完成：共${total}项。`,
        `已创建${counts.created}项，等待确认${counts.pending}项，重复未创建${counts.duplicate}项，失败${failures.length}项。`,
        ...(failures.length ? ['失败明细：', ...failures] : []),
      ].join('\n'),
      'batch-create-summary',
    );
  }

  private async handleBatchCancel(
    input: TextRobotInput,
    items: Array<{
      index: number;
      sourceText: string;
      command: NormalizedScheduleCommand;
    }>,
    failures: string[],
    reference: Date,
    total: number,
  ) {
    const exact = new Map<string, CalendarEventRecord>();
    const ambiguous = new Map<string, CalendarEventRecord>();
    for (const item of items) {
      try {
        const matches = await this.findCandidates(
          item.command,
          item.sourceText,
          reference,
        );
        if (matches.length === 0) {
          failures.push(`第${item.index}项：未找到符合条件的日程`);
        } else if (matches.length === 1) {
          exact.set(matches[0].eventId, matches[0]);
        } else {
          matches.forEach((event) => ambiguous.set(event.eventId, event));
        }
      } catch (error) {
        failures.push(`第${item.index}项：${this.publicError(error)}`);
      }
    }
    let prompted = 0;
    for (const [offset, event] of [...exact.values()].entries()) {
      try {
        const current =
          (await this.feishu.getCalendarEvent(event.eventId)) || event;
        const didPrompt = await this.promptCancellation(
          input,
          current,
          `${input.messageId}:batch-cancel:${offset + 1}`,
        );
        if (didPrompt) prompted += 1;
      } catch (error) {
        failures.push(`日程“${event.summary}”：${this.publicError(error)}`);
      }
    }
    await this.reply(
      input,
      [
        `批量删除查询完成：共${total}项。`,
        `已生成${prompted}张删除确认卡，待选择候选${ambiguous.size}项，失败${failures.length}项。`,
        ...(failures.length ? ['失败明细：', ...failures] : []),
      ].join('\n'),
      'batch-cancel-summary',
    );
    if (ambiguous.size > 0) {
      await this.sendCancellationCandidates(input, [...ambiguous.values()]);
    }
  }

  private async create(
    input: TextRobotInput,
    command: NormalizedScheduleCommand,
    reference: Date,
    options: { sourceOperationId?: string; quietDuplicate?: boolean } = {},
  ): Promise<CreateResult> {
    const missing = getMissingCommandFields(command);
    if (missing.length) throw new Error(`缺少${missing.join('、')}信息`);
    const hasExplicitStart =
      hasExplicitSourceTime(input.text, command.startText) &&
      isRecognizedScheduleTime(command.startText);
    const effectiveStartText = hasExplicitStart
      ? command.startText
      : DEFAULT_CREATE_START_TEXT;
    const recurrence = parseScheduleRecurrence(
      input.text,
      reference,
      effectiveStartText,
    );
    const summary = recurrence
      ? stripScheduleRecurrence(command.title) || command.title
      : command.title;
    const effectiveColor =
      recurrence && !command.colorExplicit
        ? { name: '黄色' as const, rgb: EVENT_COLORS.黄色 }
        : command.color;
    const crossDay = parseCrossDayScheduleRange(input.text, reference);
    if (crossDay && recurrence) {
      throw new Error('跨日日程暂不支持重复规则，请拆分为单次跨日日程');
    }
    const range =
      crossDay ||
      computeScheduleRange(
        recurrence?.dateText || command.dateText || '今天',
        effectiveStartText,
        command.endText,
        command.durationMinutes,
        reference,
      );
    const queryRange = crossDay
      ? { start: range.startTime, end: range.endTime }
      : getShanghaiDayRangeDates(range.startTime);
    const existing = await this.feishu.listCalendarEvents(
      queryRange.start,
      queryRange.end,
    );
    const duplicate = existing.find(
      (event) =>
        event.summary.trim() === summary &&
        event.startTime.getTime() === range.startTime.getTime(),
    );
    if (duplicate) {
      if (!options.quietDuplicate) {
        await this.reply(
          input,
          `未重复创建：该日程已存在。\n${this.formatEvent(duplicate)}`,
          'duplicate',
        );
      }
      return 'duplicate';
    }
    const conflicts = existing.filter(
      (event) =>
        (!crossDay?.allDay || event.allDay) &&
        event.startTime < range.endTime &&
        event.endTime > range.startTime,
    );
    const after: CalendarEventSnapshot = {
      summary,
      startTime: range.startTime.toISOString(),
      endTime: range.endTime.toISOString(),
      location: command.location || undefined,
      color: effectiveColor.rgb,
      colorName: effectiveColor.name,
      reminders: command.reminderMinutes,
      recurrence: recurrence?.rrule,
      recurrenceText: recurrence?.label,
      allDay: crossDay?.allDay,
    };
    const draft = {
      operation: 'create' as const,
      sourceOperationId: options.sourceOperationId,
      after,
      red: effectiveColor.name === '红色',
      conflicts,
    };
    if (draft.red || conflicts.length > 0) {
      await this.actions.promptMutation(input, draft);
      return 'pending';
    } else {
      await this.actions.executeDirect(input, draft);
      return 'created';
    }
  }

  private async update(
    input: TextRobotInput,
    command: NormalizedScheduleCommand,
    raw: ChineseScheduleParseOneOutput,
    reference: Date,
  ) {
    const intent = parseScheduleUpdateIntent(input.text, command.title);
    const request: StoredCalendarUpdateRequest = {
      sourceText: input.text,
      command,
      raw,
      referenceTime: reference.toISOString(),
    };
    const targetCommand: NormalizedScheduleCommand = {
      ...command,
      title: intent.target.title || command.title,
      dateText:
        intent.target.dateText ||
        (!intent.changes.dateText ? command.dateText : ''),
    };
    let matches: CalendarEventRecord[] = [];
    let referenced = false;
    if (input.parentId) {
      const eventIds = await this.store.getCalendarCardReference(
        input.parentId,
        input.senderOpenId || this.targetOpenId(),
        input.chatId || this.targetChatId(),
      );
      if (eventIds.length > 0) {
        referenced = true;
        const loaded = await Promise.all(
          eventIds.map((eventId) => this.feishu.getCalendarEvent(eventId)),
        );
        if (loaded.some((event) => event === null)) {
          await this.reply(
            input,
            '引用卡片中的日程已有项目不存在，未执行修改。请重新查询后再选择。',
            'referenced-event-missing',
          );
          return;
        }
        matches = loaded.filter(
          (event): event is CalendarEventRecord => event !== null,
        );
        if (matches.length === 0) {
          await this.reply(
            input,
            '引用的日程已不存在，未执行修改。',
            'referenced-event-missing',
          );
          return;
        }
      }
    }
    if (!referenced && intent.target.dateText) {
      matches = await this.findCandidates(
        targetCommand,
        input.text,
        reference,
        intent.target.timeText,
      );
    } else if (!referenced) {
      const keyword = this.updateTargetKeyword(request);
      if (!keyword) {
        await this.reply(
          input,
          '没有识别到要修改的事项名称。请补充标题，或回复一张日程卡片后再修改。',
          'update-title-missing',
        );
        return;
      }
      const range = updateSearchWindow(reference, 'primary');
      matches = rankUpdateCandidates(
        await this.feishu.listCalendarEvents(range.start, range.end),
        keyword,
      );
      if (matches.length === 0) {
        await this.promptExtendedSearch(input, request, range.start, range.end);
        return;
      }
    }
    if (matches.length === 0) {
      await this.reply(
        input,
        '未找到符合条件的日程，未执行任何修改。',
        'not-found',
      );
      return;
    }
    if (matches.length > 1) {
      await this.sendUpdateCandidates(input, matches, request, false);
      return;
    }
    await this.applyUpdateToEvent(input, matches[0], request);
  }

  private async applyUpdateToEvent(
    input: TextRobotInput,
    original: CalendarEventRecord,
    request: StoredCalendarUpdateRequest,
  ) {
    const command = request.command;
    const raw = request.raw;
    const reference = new Date(request.referenceTime);
    const intent = parseScheduleUpdateIntent(request.sourceText, command.title);
    const recurrenceScope = parseScheduleRecurrenceScope(request.sourceText);
    const isRecurring = !!(original.recurrence || original.recurringEventId);
    if (isRecurring && !recurrenceScope) {
      await this.reply(
        input,
        '这是重复日程，尚未执行修改。请明确作用范围：仅此次、此次及后续，或全部。',
        'recurrence-scope-required',
      );
      return;
    }
    const selectedBefore = this.actions.snapshot(original);
    const selectedAfter: CalendarEventSnapshot = { ...selectedBefore };
    const changes: string[] = [];
    let timeChanged = false;
    const newDateText = intent.changes.dateText;
    const newStartText = intent.changes.timeText;
    if (newDateText || newStartText) {
      const originalDuration = Math.round(
        (original.endTime.getTime() - original.startTime.getTime()) / 60000,
      );
      const range = computeScheduleRange(
        newDateText || this.formatDateInput(original.startTime),
        newStartText || this.formatTime(original.startTime),
        command.endText &&
          hasExplicitSourceTime(request.sourceText, command.endText)
          ? command.endText
          : '',
        raw.duration_minutes || originalDuration,
        reference,
      );
      selectedAfter.startTime = range.startTime.toISOString();
      selectedAfter.endTime = range.endTime.toISOString();
      timeChanged = true;
      changes.push(
        `${this.formatRange(original.startTime, original.endTime)} → ${this.formatRange(range.startTime, range.endTime)}`,
      );
    }
    if (raw.color?.trim()) {
      selectedAfter.color = command.color.rgb;
      selectedAfter.colorName = command.color.name;
      changes.push(`颜色改为${command.color.name}`);
    }
    if (raw.location?.trim()) {
      selectedAfter.location = command.location;
      changes.push(`地点改为${command.location}`);
    }
    if (intent.changes.title && intent.changes.title !== original.summary) {
      selectedAfter.summary = intent.changes.title;
      changes.push(`事项改为${intent.changes.title}`);
    }
    if (changes.length === 0)
      throw new Error('未识别到需要修改的时间、颜色、地点或事项');
    let conflicts: CalendarEventRecord[] = [];
    if (timeChanged) {
      const start = new Date(selectedAfter.startTime);
      const end = new Date(selectedAfter.endTime);
      const day = getShanghaiDayRangeDates(start);
      conflicts = (
        await this.feishu.listCalendarEvents(day.start, day.end)
      ).filter(
        (event) =>
          event.eventId !== original.eventId &&
          event.startTime < end &&
          event.endTime > start,
      );
    }
    let operation: 'update' | 'update_future' = 'update';
    let eventId = original.eventId;
    let before = selectedBefore;
    let after = selectedAfter;
    let display: CalendarEventSnapshot | undefined;
    let truncatedRecurrence: string | undefined;
    if (isRecurring && recurrenceScope && recurrenceScope !== 'single') {
      const masterId = recurringMasterEventId(
        original.eventId,
        original.recurringEventId,
      );
      const master = await this.feishu.getCalendarEvent(masterId);
      if (!master?.recurrence) {
        throw new Error('未能读取重复日程主系列，请稍后重试');
      }
      const masterBefore = this.actions.snapshot(master);
      eventId = masterId;
      before = masterBefore;
      display = selectedAfter;
      if (recurrenceScope === 'future') {
        operation = 'update_future';
        after = {
          ...selectedAfter,
          recurrence: master.recurrence,
          recurrenceText: masterBefore.recurrenceText,
        };
        truncatedRecurrence = truncateScheduleRecurrence(
          master.recurrence,
          original.startTime,
        );
      } else {
        const startDelta =
          new Date(selectedAfter.startTime).getTime() -
          original.startTime.getTime();
        const endDelta =
          new Date(selectedAfter.endTime).getTime() -
          original.endTime.getTime();
        after = {
          ...masterBefore,
          summary: selectedAfter.summary,
          startTime: new Date(
            master.startTime.getTime() + startDelta,
          ).toISOString(),
          endTime: new Date(master.endTime.getTime() + endDelta).toISOString(),
          location: selectedAfter.location,
          color: selectedAfter.color,
          colorName: selectedAfter.colorName,
          reminders: selectedAfter.reminders,
        };
      }
    }
    const draft = {
      operation,
      eventId,
      before,
      after,
      display,
      truncatedRecurrence,
      red: before.colorName === '红色' || after.colorName === '红色',
      conflicts,
    };
    if (draft.red || conflicts.length > 0) {
      await this.actions.promptMutation(input, draft);
    } else {
      await this.actions.executeDirect(input, draft);
    }
  }

  private updateTargetKeyword(request: StoredCalendarUpdateRequest) {
    const intent = parseScheduleUpdateIntent(
      request.sourceText,
      request.command.title,
    );
    const title = (intent.target.title || request.command.title).trim();
    return /^(?:这个|该|这条)(?:日程|安排|事项)?$/.test(title) ? '' : title;
  }

  private async promptExtendedSearch(
    input: TextRobotInput,
    request: StoredCalendarUpdateRequest,
    searchedStart: Date,
    searchedEnd: Date,
  ) {
    const now = new Date(request.referenceTime);
    const action: CalendarSearchExpansionPending = {
      kind: 'calendar_search_expansion',
      actionId: randomUUID(),
      actorOpenId: input.senderOpenId || this.targetOpenId(),
      chatId: input.chatId || this.targetChatId(),
      sourceMessageId: input.messageId,
      request,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.store.saveCardAction(action);
    try {
      const cardMessageId = await this.feishu.replyInteractiveCard(
        input.messageId,
        buildCalendarSearchExpansionCard({
          actionId: action.actionId,
          keyword: this.updateTargetKeyword(request),
          searchedRange: `${this.formatDate(searchedStart)} ${this.formatTime(searchedStart)} 至 ${this.formatDate(searchedEnd)} ${this.formatTime(searchedEnd)}`,
          expiresAt: `${this.formatDate(new Date(action.expiresAt))} ${this.formatTime(new Date(action.expiresAt))}`,
        }),
        stableUuid(`calendar-search-expansion:${action.actionId}`),
      );
      await this.store.bindCardMessage(action.actionId, cardMessageId);
    } catch (error) {
      await this.store.completeCardAction(
        action.actionId,
        'fail',
        'card-send-failed',
        this.publicError(error),
      );
      throw error;
    }
  }

  private async sendUpdateCandidates(
    input: TextRobotInput,
    events: CalendarEventRecord[],
    request: StoredCalendarUpdateRequest,
    extended: boolean,
  ) {
    const unique = [
      ...new Map(events.map((event) => [event.eventId, event])).values(),
    ];
    const messageId = await this.reply(
      input,
      [
        extended
          ? '已查找到未来两年内的日程，尚未修改。请回复本条消息并继续艾特机器人，只发送一个序号。'
          : '找到多条可能的日程，尚未修改。请回复本条消息并继续艾特机器人，只发送一个序号。',
        ...unique.flatMap((event, index) => [
          `${index + 1}. ${this.formatEvent(event)}`,
          `   拟修改为：${this.formatUpdatePreview(event, request)}`,
        ]),
      ].join('\n'),
      extended ? 'extended-update-candidates' : 'update-candidates',
    );
    await this.store.savePending(messageId, {
      kind: 'calendar_update_selection',
      request,
      candidates: unique.map((event) => ({
        eventId: event.eventId,
        summary: event.summary,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
    });
  }

  private formatUpdatePreview(
    event: CalendarEventRecord,
    request: StoredCalendarUpdateRequest,
  ) {
    const intent = parseScheduleUpdateIntent(
      request.sourceText,
      request.command.title,
    );
    let start = event.startTime;
    let end = event.endTime;
    if (intent.changes.dateText || intent.changes.timeText) {
      const duration = Math.round(
        (event.endTime.getTime() - event.startTime.getTime()) / 60000,
      );
      const range = computeScheduleRange(
        intent.changes.dateText || this.formatDateInput(event.startTime),
        intent.changes.timeText || this.formatTime(event.startTime),
        request.command.endText &&
          hasExplicitSourceTime(request.sourceText, request.command.endText)
          ? request.command.endText
          : '',
        request.raw.duration_minutes || duration,
        new Date(request.referenceTime),
      );
      start = range.startTime;
      end = range.endTime;
    }
    const summary = intent.changes.title || event.summary;
    return `${this.formatRange(start, end)}｜${summary}`;
  }

  private targetOpenId() {
    return (
      process.env.TARGET_OPEN_ID ||
      process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
      ''
    );
  }

  private targetChatId() {
    return process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '';
  }

  private async requestCancellation(
    input: TextRobotInput,
    command: NormalizedScheduleCommand,
    reference: Date,
  ) {
    const matches = await this.findCandidates(command, input.text, reference);
    if (matches.length === 0) {
      await this.reply(
        input,
        '未找到符合条件的日程，未执行取消。',
        'not-found',
      );
      return;
    }
    if (matches.length > 1) {
      await this.sendCancellationCandidates(input, matches);
      return;
    }
    const listed = matches[0];
    const event =
      (await this.feishu.getCalendarEvent(listed.eventId)) || listed;
    await this.promptCancellation(input, event);
  }

  private async promptCancellation(
    input: TextRobotInput,
    event: CalendarEventRecord,
    sourceOperationId?: string,
  ) {
    const recurrenceScope = parseScheduleRecurrenceScope(input.text);
    const isRecurring = !!(event.recurrence || event.recurringEventId);
    if (isRecurring && !recurrenceScope) {
      await this.reply(
        input,
        '这是重复日程，尚未执行删除。请明确作用范围：仅此次、此次及后续，或全部。',
        'recurrence-scope-required',
      );
      return false;
    }
    let operation: 'cancel' | 'cancel_future' = 'cancel';
    let eventId = event.eventId;
    let before = this.actions.snapshot(event);
    let display: CalendarEventSnapshot | undefined;
    let truncatedRecurrence: string | undefined;
    if (isRecurring && recurrenceScope && recurrenceScope !== 'single') {
      const masterId = recurringMasterEventId(
        event.eventId,
        event.recurringEventId,
      );
      const master = await this.feishu.getCalendarEvent(masterId);
      if (!master?.recurrence) {
        throw new Error('未能读取重复日程主系列，请稍后重试');
      }
      eventId = masterId;
      before = this.actions.snapshot(master);
      display = this.actions.snapshot(event);
      if (recurrenceScope === 'future') {
        operation = 'cancel_future';
        truncatedRecurrence = truncateScheduleRecurrence(
          master.recurrence,
          event.startTime,
        );
      }
    }
    const createdByBot = await this.store.getCreatedEventById(eventId);
    const restorable =
      operation === 'cancel_future' ||
      (!!createdByBot &&
        event.attendeeCount === 0 &&
        !isRecurring &&
        !event.hasMeeting);
    await this.actions.promptMutation(input, {
      operation,
      sourceOperationId,
      eventId,
      before,
      display,
      truncatedRecurrence,
      red: before.colorName === '红色',
      conflicts: [],
      restorable,
    });
    return true;
  }

  private async findCandidates(
    command: NormalizedScheduleCommand,
    sourceText: string,
    reference: Date,
    targetTimeText = '',
  ): Promise<CalendarEventRecord[]> {
    if (/刚才|刚刚/.test(sourceText)) {
      const recent = await this.store.getRecentCreatedEvent(reference);
      if (!recent) return [];
      const day = getShanghaiDayRangeDates(new Date(recent.startTime));
      const events = await this.feishu.listCalendarEvents(day.start, day.end);
      return events.filter((event) => event.eventId === recent.eventId);
    }
    const day = getShanghaiDayRangeDates(
      resolveScheduleDate(command.dateText || '今天', reference),
    );
    const events = await this.feishu.listCalendarEvents(day.start, day.end);
    const rawTitle = command.title.trim();
    const title = /^(?:(?:全部|所有)的?)?(?:日程|安排|事项)$/.test(rawTitle)
      ? ''
      : rawTitle;
    const clock = targetTimeText ? resolveScheduleClock(targetTimeText) : null;
    return events.filter((event) => {
      const titleMatches =
        !title || event.summary === title || event.summary.includes(title);
      return (
        titleMatches && (!clock || this.matchesClock(event.startTime, clock))
      );
    });
  }

  private async parse(text: string): Promise<ChineseScheduleParseOneOutput> {
    return (await this.capabilityService
      .load(SCHEDULE_PARSE_ID)
      .call('textToJson', {
        schedule_text: text,
      })) as ChineseScheduleParseOneOutput;
  }

  private normalize(
    raw: ChineseScheduleParseOneOutput,
    sourceText = '',
  ): NormalizedScheduleCommand {
    const parsedDate = String(raw.date || '').trim();
    const sourceDate = sourceText
      ? findScheduleDateExpression(sourceText)
      : null;
    const dateText =
      sourceDate?.text ||
      (parsedDate && (!sourceText || sourceText.includes(parsedDate))
        ? parsedDate
        : '');
    return normalizeScheduleCommand({
      action: raw.action,
      title: raw.title,
      date: dateText,
      start_time: raw.start_time || raw.time,
      end_time: raw.end_time,
      duration_minutes: raw.duration_minutes,
      color: raw.color,
      location: raw.location,
      reminder_minutes: raw.reminder_minutes,
    });
  }

  private reply(
    input: TextRobotInput,
    text: string,
    result: string,
  ): Promise<string> {
    return this.feishu.replyTextMessage(
      input.messageId,
      text,
      stableUuid(`reply:${input.messageId}:${result}`),
    );
  }

  private formatCandidates(events: CalendarEventRecord[]) {
    return `找到多条日程，未执行操作。请补充更准确的标题或时间：\n${events
      .map((event, index) => `${index + 1}. ${this.formatEvent(event)}`)
      .join('\n')}`;
  }

  private async sendCancellationCandidates(
    input: TextRobotInput,
    events: CalendarEventRecord[],
  ) {
    const unique = [
      ...new Map(events.map((event) => [event.eventId, event])).values(),
    ];
    const messageId = await this.reply(
      input,
      [
        '找到多条日程，尚未执行删除。请回复本条消息并继续艾特机器人，发送要删除的序号。',
        ...unique.map(
          (event, index) => `${index + 1}. ${this.formatEvent(event)}`,
        ),
        '也可以直接在群里重新艾特机器人发送序号。示例：@日程机器人 1 2 3，或 @日程机器人 1、3、5-7',
      ].join('\n'),
      'cancel-candidates',
    );
    await this.store.savePending(messageId, {
      kind: 'calendar_cancel_selection',
      candidates: unique.map((event) => ({
        eventId: event.eventId,
        summary: event.summary,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
    });
  }

  private formatEvent(event: CalendarEventRecord) {
    return `${this.formatRange(event.startTime, event.endTime)}｜${event.summary}${event.location ? `｜${event.location}` : ''}`;
  }

  private formatRange(start: Date, end: Date) {
    return `${this.formatDate(start)} ${this.formatTime(start)}-${this.formatTime(end)}`;
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(date)
      .replaceAll('/', '-');
  }

  private formatTime(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private formatDateInput(date: Date) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}年${value('month')}月${value('day')}日`;
  }

  private matchesClock(date: Date, clock: { hour: number; minute: number }) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return hour === clock.hour && minute === clock.minute;
  }

  private publicError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
