import test from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { createFakePrismaClient } from './support/fakePrismaClient';

test('Fase B6 - Cálculo dinâmico de status e dias até caducidade (computeDocumentStatus)', () => {
  // 1. Sem data de caducidade (permanente)
  const perm = EnterpriseCRMService.computeDocumentStatus(null);
  assert.equal(perm.status, 'VALID');
  assert.equal(perm.daysUntilExpiry, null);
  assert.equal(perm.isExpiringSoon, false);
  assert.equal(perm.isExpired, false);

  // 2. Caducado (10 dias atrás)
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 10);
  const expired = EnterpriseCRMService.computeDocumentStatus(pastDate);
  assert.equal(expired.status, 'EXPIRED');
  assert.ok(expired.daysUntilExpiry! < 0);
  assert.equal(expired.isExpired, true);
  assert.equal(expired.isExpiringSoon, false);

  // 3. A caducar em breve (15 dias no futuro)
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 15);
  const expiring = EnterpriseCRMService.computeDocumentStatus(soonDate);
  assert.equal(expiring.status, 'EXPIRING_SOON');
  assert.ok(expiring.daysUntilExpiry! <= 30 && expiring.daysUntilExpiry! > 0);
  assert.equal(expiring.isExpiringSoon, true);
  assert.equal(expiring.isExpired, false);

  // 4. Válido e folgado (60 dias no futuro)
  const farDate = new Date();
  farDate.setDate(farDate.getDate() + 60);
  const valid = EnterpriseCRMService.computeDocumentStatus(farDate);
  assert.equal(valid.status, 'VALID');
  assert.ok(valid.daysUntilExpiry! > 30);
  assert.equal(valid.isExpiringSoon, false);
  assert.equal(valid.isExpired, false);
});

test('Fase B6 - Adicionar documento empresarial com isolamento e atividade na cronologia', async () => {
  const db = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-1', db as any);

  // Criar empresa
  const company = await db.company.create({
    data: {
      tenantId: 'tenant-1',
      legalName: 'Tecnologia & Inovação, Lda',
      tradeName: 'TecnoLab',
      status: 'CUSTOMER',
      deletedAt: null
    }
  });

  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  // Adicionar Certidão Permanente
  const doc = await service.addCompanyDocument(company.id, {
    name: 'Certidão Permanente 2026',
    docType: 'CERTIDAO_PERMANENTE',
    accessCode: '1234-5678-9012',
    issueDate: new Date(),
    expiryDate,
    notes: 'Código de acesso oficial do Registo Comercial',
    uploadedBy: 'user-helder'
  });

  assert.ok(doc.id);
  assert.equal(doc.companyId, company.id);
  assert.equal(doc.name, 'Certidão Permanente 2026');
  assert.equal(doc.docType, 'CERTIDAO_PERMANENTE');
  assert.equal(doc.accessCode, '1234-5678-9012');
  assert.equal(doc.status, 'VALID');
  assert.equal(doc.verificationStatus, 'PENDING');
  assert.equal(doc.docTypeLabel, 'Certidão Permanente');

  // Verificar que foi registada atividade comercial no histórico
  const comms = db.__seed.communications.filter((c: any) => c.companyId === company.id);
  assert.ok(comms.length >= 1);
  assert.match(comms[0].subject, /Documento adicionado/);
});

test('Fase B6 - Listagem de documentos com KPIs de caducidade e conformidade', async () => {
  const db = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-1', db as any);

  const company = await db.company.create({
    data: { tenantId: 'tenant-1', tradeName: 'Alfa Serviços', status: 'CUSTOMER', deletedAt: null }
  });

  // 1. Doc Válido (90 dias)
  const d1 = new Date(); d1.setDate(d1.getDate() + 90);
  await service.addCompanyDocument(company.id, { name: 'Alvará IMPIC', docType: 'ALVARA_LICENCA', expiryDate: d1 });

  // 2. Doc A Caducar (10 dias)
  const d2 = new Date(); d2.setDate(d2.getDate() + 10);
  await service.addCompanyDocument(company.id, { name: 'Não Dívida AT', docType: 'NON_DEBT_AT', expiryDate: d2 });

  // 3. Doc Caducado (-5 dias)
  const d3 = new Date(); d3.setDate(d3.getDate() - 5);
  await service.addCompanyDocument(company.id, { name: 'Seguro RC Vencido', docType: 'SEGURO_RC', expiryDate: d3 });

  // 4. Doc Permanente (sem validade)
  await service.addCompanyDocument(company.id, { name: 'Cartão de NIF', docType: 'DECLARACAO_NIF' });

  const result = await service.listCompanyDocuments(company.id);
  assert.equal(result.documents.length, 4);

  // Validar KPIs
  assert.equal(result.kpis.totalCount, 4);
  assert.equal(result.kpis.validCount, 2); // Alvará + NIF permanente
  assert.equal(result.kpis.expiringSoonCount, 1); // Não Dívida AT
  assert.equal(result.kpis.expiredCount, 1); // Seguro RC
  assert.equal(result.kpis.pendingVerificationCount, 4);
});

test('Fase B6 - Auditoria e Verificação de Documento (Aprovação e Rejeição)', async () => {
  const db = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-1', db as any);

  const company = await db.company.create({
    data: { tenantId: 'tenant-1', tradeName: 'Beta Gestão', status: 'CUSTOMER', deletedAt: null }
  });

  const doc = await service.addCompanyDocument(company.id, {
    name: 'Comprovativo de IBAN',
    docType: 'COMPROVATIVO_IBAN'
  });

  assert.equal(doc.verificationStatus, 'PENDING');

  // Aprovar documento
  const approved = await service.verifyCompanyDocument(doc.id, {
    status: 'VERIFIED',
    notes: 'Documento carimbado pelo Banco Santander Totta.'
  }, 'user-compliance-officer');

  assert.equal(approved.verificationStatus, 'VERIFIED');
  assert.equal(approved.verifiedBy, 'user-compliance-officer');
  assert.ok(approved.verifiedAt);
  assert.match(approved.notes!, /Santander/);

  // Rejeitar documento com motivo
  const rejected = await service.verifyCompanyDocument(doc.id, {
    status: 'REJECTED',
    notes: 'Titular do IBAN não coincide com a firma social.'
  }, 'user-compliance-officer');

  assert.equal(rejected.verificationStatus, 'REJECTED');
  assert.match(rejected.notes!, /não coincide/);
});

test('Fase B6 - Atualização de documento e recálculo automático de validade', async () => {
  const db = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-1', db as any);

  const company = await db.company.create({
    data: { tenantId: 'tenant-1', tradeName: 'Gama Tech', status: 'CUSTOMER', deletedAt: null }
  });

  // Criar documento inicial caducado
  const pastDate = new Date(); pastDate.setDate(pastDate.getDate() - 20);
  const doc = await service.addCompanyDocument(company.id, {
    name: 'Certidão Não Dívida SS',
    docType: 'NON_DEBT_SS',
    expiryDate: pastDate
  });

  assert.equal(doc.status, 'EXPIRED');

  // Atualizar para nova data de validade renovada (90 dias no futuro)
  const newDate = new Date(); newDate.setDate(newDate.getDate() + 90);
  const updated = await service.updateCompanyDocument(doc.id, {
    expiryDate: newDate,
    notes: 'Certidão renovada e emitida pela Segurança Social Direta.'
  }, 'user-admin');

  assert.equal(updated.status, 'VALID');
  assert.ok(updated.daysUntilExpiry! > 30);
  assert.equal(updated.isExpired, false);
});

test('Fase B6 - Proteção estrita contra violação multi-tenant em documentos', async () => {
  const db = createFakePrismaClient();
  const serviceTenantA = new EnterpriseCRMService('tenant-A', db as any);
  const serviceTenantB = new EnterpriseCRMService('tenant-B', db as any);

  // Empresa e documento pertencem ao Tenant A
  const companyA = await db.company.create({
    data: { tenantId: 'tenant-A', tradeName: 'Empresa do Tenant A', status: 'CUSTOMER', deletedAt: null }
  });
  const docA = await serviceTenantA.addCompanyDocument(companyA.id, {
    name: 'Documento Confidencial A',
    docType: 'NDA_CONFIDENCIALIDADE'
  });

  // Tenant B tenta ler o documento do Tenant A
  await assert.rejects(
    async () => {
      await serviceTenantB.getCompanyDocumentById(docA.id);
    },
    /não encontrado/
  );

  // Tenant B tenta adicionar documento à empresa do Tenant A
  await assert.rejects(
    async () => {
      await serviceTenantB.addCompanyDocument(companyA.id, {
        name: 'Injeção Ilegítima B',
        docType: 'OTHER'
      });
    },
    /não encontrada/
  );

  // Tenant B tenta verificar o documento do Tenant A
  await assert.rejects(
    async () => {
      await serviceTenantB.verifyCompanyDocument(docA.id, { status: 'VERIFIED' });
    },
    /não encontrado/
  );

  // Tenant B tenta apagar o documento do Tenant A
  await assert.rejects(
    async () => {
      await serviceTenantB.deleteCompanyDocument(docA.id);
    },
    /não encontrado/
  );
});

test('Fase B6 - Remoção de documento via soft delete', async () => {
  const db = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-1', db as any);

  const company = await db.company.create({
    data: { tenantId: 'tenant-1', tradeName: 'Delta Indústria', status: 'CUSTOMER', deletedAt: null }
  });

  const doc = await service.addCompanyDocument(company.id, {
    name: 'Minuta Provisória',
    docType: 'OTHER'
  });

  const res = await service.deleteCompanyDocument(doc.id, 'user-remover');
  assert.equal(res.success, true);

  // Tentativa de ler o documento apagado deve falhar (404 / não encontrado)
  await assert.rejects(
    async () => {
      await service.getCompanyDocumentById(doc.id);
    },
    /não encontrado/
  );

  // Listagem padrão não deve conter o documento apagado
  const list = await service.listCompanyDocuments(company.id);
  assert.equal(list.documents.length, 0);
});

test('Fase B6 - Listagem global de documentos do tenant com filtros e pesquisa', async () => {
  const db = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-1', db as any);

  const comp1 = await db.company.create({
    data: { tenantId: 'tenant-1', tradeName: 'Empresa 1', taxNumber: '501234567', status: 'CUSTOMER', deletedAt: null }
  });
  const comp2 = await db.company.create({
    data: { tenantId: 'tenant-1', tradeName: 'Empresa 2', taxNumber: '509876543', status: 'CUSTOMER', deletedAt: null }
  });

  const dSoon = new Date(); dSoon.setDate(dSoon.getDate() + 5);
  const dFar = new Date(); dFar.setDate(dFar.getDate() + 100);

  await service.addCompanyDocument(comp1.id, { name: 'Alvará Licença', docType: 'ALVARA_LICENCA', expiryDate: dSoon });
  await service.addCompanyDocument(comp2.id, { name: 'Contrato Master', docType: 'CONTRATO_ASSINADO', expiryDate: dFar });

  // 1. Pesquisa por termo
  const searchRes = await service.listTenantDocuments({ search: 'Alvará' });
  assert.equal(searchRes.documents.length, 1);
  assert.equal(searchRes.documents[0].name, 'Alvará Licença');

  // 2. Filtro de apenas a expirar
  const expiringRes = await service.listTenantDocuments({ expiringOnly: true });
  assert.equal(expiringRes.documents.length, 1);
  assert.equal(expiringRes.documents[0].docType, 'ALVARA_LICENCA');

  // 3. Validação dos KPIs do Tenant
  assert.equal(expiringRes.kpis.totalDocuments, 2);
  assert.equal(expiringRes.kpis.validCount, 1);
  assert.equal(expiringRes.kpis.expiringSoonCount, 1);
  assert.equal(expiringRes.kpis.expiredCount, 0);
});
