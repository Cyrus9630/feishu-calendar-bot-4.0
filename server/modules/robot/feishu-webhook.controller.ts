import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FeishuService } from './feishu.service';
import { RobotService } from './robot.service';

@Controller('api')
export class FeishuWebhookController {
  private readonly logger = new Logger(FeishuWebhookController.name);

  constructor(
    private readonly feishuService: FeishuService,
    private readonly robotService: RobotService,
  ) {}

  @Post('feishu/event')
  async feishuEvent(
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ) {
    if (body.challenge) {
      res.status(HttpStatus.OK).json({ challenge: body.challenge as string });
      return;
    }

    let decryptedBody: Record<string, unknown> | null;
    try {
      decryptedBody = this.getDecryptedBody(body);
    } catch {
      res
        .status(HttpStatus.FORBIDDEN)
        .json({ code: -1, msg: '事件解密失败' });
      return;
    }
    if (decryptedBody?.challenge) {
      res
        .status(HttpStatus.OK)
        .json({ challenge: decryptedBody.challenge as string });
      return;
    }

    const eventBody = decryptedBody ?? body;
    if (
      !this.feishuService.isEventAuthorized(
        req.headers,
        req.rawBody,
        eventBody,
      )
    ) {
      res
        .status(HttpStatus.FORBIDDEN)
        .json({ code: -1, msg: '事件来源校验失败' });
      return;
    }

    try {
      const header = eventBody.header as Record<string, unknown> | undefined;
      if (header?.event_type === 'card.action.trigger') {
        res.status(HttpStatus.OK).json({
          toast: { type: 'info', content: '正在处理，请稍候' },
        });
        void this.robotService.handleFeishuCardAction(eventBody).catch((error) => {
          this.logger.error(
            `异步处理卡片回调失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        return;
      }
      const result = await this.robotService.handleFeishuEvent(eventBody);
      res.status(HttpStatus.OK).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`处理飞书回调失败: ${message}`);
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ code: -1, msg: '事件处理失败' });
    }
  }

  private getDecryptedBody(
    body: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const encrypt = body.encrypt as string | undefined;
    if (!encrypt) return null;
    return this.feishuService.decryptEventBody(encrypt);
  }
}
