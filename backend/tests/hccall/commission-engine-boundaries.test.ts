import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HccallCommissionEngine, DynamizationConfig } from '../../src/modules/hccall/services/HccallCommissionEngine';

describe('HCCALL 2.0 — Commission Engine Tier Modes & Boundary Tests', () => {
  const baseConfig: Omit<DynamizationConfig, 'tierMode'> = {
    id: 'dyn-test-1',
    name: 'Dinamização Comercial Multi-Setor',
    baseAmountPerSaleCents: 0,
    tiers: [
      { minQuantity: 1, maxQuantity: 10, unitAmountCents: 800 },   // 1–10 → 8 €
      { minQuantity: 11, maxQuantity: 20, unitAmountCents: 1000 }, // 11–20 → 10 €
      { minQuantity: 21, maxQuantity: 30, unitAmountCents: 1200 }, // 21–30 → 12 €
      { minQuantity: 31, maxQuantity: null, unitAmountCents: 1500 } // 31+ → 15 €
    ],
    bonuses: [
      { thresholdCount: 20, bonusAmountCents: 5000 },  // ≥20 → +50 €
      { thresholdCount: 30, bonusAmountCents: 10000 }, // ≥30 → +100 €
      { thresholdCount: 40, bonusAmountCents: 20000 }  // ≥40 → +200 €
    ]
  };

  describe('Mode 1: RETROACTIVE (Retroativo a todas as vendas ao atingir escalão)', () => {
    const config: DynamizationConfig = { ...baseConfig, tierMode: 'RETROACTIVE' };

    it('0 vendas → 0 €', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 0);
      assert.equal(res.totalCommissionCents, 0);
      assert.equal(res.tierCommissionCents, 0);
      assert.equal(res.bonusCommissionCents, 0);
    });

    it('9 vendas (abaixo do teto do 1º escalão) → 9 × 8 € = 72 € (7200 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 9);
      assert.equal(res.totalCommissionCents, 7200);
      assert.equal(res.tierReached?.unitAmountCents, 800);
      assert.equal(res.bonusCommissionCents, 0);
      assert.equal(res.nextTier?.neededSalesCount, 11);
      assert.equal(res.nextTier?.salesRemaining, 2);
    });

    it('10 vendas (fronteira exata do 1º escalão) → 10 × 8 € = 80 € (8000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 10);
      assert.equal(res.totalCommissionCents, 8000);
      assert.equal(res.tierReached?.unitAmountCents, 800);
      assert.equal(res.bonusCommissionCents, 0);
      assert.equal(res.nextTier?.neededSalesCount, 11);
      assert.equal(res.nextTier?.salesRemaining, 1);
    });

    it('11 vendas (início do 2º escalão - retroativo) → 11 × 10 € = 110 € (11000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 11);
      assert.equal(res.totalCommissionCents, 11000);
      assert.equal(res.tierReached?.unitAmountCents, 1000);
      assert.equal(res.bonusCommissionCents, 0);
      assert.equal(res.nextTier?.neededSalesCount, 21);
      assert.equal(res.nextTier?.salesRemaining, 10);
    });

    it('20 vendas (fim do 2º escalão + 1º bónus) → 20 × 10 € + 50 € bónus = 250 € (25000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 20);
      assert.equal(res.tierCommissionCents, 20000);
      assert.equal(res.bonusCommissionCents, 5000);
      assert.equal(res.totalCommissionCents, 25000);
      assert.equal(res.tierReached?.unitAmountCents, 1000);
    });

    it('21 vendas (início do 3º escalão) → 21 × 12 € + 50 € bónus = 302 € (30200 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 21);
      assert.equal(res.tierCommissionCents, 25200);
      assert.equal(res.bonusCommissionCents, 5000);
      assert.equal(res.totalCommissionCents, 30200);
      assert.equal(res.tierReached?.unitAmountCents, 1200);
    });

    it('30 vendas (fim do 3º escalão + 2º bónus) → 30 × 12 € + 100 € bónus = 460 € (46000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 30);
      assert.equal(res.tierCommissionCents, 36000);
      assert.equal(res.bonusCommissionCents, 10000);
      assert.equal(res.totalCommissionCents, 46000);
      assert.equal(res.tierReached?.unitAmountCents, 1200);
    });

    it('31 vendas (escalão máximo 31+) → 31 × 15 € + 100 € bónus = 565 € (56500 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 31);
      assert.equal(res.tierCommissionCents, 46500);
      assert.equal(res.bonusCommissionCents, 10000);
      assert.equal(res.totalCommissionCents, 56500);
      assert.equal(res.tierReached?.unitAmountCents, 1500);
      assert.equal(res.nextTier, null);
    });

    it('40 vendas (escalão 31+ e bónus máximo) → 40 × 15 € + 200 € bónus = 800 € (80000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 40);
      assert.equal(res.tierCommissionCents, 60000);
      assert.equal(res.bonusCommissionCents, 20000);
      assert.equal(res.totalCommissionCents, 80000);
    });
  });

  describe('Mode 2: MARGINAL (Progressivo por blocos de vendas)', () => {
    const config: DynamizationConfig = { ...baseConfig, tierMode: 'MARGINAL' };

    it('9 vendas → 9 × 8 € = 72 € (7200 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 9);
      assert.equal(res.totalCommissionCents, 7200);
    });

    it('10 vendas → 10 × 8 € = 80 € (8000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 10);
      assert.equal(res.totalCommissionCents, 8000);
    });

    it('11 vendas → (10 × 8 €) + (1 × 10 €) = 90 € (9000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 11);
      assert.equal(res.tierCommissionCents, 9000);
      assert.equal(res.totalCommissionCents, 9000);
    });

    it('20 vendas → (10 × 8 €) + (10 × 10 €) + 50 € bónus = 180 € + 50 € = 230 € (23000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 20);
      assert.equal(res.tierCommissionCents, 18000);
      assert.equal(res.bonusCommissionCents, 5000);
      assert.equal(res.totalCommissionCents, 23000);
    });

    it('21 vendas → (10 × 8 €) + (10 × 10 €) + (1 × 12 €) + 50 € bónus = 192 € + 50 € = 242 € (24200 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 21);
      assert.equal(res.tierCommissionCents, 19200);
      assert.equal(res.bonusCommissionCents, 5000);
      assert.equal(res.totalCommissionCents, 24200);
    });

    it('30 vendas → (10 × 8 €) + (10 × 10 €) + (10 × 12 €) + 100 € bónus = 300 € + 100 € = 400 € (40000 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 30);
      assert.equal(res.tierCommissionCents, 30000);
      assert.equal(res.bonusCommissionCents, 10000);
      assert.equal(res.totalCommissionCents, 40000);
    });

    it('31 vendas → (10 × 8 €) + (10 × 10 €) + (10 × 12 €) + (1 × 15 €) + 100 € bónus = 315 € + 100 € = 415 € (41500 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(config, 31);
      assert.equal(res.tierCommissionCents, 31500);
      assert.equal(res.bonusCommissionCents, 10000);
      assert.equal(res.totalCommissionCents, 41500);
    });
  });

  describe('Mode 3: FLAT (Valor fixo conforme escalão atingido)', () => {
    const flatConfig: DynamizationConfig = {
      ...baseConfig,
      tierMode: 'FLAT',
      baseAmountPerSaleCents: 500
    };

    it('15 vendas com 5 € base + escalão flat 10 € → 15 × 5 € + 15 × 10 € = 225 € (22500 cêntimos)', () => {
      const res = HccallCommissionEngine.calculateDynamization(flatConfig, 15);
      assert.equal(res.baseCommissionCents, 7500);
      assert.equal(res.tierCommissionCents, 15000);
      assert.equal(res.totalCommissionCents, 22500);
    });
  });

  describe('Explicabilidade & Idempotência', () => {
    it('Execução múltipla gera resultados exatamente idênticos (Idempotência)', () => {
      const config: DynamizationConfig = { ...baseConfig, tierMode: 'RETROACTIVE' };
      const res1 = HccallCommissionEngine.calculateDynamization(config, 25);
      const res2 = HccallCommissionEngine.calculateDynamization(config, 25);
      assert.deepEqual(res1, res2);
    });

    it('Gera explicação em linguagem natural legível pelo utilizador', () => {
      const config: DynamizationConfig = { ...baseConfig, tierMode: 'RETROACTIVE' };
      const res = HccallCommissionEngine.calculateDynamization(config, 23);
      assert.ok(res.explanation.includes('Vendas registadas: 23'));
      assert.ok(res.explanation.includes('Próximo escalão'));
      assert.ok(res.lines.length > 0);
    });
  });
});
