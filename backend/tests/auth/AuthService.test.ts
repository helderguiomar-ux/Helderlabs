import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../../src/modules/auth/services/AuthService';

describe('AuthService Integration', () => {
  test('AuthService pode ser instanciado', () => {
    const service = new AuthService();
    assert.ok(service);
  });
});
