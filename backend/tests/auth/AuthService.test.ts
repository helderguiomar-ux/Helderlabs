import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../../src/modules/auth/services/AuthService';

describe('AuthService Integration', () => {
  test('AuthService pode ser instanciado', () => {
    const service = new AuthService();
    assert.ok(service);
  });

  test('Super Admin (helderguiomar@gmail.com) consegue fazer login com password por omissão admin1234', async () => {
    const service = new AuthService();
    const result = await service.loginWithPassword('helderguiomar@gmail.com', 'admin1234');
    assert.ok(result.token);
    assert.equal(result.user.email, 'helderguiomar@gmail.com');
    assert.equal(result.user.role, 'SUPER_ADMIN');
  });

  test('Permite alterar a password e fazer login com a nova password guardada', async () => {
    const service = new AuthService();
    const initialLogin = await service.loginWithPassword('helderguiomar@gmail.com', 'admin1234');
    
    // Alterar password para nova1234
    await service.setPassword(initialLogin.user.id, 'nova1234');

    // Login com nova password deve ter sucesso
    const newLogin = await service.loginWithPassword('helderguiomar@gmail.com', 'nova1234');
    assert.ok(newLogin.token);

    // Restaurar a password por omissão admin1234 para manter ambiente de testes consistente
    await service.setPassword(initialLogin.user.id, 'admin1234');
  });
});
