/**
 * CanonicalJson — Serializador JSON Determinístico
 *
 * Garante que a mesma estrutura de dados, independentemente da ordem
 * das propriedades de objetos gerada pelo PostgreSQL (jsonb) ou pelo runtime JS,
 * produza sempre exatamente a mesma representação de string e o mesmo hash SHA-256.
 */

export class CanonicalJson {
  /**
   * Converte qualquer valor JS numa string JSON canónica determinística.
   */
  public static stringify(value: any): string {
    if (value === undefined) {
      return 'null';
    }

    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (value instanceof Date) {
      return JSON.stringify(value.toISOString());
    }

    if (Array.isArray(value)) {
      const items = value.map(item => this.stringify(item));
      return `[${items.join(',')}]`;
    }

    // Objeto genérico: ordenar chaves lexicograficamente
    const sortedKeys = Object.keys(value).sort();
    const entries: string[] = [];

    for (const key of sortedKeys) {
      const val = value[key];
      if (val !== undefined) {
        entries.push(`${JSON.stringify(key)}:${this.stringify(val)}`);
      }
    }

    return `{${entries.join(',')}}`;
  }
}
