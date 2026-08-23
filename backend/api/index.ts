import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildApp } from '../src/app';

const app = buildApp();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await app.ready();
  app.server.emit('request', req, res);
}
