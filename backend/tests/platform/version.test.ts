import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';

describe('Bloco 0.3 — Fonte de Verdade & Deploy Determinístico (/api/version)', () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('1. GET /api/version deve retornar status 200 com campos obrigatórios', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/version'
    });

    assert.equal(response.statusCode, 200, 'Status code deve ser 200');
    const body = JSON.parse(response.payload);

    assert.ok(typeof body.commitSha === 'string' && body.commitSha.length > 0, 'commitSha deve ser string não-vazia');
    assert.ok(typeof body.buildTime === 'string' && body.buildTime.length > 0, 'buildTime deve ser string não-vazia');
    assert.ok(typeof body.environment === 'string' && body.environment.length > 0, 'environment deve ser string não-vazia');
    assert.ok(typeof body.schemaVersion === 'string' && body.schemaVersion.length > 0, 'schemaVersion deve ser string não-vazia');
    assert.ok(typeof body.latestMigration === 'string' && body.latestMigration.length > 0, 'latestMigration deve ser string não-vazia');
  });

  it('2. GET /api/version deve respeitar variáveis de ambiente de build e commit', async () => {
    const originalCommit = process.env.GIT_COMMIT_SHA;
    const originalBuildTime = process.env.BUILD_TIME;
    const originalEnv = process.env.ENVIRONMENT;

    process.env.GIT_COMMIT_SHA = 'deadbeef1234567890abcdef1234567890abcdef';
    process.env.BUILD_TIME = '2026-09-11T12:00:00.000Z';
    process.env.ENVIRONMENT = 'production-test';

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/version'
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.payload);

      assert.equal(body.commitSha, 'deadbeef1234567890abcdef1234567890abcdef');
      assert.equal(body.buildTime, '2026-09-11T12:00:00.000Z');
      assert.equal(body.environment, 'production-test');
    } finally {
      process.env.GIT_COMMIT_SHA = originalCommit;
      process.env.BUILD_TIME = originalBuildTime;
      process.env.ENVIRONMENT = originalEnv;
    }
  });
});
