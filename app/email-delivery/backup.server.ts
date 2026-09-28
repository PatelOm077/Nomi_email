import { mkdir, readdir, unlink } from "node:fs/promises";
import db from "../db.server";

// SQLite VACUUM INTO produces a consistent snapshot while the app is running.
// Fly volume snapshots provide the separate storage recovery copy.
export async function backupProductionDatabase() {
  if (process.env.DATABASE_URL !== "file:/data/nomi.sqlite") return;
  const directory = "/data/backups";
  await mkdir(directory, { recursive: true });
  const name = `nomi-${new Date().toISOString().slice(0, 10)}.sqlite`;
  const files = await readdir(directory);
  if (!files.includes(name)) {
    try {
      await db.$executeRawUnsafe(`VACUUM INTO '${directory}/${name}'`);
    } catch (error) {
      // Another worker may have won the daily backup race.
      if (!(await readdir(directory)).includes(name)) throw error;
    }
  }
  const older = (await readdir(directory)).filter(file => /^nomi-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)).sort().slice(0, -7);
  for (const file of older) await unlink(`${directory}/${file}`);
}
