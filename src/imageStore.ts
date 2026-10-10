const DATABASE_NAME = "sprite-studio-images";
const STORE_NAME = "images";
const WORKSPACE_STORE = "workspace";
const DATABASE_VERSION = 2;

export type WorkspaceData = {
  schemaVersion: 1;
  projects: unknown[];
  skills: unknown[];
  activeProjectId: string | null;
  providers?: { profiles: unknown[]; activeProfileId: string | null };
  generationJobs?: unknown[];
};

let workspaceWriteQueue = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(WORKSPACE_STORE)) {
        request.result.createObjectStore(WORKSPACE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local image storage."));
  });
}

export async function loadWorkspace(): Promise<WorkspaceData | undefined> {
  const database = await openDatabase();
  const workspace = await new Promise<WorkspaceData | undefined>((resolve, reject) => {
    const request = database.transaction(WORKSPACE_STORE, "readonly").objectStore(WORKSPACE_STORE).get("current");
    request.onsuccess = () => resolve(request.result as WorkspaceData | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load workspace metadata."));
  });
  database.close();
  if (!workspace) return undefined;
  if (workspace.schemaVersion === 1) return workspace;
  throw new Error(`Unsupported workspace schema version: ${String((workspace as { schemaVersion?: unknown }).schemaVersion)}`);
}

export function saveWorkspace(workspace: WorkspaceData): Promise<void> {
  workspaceWriteQueue = workspaceWriteQueue.catch(() => undefined).then(() => persistWorkspace(workspace));
  return workspaceWriteQueue;
}

export async function loadGenerationJobs(): Promise<unknown[]> {
  const workspace = await loadWorkspace();
  return workspace?.generationJobs ?? [];
}

export async function loadWorkspaceAndJobs(): Promise<{ workspace?: WorkspaceData; jobs: unknown[] }> {
  const database = await openDatabase();
  const result = await new Promise<{ workspace?: WorkspaceData; jobs: unknown[] }>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, "readonly");
    const store = transaction.objectStore(WORKSPACE_STORE);
    const workspaceRequest = store.get("current");
    const jobsRequest = store.get("generation-jobs");
    let workspace: WorkspaceData | undefined;
    let jobs: unknown[] = [];
    let remaining = 2;
    const done = () => { remaining -= 1; if (!remaining) resolve({ workspace, jobs }); };
    workspaceRequest.onsuccess = () => { workspace = workspaceRequest.result as WorkspaceData | undefined; done(); };
    jobsRequest.onsuccess = () => { jobs = Array.isArray(jobsRequest.result) ? jobsRequest.result : []; done(); };
    workspaceRequest.onerror = jobsRequest.onerror = () => reject(transaction.error ?? new Error("Could not load workspace data."));
  });
  database.close();
  return result;
}

export function saveGenerationJobs(jobs: unknown[]): Promise<void> {
  workspaceWriteQueue = workspaceWriteQueue.catch(() => undefined).then(async () => {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      transaction.objectStore(WORKSPACE_STORE).put(jobs, "generation-jobs");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save generation queue."));
    });
    database.close();
  });
  return workspaceWriteQueue;
}

async function persistWorkspace(workspace: WorkspaceData): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
    transaction.objectStore(WORKSPACE_STORE).put(workspace, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save workspace metadata."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace save was aborted."));
  });
  database.close();
}

export async function saveImage(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save image."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Image save was aborted."));
  });
  database.close();
}

export async function deleteImages(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const key of new Set(keys)) store.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete stored card images."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Card image deletion was aborted."));
  });
  database.close();
}

export async function loadImage(key: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load image."));
  });
  database.close();
  return blob;
}

export async function loadImages(keys: string[]): Promise<Record<string, Blob>> {
  const database = await openDatabase();
  const images = await new Promise<Record<string, Blob>>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const result: Record<string, Blob> = {};
    let pending = keys.length;
    if (!pending) resolve(result);
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result instanceof Blob) result[key] = request.result;
        pending -= 1;
        if (!pending) resolve(result);
      };
      request.onerror = () => reject(request.error ?? new Error(`Could not read stored image ${key}.`));
    }
  });
  database.close();
  return images;
}

export async function listStoredImageKeys(): Promise<string[]> {
  const database = await openDatabase();
  const keys = await new Promise<string[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error ?? new Error("Could not list local images."));
  });
  database.close();
  return keys;
}

export async function clearWorkspaceData(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, WORKSPACE_STORE], "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(WORKSPACE_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear local workspace."));
  });
  database.close();
}
