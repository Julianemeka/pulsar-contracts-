import { Pool } from 'pg';
import { createAnalyticsRouter } from './api';

jest.mock('pg', () => {
  const mPool = jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    end: jest.fn(),
  }));
  return { Pool: mPool };
});

const MockedPool = Pool as unknown as jest.Mock;

describe('createAnalyticsRouter pool configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('applies pool config from ANALYTICS_DB_* environment variables', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/analytics';
    process.env.ANALYTICS_DB_POOL_MAX = '25';
    process.env.ANALYTICS_DB_IDLE_TIMEOUT_MS = '15000';
    process.env.ANALYTICS_DB_CONNECTION_TIMEOUT_MS = '7500';

    createAnalyticsRouter();

    expect(MockedPool).toHaveBeenCalledTimes(1);
    expect(MockedPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://user:pass@localhost:5432/analytics',
        max: 25,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 7500,
      }),
    );
  });

  it('applies default pool config when ANALYTICS_DB_* variables are unset', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/analytics';
    delete process.env.ANALYTICS_DB_POOL_MAX;
    delete process.env.ANALYTICS_DB_IDLE_TIMEOUT_MS;
    delete process.env.ANALYTICS_DB_CONNECTION_TIMEOUT_MS;

    createAnalyticsRouter();

    expect(MockedPool).toHaveBeenCalledTimes(1);
    expect(MockedPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://user:pass@localhost:5432/analytics',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }),
    );
  });
});