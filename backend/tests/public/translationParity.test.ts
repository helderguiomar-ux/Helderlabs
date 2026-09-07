import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function flattenKeys(obj: Record<string, any>, prefix = ''): string[] {
  let keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const keyName = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      keys.push(...flattenKeys(obj[k], keyName));
    } else {
      keys.push(keyName);
    }
  }
  return keys;
}

function getNestedValue(obj: Record<string, any>, keyPath: string): any {
  return keyPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

describe('Traduções & Localização Integral (Paridade PT/EN)', () => {
  const ptPath = path.join(process.cwd(), 'public/locales/pt.json');
  const enPath = path.join(process.cwd(), 'public/locales/en.json');

  test('Ficheiros pt.json e en.json existem e têm JSON válido', () => {
    assert.ok(fs.existsSync(ptPath), 'pt.json deve existir');
    assert.ok(fs.existsSync(enPath), 'en.json deve existir');

    const ptData = JSON.parse(fs.readFileSync(ptPath, 'utf8'));
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));

    assert.ok(typeof ptData === 'object' && ptData !== null);
    assert.ok(typeof enData === 'object' && enData !== null);
  });

  test('Paridade 1:1 rigorosa de chaves entre pt.json e en.json', () => {
    const ptData = JSON.parse(fs.readFileSync(ptPath, 'utf8'));
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));

    const ptKeys = flattenKeys(ptData).sort();
    const enKeys = flattenKeys(enData).sort();

    const missingInEn = ptKeys.filter(k => getNestedValue(enData, k) === undefined);
    const missingInPt = enKeys.filter(k => getNestedValue(ptData, k) === undefined);

    assert.deepEqual(missingInEn, [], `Chaves em pt.json que faltam em en.json: ${missingInEn.join(', ')}`);
    assert.deepEqual(missingInPt, [], `Chaves em en.json que faltam em pt.json: ${missingInPt.join(', ')}`);
    assert.equal(ptKeys.length, enKeys.length, 'Total de chaves em pt.json e en.json deve ser idêntico');
  });

  test('Todas as chaves data-i18n em index.html existem em pt.json e en.json', () => {
    const indexPath = path.join(process.cwd(), 'public/index.html');
    if (!fs.existsSync(indexPath)) return;

    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const matches = indexHtml.match(/data-i18n=["']([^"']+)["']/g) || [];
    const usedKeys = matches.map(m => m.replace(/data-i18n=["']([^"']+)["']/, '$1'));

    const ptData = JSON.parse(fs.readFileSync(ptPath, 'utf8'));
    const missingKeys = usedKeys.filter(k => getNestedValue(ptData, k) === undefined);

    assert.deepEqual(missingKeys, [], `Chaves data-i18n usadas em index.html sem tradução em pt.json: ${missingKeys.join(', ')}`);
  });
});
