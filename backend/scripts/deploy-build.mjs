import { execSync } from 'child_process';

console.log('[BUILD] Executando Prisma Generate...');
execSync('npx prisma generate', { stdio: 'inherit' });

console.log('[BUILD] Resolvendo migrações baseline no PostgreSQL...');
try { execSync('npx prisma migrate resolve --applied 20260823202500_initial_schema', { stdio: 'inherit' }); } catch (e) {}
try { execSync('npx prisma migrate resolve --applied 20260906214800_full_schema_update', { stdio: 'inherit' }); } catch (e) {}
try { execSync('npx prisma migrate resolve --applied 0000_baseline', { stdio: 'inherit' }); } catch (e) {}
try { execSync('npx prisma migrate resolve --rolled-back 20260907233000_add_finance_module', { stdio: 'inherit' }); } catch (e) {}

console.log('[BUILD] Executando Prisma Migrate Deploy...');
execSync('npx prisma migrate deploy', { stdio: 'inherit' });

console.log('[BUILD] Compilando TypeScript...');
execSync('npm run build', { stdio: 'inherit' });
console.log('[BUILD] Concluído com sucesso!');
