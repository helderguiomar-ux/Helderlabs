/**
 * Validações e normalizações de dados do CRM (B1)
 */

/**
 * Validação de NIF português pelo algoritmo módulo 11
 */
export function validatePortugueseNIF(nifRaw: string): boolean {
  if (!nifRaw) return false;
  let nif = String(nifRaw).trim().replace(/\s+/g, '');
  if (nif.toUpperCase().startsWith('PT')) {
    nif = nif.slice(2);
  }
  if (!/^\d{9}$/.test(nif)) return false;

  const validFirstDigits = ['1', '2', '3', '5', '6', '8', '9'];
  const firstDigit = nif[0];
  const firstTwo = nif.slice(0, 2);

  const isValidPrefix =
    validFirstDigits.includes(firstDigit) ||
    ['45', '70', '71', '72', '77', '78', '79'].includes(firstTwo);

  if (!isValidPrefix) return false;

  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(nif[i]) * (9 - i);
  }

  const remainder = sum % 11;
  const expectedCheckDigit = remainder < 2 ? 0 : 11 - remainder;

  return Number(nif[8]) === expectedCheckDigit;
}

/**
 * Normaliza número de telefone para formato E.164.
 * Números de 9 dígitos portugueses recebem prefixo +351 por omissão.
 */
export function normalizePhoneNumber(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  const clean = rawPhone.trim().replace(/[\s\-\.\(\)]/g, '');
  if (!clean) return null;

  // Se já tem prefixo internacional +...
  if (clean.startsWith('+')) {
    return clean;
  }

  // 00351...
  if (clean.startsWith('00')) {
    return `+${clean.slice(2)}`;
  }

  // Número nacional português de 9 dígitos (9xx, 2xx, 3xx)
  if (/^\d{9}$/.test(clean)) {
    return `+351${clean}`;
  }

  return clean;
}
