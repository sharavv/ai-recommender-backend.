import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDb() {
  const db = await open({
    filename: "./data.db",
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      query TEXT,
      picked_title TEXT,
      picked_id TEXT,
      picked_medium TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      history_id INTEGER,
      feedback TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}
