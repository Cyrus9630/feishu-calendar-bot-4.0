import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  MessageSquare,
  MousePointerClick,
  RefreshCw,
  Server,
  TriangleAlert,
  XCircle,
  CircleHelp,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { robot } from '@client/src/api';
import type {
  DashboardHealthItem,
  DashboardOperationItem,
  DashboardSummaryResponse,
  OperationLogStatus,
} from '@shared/api.interface';

const HEALTH_ICONS: Record<DashboardHealthItem['key'], React.ElementType> = {
  message: MessageSquare,
  calendar: CalendarCheck,
  card: MousePointerClick,
  daily0900: Clock3,
  early1700: BellRing,
};

const TYPE_LABELS: Record<string, string> = {
  message_process: '文字消息',
  pending_action: '候选待处理',
  calendar_action: '日程确认',
  calendar_undo: '一键撤销',
  card_action: '卡片回调',
  calendar_created: '创建记录',
  daily_0900: '九点汇总',
  early_1700: '五点提醒',
  schedule_push: '定时推送',
  health_check: '健康检查',
};

const STATUS_TEXT: Record<OperationLogStatus, string> = {
  processing: '待处理', claimed: '执行中', success: '成功', fail: '失败',
};

const OVERALL_STATUS = {
  normal: { label: '运行正常', variant: 'default' as const },
  attention: { label: '需要关注', variant: 'destructive' as const },
  unknown: { label: '等待数据', variant: 'secondary' as const },
};

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await robot.getDashboardSummary());
      setError('');
    } catch (cause) {
      logger.error('获取机器人运行状态失败', cause);
      setError('状态读取失败，请稍后重试');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const checkedAt = data
    ? new Date(data.checkedAt).toLocaleString('zh-CN', { timeZone: data.timezone, hour12: false })
    : '尚未检查';
  const overall = data
    ? OVERALL_STATUS[data.overall]
    : { label: loading ? '正在检查' : '尚未检查', variant: 'secondary' as const };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-8">
      <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            <h1 className="text-lg font-semibold tracking-tight">日程机器人运行面板</h1>
            <Badge variant={overall.variant}>
              {overall.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground font-mono">
            v{data?.version ?? '—'} · Asia/Shanghai · 最近检查 {checkedAt} · 每 30 秒自动刷新
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />
          立即刷新
        </Button>
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="size-4" />{error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="24 小时处理" value={data?.stats.processed} loading={loading} />
        <Metric label="成功" value={data?.stats.success} loading={loading} tone="success" />
        <Metric label="失败" value={data?.stats.failed} loading={loading} tone="danger" />
        <Metric label="待确认／可撤销" value={data?.stats.pending} loading={loading} tone="warning" />
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Activity className="size-4 text-muted-foreground" />六类实时状态
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(data?.health ?? []).map((item) => <HealthCard key={item.key} item={item} />)}
          {loading && !data && Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-sm border border-border bg-muted/40" />
          ))}
        </div>
      </section>

      <Card className="rounded-sm border-border shadow-none">
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm font-medium">最近操作</CardTitle>
          <span className="text-xs text-muted-foreground">仅显示脱敏摘要，页面不可执行写入操作</span>
        </CardHeader>
        <CardContent className="p-0">
          {!data?.recent.length ? (
            <div className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {loading ? '正在读取运行记录…' : '最近 24 小时暂无操作'}
            </div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {data.recent.map((item) => <OperationRow key={item.id} item={item} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const Metric: React.FC<{ label: string; value?: number; loading: boolean; tone?: 'success' | 'danger' | 'warning' }> = ({ label, value, loading, tone }) => {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-amber-500' : 'text-foreground';
  return (
    <Card className="rounded-sm border-border shadow-none">
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${color}`}>{loading && value === undefined ? '—' : value ?? 0}</p>
      </CardContent>
    </Card>
  );
};

const HealthCard: React.FC<{ item: DashboardHealthItem }> = ({ item }) => {
  const Icon = HEALTH_ICONS[item.key];
  const healthy = item.status === 'normal';
  const unknown = item.status === 'unknown';
  const tone = healthy
    ? {
        border: 'border-success/30',
        icon: 'text-success',
        text: 'text-success',
        label: '正常',
        StatusIcon: CheckCircle2,
      }
    : unknown
      ? {
          border: 'border-border',
          icon: 'text-muted-foreground',
          text: 'text-muted-foreground',
          label: '尚无数据',
          StatusIcon: CircleHelp,
        }
      : {
          border: 'border-destructive/40',
          icon: 'text-destructive',
          text: 'text-destructive',
          label: '待检查',
          StatusIcon: XCircle,
        };
  const StatusIcon = tone.StatusIcon;
  return (
    <Card className={`rounded-sm shadow-none ${tone.border}`}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className={`mt-0.5 size-4 shrink-0 ${tone.icon}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{item.label}</span>
            <span className={`flex items-center gap-1 text-xs ${tone.text}`}>
              <StatusIcon className="size-3.5" />
              {tone.label}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={item.desc}>{item.desc}</p>
          <p className="mt-1 text-[11px] text-muted-foreground font-mono">
            {item.lastAt ? new Date(item.lastAt).toLocaleString('zh-CN', { hour12: false }) : '暂无运行记录'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

const OperationRow: React.FC<{ item: DashboardOperationItem }> = ({ item }) => {
  const pending = item.status === 'processing' || item.status === 'claimed';
  const remaining = item.expiresAt ? Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 60_000)) : null;
  return (
    <div className="grid grid-cols-[92px_76px_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30">
      <span className="text-xs text-muted-foreground">{TYPE_LABELS[item.type] ?? item.type}</span>
      <Badge variant={item.status === 'fail' ? 'destructive' : pending ? 'secondary' : 'default'} className="w-fit text-[10px]">
        {STATUS_TEXT[item.status]}
      </Badge>
      <span className="min-w-0 truncate" title={item.summary}>{item.summary}</span>
      <div className="text-right text-[11px] text-muted-foreground font-mono">
        <div>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
        {remaining !== null && pending && <div>{remaining > 0 ? `剩余 ${remaining} 分钟` : '已到期'}</div>}
      </div>
    </div>
  );
};

export default DashboardPage;
