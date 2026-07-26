import { Module } from '@nestjs/common';
import { RobotController } from './robot.controller';
import { FeishuWebhookController } from './feishu-webhook.controller';
import { RobotService } from './robot.service';
import { RobotAutomationService } from './robot.automation';
import { FeishuModule } from './feishu.module';
import { OperationStoreService } from './operation-store.service';
import { CalendarCommandService } from './calendar-command.service';
import { ReminderService } from './reminder.service';
import { CalendarActionService } from './calendar-action.service';
import { CalendarQueryService } from './calendar-query.service';
import { AgendaActionService } from './agenda-action.service';
import { HealthAlertService } from './health-alert.service';

// 刘梦阳律师
@Module({
  imports: [FeishuModule],
  controllers: [
    RobotController,
    FeishuWebhookController,
  ],
  providers: [
    RobotService,
    RobotAutomationService,
    OperationStoreService,
    CalendarCommandService,
    CalendarActionService,
    CalendarQueryService,
    AgendaActionService,
    HealthAlertService,
    ReminderService,
  ],
})
export class RobotModule {}
