export interface HealthResult {
  status: 'ok' | 'error';
  database: 'connected' | 'error';
  timestamp: string;
}
