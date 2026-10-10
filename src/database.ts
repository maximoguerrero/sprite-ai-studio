import type { StudioProject } from "./types";

type SqlDatabase = {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
};

type DatabaseBridge = { kind: "tauri"; database: SqlDatabase } | { kind: "browser" };
let connectionPromise: Promise<DatabaseBridge> | undefined;

export function desktopAvailable() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function initializeDatabase(): Promise<DatabaseBridge> {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      if (!desktopAvailable()) return { kind: "browser" as const };
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      const database = await Database.load("sqlite:sprite-studio.db");
       await database.execute("PRAGMA foreign_keys = ON");
       await database.execute("CREATE TABLE IF NOT EXISTS workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
       const rows = await database.select<Array<{ value: string }>>("SELECT value FROM workspace_meta WHERE key='schema_version'");
       let version = Number(rows[0]?.value ?? 0);
       const migrations: Array<() => Promise<void>> = [
         async () => {
           await database.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, folder_path TEXT NOT NULL, archived_at TEXT, updated_at TEXT NOT NULL)");
           await database.execute("CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('animation','asset')), folder_path TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, slug))");
         },
         async () => {
           await database.execute("CREATE INDEX IF NOT EXISTS cards_project_id_idx ON cards(project_id)");
         },
       ];
       while (version < migrations.length) {
         await database.execute("BEGIN TRANSACTION");
         try {
           await migrations[version]();
           version += 1;
           await database.execute("INSERT INTO workspace_meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(version)]);
           await database.execute("COMMIT");
         } catch (error) {
           await database.execute("ROLLBACK");
           throw error;
         }
       }
       if (version > migrations.length) throw new Error(`Database schema version ${version} is newer than this app supports.`);
       return { kind: "tauri" as const, database };
    })();
  }
  return connectionPromise;
}

export async function syncProjectIndex(projects: StudioProject[]) {
  const bridge = await initializeDatabase();
  if (bridge.kind !== "tauri") return;
  await bridge.database.execute("PRAGMA foreign_keys = OFF");
  try {
    await bridge.database.execute("BEGIN TRANSACTION");
    await bridge.database.execute("DELETE FROM cards");
    await bridge.database.execute("DELETE FROM projects");
    for (const project of projects) {
      await bridge.database.execute(
        "INSERT INTO projects(id,name,slug,folder_path,archived_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, slug=excluded.slug, folder_path=excluded.folder_path, archived_at=excluded.archived_at, updated_at=excluded.updated_at",
        [project.id, project.name, project.slug, project.folderPath, project.archivedAt ?? null, new Date().toISOString()],
      );
      for (const card of project.cards) {
        await bridge.database.execute(
          "INSERT INTO cards(id,project_id,name,slug,kind,folder_path,updated_at) VALUES(?,?,?,?,?,?,?)",
          [card.id, project.id, card.name, card.slug, card.kind, card.folderPath, new Date().toISOString()],
        );
      }
    }
    await bridge.database.execute("COMMIT");
  } catch (error) {
    await bridge.database.execute("ROLLBACK");
    throw error;
  } finally {
    await bridge.database.execute("PRAGMA foreign_keys = ON");
  }
}

export async function listIndexedProjects() {
  const bridge = await initializeDatabase();
  if (bridge.kind !== "tauri") return [];
  return bridge.database.select<Array<{ id: string; name: string; slug: string; folder_path: string; archived_at: string | null }>>(
    "SELECT id, name, slug, folder_path, archived_at FROM projects ORDER BY updated_at DESC",
  );
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
