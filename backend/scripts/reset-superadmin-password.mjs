import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar variáveis de ambiente (priorizando .env.production.local se existir)
config({ path: join(__dirname, '../../.env.production.local') });
config({ path: join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const newPassword = process.argv[2];
  const email = process.argv[3] || 'helderguiomar@gmail.com';

  if (!newPassword) {
    console.error('Uso: node reset-superadmin-password.mjs <nova_password> [email]');
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error('A palavra-passe deve ter pelo menos 6 caracteres.');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      role: 'SUPER_ADMIN'
    }
  });

  if (!user) {
    console.error(`Super Admin com email '${email}' não encontrado.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash }
  });

  console.log(`[SUCESSO] Palavra-passe do Super Admin (${user.email}) redefinida com sucesso na base de dados!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
