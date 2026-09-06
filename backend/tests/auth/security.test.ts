import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/modules/auth/services/AuthService';

describe('Phase 0 Security Checks', () => {
  test('POST /api/auth/demo-login responde 404 Not Found', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo-login'
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  test('verifyOtp com master code 123456 e NODE_ENV=production responde 401', async () => {
    const oldEnv = process.env.NODE_ENV;
    const oldAllow = process.env.ALLOW_DEV_OTP;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_DEV_OTP = 'false';

      const authService = new AuthService();
      await assert.rejects(
        async () => {
          await authService.verifyOtp('test_security_user@example.com', '123456');
        },
        (err: any) => {
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = oldEnv;
      process.env.ALLOW_DEV_OTP = oldAllow;
    }
  });

  test('6.º pedido consecutivo a /api/auth/login responde 429 (Rate Limit)', async () => {
    const app = buildApp();
    let lastStatusCode = 200;

    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: `ratelimit_test_${i}@example.com`,
          password: 'wrong_password'
        }
      });
      lastStatusCode = res.statusCode;
    }

    assert.equal(lastStatusCode, 429);
    await app.close();
  });
});
