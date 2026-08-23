# Usa a imagem oficial e leve do Node.js 20 (ou 24, baseado no teu ambiente)
FROM node:20-alpine AS builder

# Define a diretoria de trabalho
WORKDIR /app

# Copia package.json e package-lock.json primeiro para otimizar o cache
COPY package*.json ./

# Instala todas as dependências, incluindo as de desenvolvimento para fazer o build
RUN npm install

# Copia o schema Prisma
COPY prisma ./prisma/

# Gera o Prisma Client
RUN npx prisma generate

# Copia o resto do código fonte
COPY . .

# Faz o build do TypeScript
RUN npm run build

# Stage 2: Imagem final de Produção
FROM node:20-alpine

WORKDIR /app

# Instala openssl (necessário para o Prisma no Alpine)
RUN apk add --no-cache openssl

# Copia ficheiros importantes do builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Expõe a porta que será usada
EXPOSE 3333

# Start app
CMD ["npm", "start"]
