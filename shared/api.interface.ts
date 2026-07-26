// ===== Health Check =====

export interface HealthStatusItem {
  status: 'normal' | 'abnormal' | 'unknown';
  desc: string;
}

export interface HealthCheckResponse {
  messageListen: HealthStatusItem;
  scheduleTask: HealthStatusItem;
  calendarPermission: HealthStatusItem;
}

// ===== Operation Log =====

export type OperationLogType =
  | 'message_process'
  | 'pending_action'
  | 'calendar_action'
  | 'agenda_action'
  | 'calendar_undo'
  | 'calendar_card_reference'
  | 'card_action'
  | 'calendar_created'
  | 'schedule_push'
  | 'daily_0900'
  | 'early_1700'
  | 'health_check';
export type OperationLogStatus = 'processing' | 'claimed' | 'success' | 'fail';

export interface OperationLogItem {
  id: string;
  type: OperationLogType;
  status: OperationLogStatus;
  content: string;
  result: string;
  errorMsg: string | null;
  createdAt: string;
}

export interface OperationLogsResponse {
  items: OperationLogItem[];
  total: number;
}

// ===== Env Check =====

export type EnvVarKey =
  | 'APP_ID'
  | 'APP_SECRET'
  | 'CHAT_ID'
  | 'TARGET_OPEN_ID'
  | 'TARGET_CALENDAR_ID'
  | 'BOT_OPEN_ID'
  | 'VERIFICATION_TOKEN'
  | 'ENCRYPT_KEY';

export interface EnvVarItem {
  key: EnvVarKey;
  exists: boolean;
  masked: boolean;
}

export interface EnvCheckResponse {
  variables: EnvVarItem[];
}

// ===== Feishu Event =====

export interface FeishuEventRequest {
  header: Record<string, unknown>;
  event: Record<string, unknown>;
}

export interface FeishuEventResponse {
  code: number;
  msg: string;
}

// ===== Schedule =====

export interface ScheduleDailyPushResponse {
  success: boolean;
  msg: string;
}

// ===== Runtime Dashboard =====

export interface DashboardHealthItem extends HealthStatusItem {
  key: 'message' | 'calendar' | 'card' | 'daily0900' | 'early1700';
  label: string;
  lastAt: string | null;
}

export interface DashboardOperationItem {
  id: string;
  type: OperationLogType;
  status: OperationLogStatus;
  summary: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface DashboardSummaryResponse {
  overall: 'normal' | 'attention' | 'unknown';
  checkedAt: string;
  timezone: 'Asia/Shanghai';
  version: string;
  stats: {
    processed: number;
    success: number;
    failed: number;
    pending: number;
  };
  health: DashboardHealthItem[];
  recent: DashboardOperationItem[];
}
