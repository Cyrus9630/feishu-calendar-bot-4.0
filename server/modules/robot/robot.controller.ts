import { Controller, Get, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { RobotService } from './robot.service';

@Controller('api')
@NeedLogin()
export class RobotController {
  constructor(private readonly robotService: RobotService) {}

  @Get('health/check')
  async healthCheck() {
    return this.robotService.checkHealth();
  }

  @Get('operation/logs')
  async operationLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    return this.robotService.getOperationLogs(pageNum, pageSizeNum);
  }

  @Get('env/check')
  async envCheck() {
    return this.robotService.checkEnv();
  }

  @Get('dashboard/summary')
  async dashboardSummary() {
    return this.robotService.getDashboardSummary();
  }

}
