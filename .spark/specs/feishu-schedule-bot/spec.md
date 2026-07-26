# 技术方案

## 开发元信息

- 开发模式: 全栈应用
- 涉及层级: [数据库, 插件, 服务端, 前端]

## 页面路由与导航

### 页面路由
| 路由路径 | 页面名称 |
|----------|---------|
| / | 机器人状态与配置看板 |

### 导航设计
- 导航机制：无
- 导航项：无

## 业务组件

| 组件 | 来源 | 关联页面 | 对应功能点 |
|------|------|---------|-----------|
| 卡片组件 | 官方内置组件 | 机器人状态与配置看板 | 健康状态卡片展示 |
| 表格组件 | 官方内置组件 | 机器人状态与配置看板 | 最近活动日志展示 |
| 标签组件 | 官方内置组件 | 机器人状态与配置看板 | 操作成功/失败状态标记 |
| 状态指示器 | 官方内置组件 | 机器人状态与配置看板 | 环境变量校验状态高亮 |

## 数据模型

### 数据库设计
#### 操作日志表（operation_log）
用途：存储机器人所有操作记录，包括@消息处理、定时推送、权限检测日志。
核心字段：
- type: varchar ['message_process', 'schedule_push', 'health_check'] 操作类型
- status: varchar ['success', 'fail'] 操作结果
- content: text 原始输入内容（如用户消息文本）
- result: text 处理结果描述
- error_msg: text 错误信息（失败时非空）

## 插件设计

| 插件名称 | 基础插件 | 用途 | 调用方式 | 关联页面 | 输入参数 | 输出类型 |
|---------|---------|------|---------|---------|---------|---------|
| 中文日程解析 | ai-text-to-json | 从用户@消息文本中提取日程标题、开始时间、时长 | 服务端调用 | 无（服务端逻辑） | {content: string} | {title: string, start_time: string, duration: number} |
| 飞书群消息发送 | send-feishu-message | 向指定飞书群发送处理结果、日程提醒 | 服务端调用 | 无（服务端逻辑） | {chat_id: string, content: string} | {success: boolean} |
| 飞书日程操作 | feishu-calendar | 创建飞书日程、查询用户当日日程列表 | 服务端调用 | 无（服务端逻辑） | {action: string, user_open_id: string, [other_params]: any} | {success: boolean, data: any} |

## 业务模型

### API 设计

#### 机器人状态与配置看板 相关

**页面路径**: /

**功能全景**：
| 功能 | 实现方式 | 说明 |
|------|----------|------|
| 展示服务健康状态 | API | GET /api/health/check |
| 展示最近操作日志 | API | GET /api/operation/logs |
| 展示环境变量校验结果 | API | GET /api/env/check |
| 接收飞书群@消息事件 | 平台自动化触发器 | POST /api/feishu/event |
| 每日定时推送当日日程 | 平台定时任务 | POST /api/schedule/daily-push |

**所需 API**:
```typescript
// 检测服务运行与权限状态 [领域模型: 无] [对应页面功能: 健康状态卡片展示]
GET /api/health/check
Response: {
  message_listen: { status: 'normal' | 'abnormal', desc: string };
  schedule_task: { status: 'normal' | 'abnormal', desc: string };
  calendar_permission: { status: 'normal' | 'abnormal', desc: string };
}

// 获取操作日志列表 [领域模型: OperationLogModel] [对应页面功能: 最近活动日志展示]
GET /api/operation/logs?page=1&pageSize=20
Response: {
  items: Array<{
    id: string;
    type: 'message_process' | 'schedule_push' | 'health_check';
    status: 'success' | 'fail';
    content: string;
    result: string;
    error_msg?: string;
    _created_at: string;
  }>;
  total: number;
}

// 校验环境变量配置完整性 [领域模型: 无] [对应页面功能: 环境变量校验面板]
GET /api/env/check
Response: {
  variables: Array<{
    key: 'APP_ID' | 'APP_SECRET' | 'CHAT_ID' | 'TARGET_OPEN_ID';
    exists: boolean;
    value?: string;
  }>;
}

// 接收飞书消息事件回调 [领域模型: OperationLogModel] [对应功能: 群@消息处理]
POST /api/feishu/event
Request Body: {
  header: any;
  event: any;
}
Response: {
  code: number;
  msg: string;
}

// 每日日程推送定时任务触发接口 [领域模型: OperationLogModel] [对应功能: 每日08:50推送日程]
POST /api/schedule/daily-push
Response: {
  success: boolean;
  msg: string;
}
```

---

## 飞书开放平台配置要求（需手动完成）
### 权限申请
1. `im:message.group:readonly` - 读取群聊消息
2. `im:message:send_as_bot` - 以机器人身份发送群消息
3. `calendar:event:write` - 创建日程事件
4. `calendar:event:readonly` - 读取用户日程列表

### 事件订阅
1. 事件类型：`im.message.receive_v1` - 接收消息事件
2. 回调地址：`{应用部署域名}/api/feishu/event`

### 定时任务（平台自动配置）
- Cron 表达式：`0 50 8 * * *`
- 时区：`Asia/Shanghai`
- 触发接口：`POST /api/schedule/daily-push`