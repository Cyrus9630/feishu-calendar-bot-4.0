import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  HealthCheckResponse,
  OperationLogsResponse,
  EnvCheckResponse,
  DashboardSummaryResponse,
} from '@shared/api.interface';

export async function getHealthCheck(): Promise<HealthCheckResponse> {
  const response = await axiosForBackend({
    url: '/api/health/check',
    method: 'GET',
  });
  return response.data;
}

export async function getOperationLogs(page: number, pageSize: number): Promise<OperationLogsResponse> {
  const response = await axiosForBackend({
    url: `/api/operation/logs?page=${page}&pageSize=${pageSize}`,
    method: 'GET',
  });
  return response.data;
}

export async function getEnvCheck(): Promise<EnvCheckResponse> {
  const response = await axiosForBackend({
    url: '/api/env/check',
    method: 'GET',
  });
  return response.data;
}

export async function getDashboardSummary(): Promise<DashboardSummaryResponse> {
  const response = await axiosForBackend({
    url: '/api/dashboard/summary',
    method: 'GET',
  });
  return response.data;
}

