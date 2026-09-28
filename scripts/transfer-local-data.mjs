// Export/import merchant data without copying session tokens or replaying jobs.
// Run export locally; import the private bundle inside the Fly machine.
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const [mode, filename] = process.argv.slice(2);
if (!['export', 'import'].includes(mode) || !filename) throw new Error('Usage: node scripts/transfer-local-data.mjs export|import private-file.json');
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL || `file:${path.resolve('prisma/dev.sqlite').replaceAll('\\', '/')}` });
const models = ['shopSettings', 'brandStudioProfile', 'lifecycleTemplateChoice', 'templateCustomization', 'campaign', 'productImageCutout', 'sendingDomain', 'emailSuppression'];
try {
  if (mode === 'export') {
    const bundle = await db.$transaction(async tx => {
      const data = {};
      for (const model of models) data[model] = await tx[model].findMany();
      return { version: 1, exportedAt: new Date().toISOString(), data };
    });
    fs.writeFileSync(filename, JSON.stringify(bundle), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(Object.fromEntries(models.map(m => [m, bundle.data[m].length]))));
  } else {
    const bundle = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (bundle.version !== 1 || models.some(m => !Array.isArray(bundle.data[m]))) throw new Error('Invalid data bundle');
    const backup = `/data/pre-transfer-${Date.now()}.sqlite`;
    await db.$executeRawUnsafe(`VACUUM INTO '${backup}'`);
    await db.$transaction(async tx => {
      for (const model of models) for (const source of bundle.data[model]) {
        const row = { ...source };
        for (const key of Object.keys(row)) {
          if (row[key] && (key.endsWith('At') || key.endsWith('EndsAt') || key.endsWith('StartsAt'))) row[key] = new Date(row[key]);
        }
        const where = row.id ? { id: row.id } : { shop: row.shop };
        if (model === 'shopSettings') {
          const live = await tx.shopSettings.findUnique({ where });
          row.sendingEnabled = false;
          row.appEmbedVerifiedAt = live?.appEmbedVerifiedAt ?? row.appEmbedVerifiedAt;
        }
        await tx[model].upsert({ where, create: row, update: row });
      }
    }, { timeout: 60_000 });
    console.log(JSON.stringify({ backup, imported: Object.fromEntries(models.map(m => [m, bundle.data[m].length])) }));
  }
} finally { await db.$disconnect(); }
