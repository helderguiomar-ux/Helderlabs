const { AuditService } = require('./src/modules/platform/services/AuditService');

async function test() {
  try {
    await AuditService.audit({
      action: 'auth.login',
      module: 'auth',
      category: 'SECURITY',
      resource: 'Authentication',
      resourceId: 'helderguiomar@gmail.com',
      actorEmail: 'helderguiomar@gmail.com',
      actorType: 'USER',
      result: 'FAILURE',
      newValue: { reason: 'INVALID_CREDENTIALS' },
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
      userAgent: 'test'
    });
    console.log('AuditService.audit SUCCEEDED locally!');
  } catch (e) {
    console.error('AuditService.audit FAILED locally:', e);
  }
}
test();
