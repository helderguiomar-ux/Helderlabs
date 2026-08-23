#!/usr/bin/env node
// Descobre recursivamente todos os *.test.ts dentro de tests/ e corre-os
// com `tsx --test`.
//
// Porque não `tsx --test tests/**/*.test.ts` diretamente no package.json
// (como estava antes)? Porque esse glob só expande recursivamente sob bash
// com `shopt -s globstar` ligado — o `sh` que o `npm run` usa por omissão
// (e o cmd.exe/PowerShell no Windows) trata "**" como um "*" normal, só
// entra UM nível de subpasta, e não avisa nada — os testes que ficam de
// fora são simplesmente ignorados em silêncio. Foi assim que
// tests/auth/oauth/*.test.ts (dois níveis: auth/ depois oauth/) deixou de
// correr sem nenhum erro aparecer. Este script evita depender do
// comportamento de glob de um shell em concreto — funciona igual em
// qualquer SO.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const testsDir = path.join(process.cwd(), 'tests');

function collectTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = collectTestFiles(testsDir).sort();

if (files.length === 0) {
  console.error('Nenhum ficheiro *.test.ts encontrado em tests/.');
  process.exit(1);
}

console.log(`A correr ${files.length} ficheiro(s) de teste:`);
files.forEach((f) => console.log(`  - ${path.relative(process.cwd(), f)}`));
console.log('');

const result = spawnSync('npx', ['tsx', '--test', ...files], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status ?? 1);
