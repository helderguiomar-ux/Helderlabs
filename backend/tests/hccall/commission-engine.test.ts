import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HccallCommissionEngine,
  DynamizationConfig
} from '../../src/modules/hccall/services/HccallCommissionEngine';

describe('HCCALL 2.0 — Pure Commission Engine Unit Tests', () => {
  const sampleConfig: DynamizationConfig = {
    id: 'dyn-fibra',
    name: 'Dinamização Fibra Premium',
    tierMode: 'RETROACTIVE',
    baseAmountPerSaleCents: 0,
    tiers: [
      { minQuantity: 1, maxQuantity: 10, unitAmountCents: 800 },   // 1-10 -> 8€
      { minQuantity: 11, maxQuantity: 20, unitAmountCents: 1000 }, // 11-20 -> 10€
      { minQuantity: 21, maxQuantity: 30, unitAmountCents: 1200 }, // 21-30 -> 12€
      { minQuantity: 31, maxQuantity: null, unitAmountCents: 1500 } // 31+ -> 15€
    ],
    bonuses: [
      { thresholdCount: 20, bonusAmountCents: 5000 },  // >=20 -> +50€
      { thresholdCount: 30, bonusAmountCents: 10000 }, // >=30 -> +100€
      { thresholdCount: 40, bonusAmountCents: 20000 }  // >=40 -> +200€
    ]
  };

  // -------------------------------------------------------------------------
  // 1. MODO RETROATIVO & TESTE EXATO DE FRONTEIRAS
  // -------------------------------------------------------------------------
  describe('Modo RETROACTIVE & Testes de Fronteira (9, 10, 11, 20, 21, 30, 31)', () => {
    it('Fronteira 9 vendas: Escalão 1-10 (8€/venda) -> 72€ sem bónus', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 9);
      assert.equal(res.tierCommissionCents, 7200); // 9 * 8€ = 72€
      assert.equal(res.bonusCommissionCents, 0);
      assert.equal(res.totalCommissionCents, 7200);
      assert.equal(res.nextTier?.neededSalesCount, 11);
      assert.equal(res.nextTier?.salesRemaining, 2);
      // Próximo patamar: 11 * 10€ = 110€ vs 72€ atual -> ganho potencial de 38€
      assert.equal(res.nextTier?.potentialGainCents, 3800);
    });

    it('Fronteira 10 vendas (limite superior do 1º escalão): 10 * 8€ = 80€', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 10);
      assert.equal(res.tierCommissionCents, 8000);
      assert.equal(res.bonusCommissionCents, 0);
      assert.equal(res.totalCommissionCents, 8000);
      assert.equal(res.nextTier?.neededSalesCount, 11);
      assert.equal(res.nextTier?.salesRemaining, 1);
    });

    it('Fronteira 11 vendas (entrada no 2º escalão): 11 * 10€ = 110€ (retroativo)', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 11);
      assert.equal(res.tierCommissionCents, 11000); // 11 * 10€ = 110€
      assert.equal(res.bonusCommissionCents, 0);
      assert.equal(res.totalCommissionCents, 11000);
      assert.equal(res.nextTier?.neededSalesCount, 21);
      assert.equal(res.nextTier?.salesRemaining, 10);
    });

    it('Fronteira 20 vendas: 20 * 10€ = 200€ + 50€ bónus (>=20) = 250€', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 20);
      assert.equal(res.tierCommissionCents, 20000);
      assert.equal(res.bonusCommissionCents, 5000); // 50€
      assert.equal(res.totalCommissionCents, 25000); // 250€
      assert.equal(res.nextTier?.neededSalesCount, 21);
      assert.equal(res.nextTier?.salesRemaining, 1);
    });

    it('Fronteira 21 vendas: 21 * 12€ = 252€ + 50€ bónus = 302€ (retroativo)', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 21);
      assert.equal(res.tierCommissionCents, 25200); // 21 * 12€ = 252€
      assert.equal(res.bonusCommissionCents, 5000);
      assert.equal(res.totalCommissionCents, 30200);
    });

    it('Fronteira 30 vendas: 30 * 12€ = 360€ + 100€ bónus (>=30) = 460€', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 30);
      assert.equal(res.tierCommissionCents, 36000);
      assert.equal(res.bonusCommissionCents, 10000); // 100€
      assert.equal(res.totalCommissionCents, 46000); // 460€
      assert.equal(res.nextTier?.neededSalesCount, 31);
      assert.equal(res.nextTier?.salesRemaining, 1);
    });

    it('Fronteira 31 vendas: 31 * 15€ = 465€ + 100€ bónus = 565€', () => {
      const res = HccallCommissionEngine.calculateDynamization(sampleConfig, 31);
      assert.equal(res.tierCommissionCents, 46500); // 31 * 15€ = 465€
      assert.equal(res.bonusCommissionCents, 10000);
      assert.equal(res.totalCommissionCents, 56500);
      assert.equal(res.nextTier, null); // Escalão máximo atingido
    });
  });

  // -------------------------------------------------------------------------
  // 2. MODO MARGINAL / PROGRESSIVO
  // -------------------------------------------------------------------------
  describe('Modo MARGINAL / Progressivo por Blocos', () => {
    const marginalConfig: DynamizationConfig = {
      ...sampleConfig,
      tierMode: 'MARGINAL'
    };

    it('30 vendas em modo marginal: (10×8€) + (10×10€) + (10×12€) = 300€ + 100€ bónus = 400€', () => {
      const res = HccallCommissionEngine.calculateDynamization(marginalConfig, 30);
      // Bloco 1-10: 10 * 8 = 80€
      // Bloco 11-20: 10 * 10 = 100€
      // Bloco 21-30: 10 * 12 = 120€
      // Total escalão: 80 + 100 + 120 = 300€
      assert.equal(res.tierCommissionCents, 30000);
      assert.equal(res.bonusCommissionCents, 10000); // >=30 dá 100€
      assert.equal(res.totalCommissionCents, 40000);
    });

    it('15 vendas em modo marginal: (10×8€) + (5×10€) = 130€', () => {
      const res = HccallCommissionEngine.calculateDynamization(marginalConfig, 15);
      // 10 * 8 = 80€, 5 * 10 = 50€ -> 130€
      assert.equal(res.tierCommissionCents, 13000);
      assert.equal(res.totalCommissionCents, 13000);
    });
  });

  // -------------------------------------------------------------------------
  // 3. MODO FLAT (VALOR FIXO / TAXA ÚNICA)
  // -------------------------------------------------------------------------
  describe('Modo FLAT', () => {
    const flatConfig: DynamizationConfig = {
      id: 'dyn-flat',
      name: 'Dinamização Flat 10€',
      tierMode: 'FLAT',
      baseAmountPerSaleCents: 500, // 5€ base
      tiers: [
        { minQuantity: 1, maxQuantity: null, unitAmountCents: 1000 } // 10€ fixo
      ],
      bonuses: []
    };

    it('24 vendas em modo FLAT: 24 * 5€ base + 24 * 10€ fixo = 360€', () => {
      const res = HccallCommissionEngine.calculateDynamization(flatConfig, 24);
      assert.equal(res.baseCommissionCents, 12000); // 24 * 5€ = 120€
      assert.equal(res.tierCommissionCents, 24000); // 24 * 10€ = 240€
      assert.equal(res.totalCommissionCents, 36000);
    });
  });

  // -------------------------------------------------------------------------
  // 4. IDEMPOTÊNCIA & REPRODUTIBILIDADE PURA
  // -------------------------------------------------------------------------
  describe('Idempotência & Imutabilidade', () => {
    it('Executar 1000 vezes consecutivas sobre os mesmos inputs produz exatamente o mesmo resultado sem efeitos colaterais', () => {
      const res1 = HccallCommissionEngine.calculateDynamization(sampleConfig, 23);
      for (let i = 0; i < 100; i++) {
        const res2 = HccallCommissionEngine.calculateDynamization(sampleConfig, 23);
        assert.deepEqual(res1, res2);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. SIMULADOR "E SE..."
  // -------------------------------------------------------------------------
  describe('Simulador "E Se..."', () => {
    it('Simular +10 vendas a partir de 20 vendas desbloqueia novo escalão e bónus', () => {
      const mockSales = Array.from({ length: 20 }, (_, i) => ({
        soldAt: '2026-09-01',
        dynamizationId: 'dyn-fibra',
        items: [{ productId: 'prod-fibra', quantity: 1, unitPriceCents: 3500 }]
      }));

      const sim = HccallCommissionEngine.simulateAdditionalSales(mockSales, sampleConfig, 10);
      assert.equal(sim.current.totalSalesCount, 20);
      assert.equal(sim.current.totalCommissionCents, 25000); // 200€ + 50€ = 250€

      assert.equal(sim.projected.totalSalesCount, 30);
      assert.equal(sim.projected.totalCommissionCents, 46000); // 360€ + 100€ = 460€

      assert.equal(sim.additionalGainCents, 21000); // 460€ - 250€ = 210€
      assert.equal(sim.tierUpgraded, true);
      assert.equal(sim.bonusUnlocked, true);
    });
  });
});
