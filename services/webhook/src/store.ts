import { Pool } from 'pg';

export interface WebhookRegistration {
  merchantAddress: string;
  url: string;
  registeredAt: number;
}

// In-memory store — replace with a database in production.
const store = new Map<string, WebhookRegistration>();

// Shared database connection pool for persistent storage (e.g. DLQ entries).
// Configured from DATABASE_URL. Lazily created so the service can still run
// in environments where no database is configured.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set; cannot create database pool');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

export function registerWebhook(merchantAddress: string, url: string): WebhookRegistration {
  const reg: WebhookRegistration = { merchantAddress, url, registeredAt: Date.now() };
  store.set(merchantAddress, reg);
  return reg;
}

export function getWebhook(merchantAddress: string): WebhookRegistration | undefined {
  return store.get(merchantAddress);
}

export function deleteWebhook(merchantAddress: string): boolean {
  return store.delete(merchantAddress);
}

export function allWebhooks(): WebhookRegistration[] {
  return Array.from(store.values());
}