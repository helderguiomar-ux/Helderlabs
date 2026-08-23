import 'dotenv/config';
import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3333);

const app = buildApp();

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`HelderLabs ERP backend a correr na porta ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
