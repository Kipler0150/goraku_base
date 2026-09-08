import { loadLocalEnvironment } from './environment.js';
import { createApp } from './app.js';

loadLocalEnvironment();

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const app = createApp();

app.listen(port, '0.0.0.0', () => {
  console.log(`Goraku Base API listening on http://localhost:${port}`);
});
