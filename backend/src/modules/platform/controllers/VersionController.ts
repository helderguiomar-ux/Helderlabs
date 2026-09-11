import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import fs from 'fs';
import path from 'path';

function getCommitSha(): string {
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;

  try {
    const gitHeadPath = path.resolve(process.cwd(), '../.git/HEAD');
    if (fs.existsSync(gitHeadPath)) {
      const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
      if (headContent.startsWith('ref: ')) {
        const refPath = path.resolve(process.cwd(), '../.git', headContent.substring(5).trim());
        if (fs.existsSync(refPath)) {
          return fs.readFileSync(refPath, 'utf8').trim();
        }
      } else {
        return headContent;
      }
    }
  } catch (err) {
    // Ignore git read error fallback
  }

  return 'local-dev';
}

export class VersionController {
  static async getVersion(request: FastifyRequest, reply: FastifyReply) {
    let latestMigration = 'unknown';

    try {
      const migrations: any = await prisma.$queryRaw`
        SELECT migration_name, finished_at 
        FROM _prisma_migrations 
        WHERE finished_at IS NOT NULL 
        ORDER BY finished_at DESC 
        LIMIT 1
      `;
      if (Array.isArray(migrations) && migrations.length > 0) {
        latestMigration = migrations[0].migration_name;
      }
    } catch (err) {
      latestMigration = 'in-memory/unavailable';
    }

    const commitSha = getCommitSha();
    const buildTime = process.env.BUILD_TIME || process.env.VERCEL_BUILD_TIME || new Date().toISOString();
    const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'development';
    const schemaVersion = '1.0.0';

    return reply.status(200).send({
      commitSha,
      buildTime,
      environment,
      schemaVersion,
      latestMigration
    });
  }
}
