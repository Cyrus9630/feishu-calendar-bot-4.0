import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('operation_log 行级安全策略', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'scripts/sql/2026-07-15-operation-log-card-policies.sql',
    ),
    'utf8',
  );

  it.each([
    'message_process',
    'pending_action',
    'calendar_action',
    'agenda_action',
    'calendar_undo',
    'card_action',
    'calendar_created',
    'schedule_push',
    'daily_0900',
    'early_1700',
    'health_check',
  ])('允许机器人写入操作类型 %s', (type) => {
    expect(sql).toContain(`'${type}'`);
  });

  it('在插入、更新读取条件和更新写入条件中都允许日程快捷操作', () => {
    expect(sql.match(/'agenda_action'/g)).toHaveLength(3);
  });

  it.each(['processing', 'claimed', 'success', 'fail'])(
    '允许机器人使用操作状态 %s',
    (status) => {
      expect(sql).toContain(`'${status}'`);
    },
  );

  it('在同一事务内同时更新插入和更新策略', () => {
    expect(sql.trim()).toMatch(/^BEGIN;/);
    expect(sql).toContain('ALTER POLICY robot_webhook_insert');
    expect(sql).toContain('ALTER POLICY robot_webhook_update');
    expect(sql.trim()).toMatch(/COMMIT;$/);
  });
});
