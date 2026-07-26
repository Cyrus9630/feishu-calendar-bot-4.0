import type { EventColorName } from './schedule-command';
import type { StoredCalendarUpdateRequest } from './calendar-update-search';

export type CalendarOperation =
  'create' | 'update' | 'cancel' | 'update_future' | 'cancel_future';
export type CardActionDecision =
  | 'confirm'
  | 'decline'
  | 'undo'
  | 'manage'
  | 'postpone_hour'
  | 'tomorrow_10'
  | 'cancel_event'
  | 'back_agenda'
  | 'search_two_years'
  | 'cancel_search';

export interface CalendarEventSnapshot {
  eventId?: string;
  summary: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  color: number;
  colorName: EventColorName;
  reminders: number[];
  recurrence?: string;
  recurrenceText?: string;
  allDay?: boolean;
}

export interface CalendarMutationPending {
  kind: 'calendar_mutation';
  actionId: string;
  operation: CalendarOperation;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  cardMessageId?: string;
  eventId?: string;
  before?: CalendarEventSnapshot;
  after?: CalendarEventSnapshot;
  display?: CalendarEventSnapshot;
  truncatedRecurrence?: string;
  red: boolean;
  conflictIds: string[];
  restorable: boolean;
  expiresAt: string;
}

export interface CalendarUndoPending {
  kind: 'calendar_undo';
  actionId: string;
  operation: CalendarOperation;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  cardMessageId?: string;
  eventId?: string;
  before?: CalendarEventSnapshot;
  after?: CalendarEventSnapshot;
  display?: CalendarEventSnapshot;
  truncatedRecurrence?: string;
  expiresAt: string;
}

export interface AgendaQuerySnapshot {
  startTime: string;
  endTime: string;
  label: string;
  color?: number;
  mentionOpenId?: string;
}

export interface AgendaActionPending {
  kind: 'agenda_action';
  actionId: string;
  expectedDecision: Extract<
    CardActionDecision,
    'manage' | 'postpone_hour' | 'tomorrow_10' | 'cancel_event' | 'back_agenda'
  >;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  cardMessageId?: string;
  eventId?: string;
  query: AgendaQuerySnapshot;
  expiresAt: string;
}

export interface CalendarSearchExpansionPending {
  kind: 'calendar_search_expansion';
  actionId: string;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  cardMessageId?: string;
  request: StoredCalendarUpdateRequest;
  expiresAt: string;
}

export type StoredCardAction =
  | CalendarMutationPending
  | CalendarUndoPending
  | AgendaActionPending
  | CalendarSearchExpansionPending;

export interface CardActionValue {
  actionId: string;
  decision: CardActionDecision;
}
