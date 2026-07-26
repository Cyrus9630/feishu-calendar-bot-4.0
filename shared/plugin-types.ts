// ---- plugin:send_feishu_schedule_group_notification_1 ----
// ============================================================
// 插件 send_feishu_schedule_group_notification_1 (发送重要日程群通知) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface SendFeishuScheduleGroupNotificationOneInput {
  /** 消息底部按钮配置，最多3个 */
  message_buttons?: string[];
  /** 消息标题 */
  message_title: string;
  /** 消息正文内容，支持markdown格式 */
  message_content: string;
}

/**
 * capabilityClient.load('send_feishu_schedule_group_notification_1').call<SendFeishuScheduleGroupNotificationOneOutput>('send_feishu_message', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { success } = result;
 */
export interface SendFeishuScheduleGroupNotificationOneOutput {
  /** [object Object] */
  success: boolean;
}
// ---- end:send_feishu_schedule_group_notification_1 ----

// ---- plugin:chinese_schedule_parse_1 ----
// ============================================================
// 插件 chinese_schedule_parse_1 (中文日程解析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface ChineseScheduleParseOneInput {
  /** 包含日程信息的中文自然语言文本 */
  schedule_text: string;
}

/**
 * capabilityClient.load('chinese_schedule_parse_1').call<ChineseScheduleParseOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { title, date, time, ... } = result;
 */
export interface ChineseScheduleParseOneOutput {
  /** 操作类型：create、update、cancel、help */
  action?: string;
  /** 日程标题，准确概括日程的核心内容 */
  title: string;
  /** 日期信息，保留原文中的日期表达方式，如明天、7月10日、下周一等 */
  date: string;
  /** 开始时间，保留原文表达；仅有上午、下午、晚上时也原样保留 */
  start_time?: string;
  /** 旧版本解析能力的兼容字段 */
  time?: string;
  /** 明确的结束时间；没有时填空字符串 */
  end_time?: string;
  /** 日程时长，转换为分钟数，没有明确时长时填0 */
  duration_minutes: number;
  /** 颜色原文，没有时填空字符串 */
  color?: string;
  /** 地点原文，没有时填空字符串 */
  location?: string;
  /** 提醒分钟数，多个用英文逗号分隔，没有时填空字符串 */
  reminder_minutes?: string;
}
// ---- end:chinese_schedule_parse_1 ----
