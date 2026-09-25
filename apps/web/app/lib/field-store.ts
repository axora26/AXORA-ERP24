"use client";

import type { QueuedOperation } from "./field-queue";

/**
 * Persistance locale de la file terrain (IndexedDB) : survit a une coupure
 * reseau, a la fermeture de l'onglet et au redemarrage du navigateur.
 */
const DB_NAME = "axora-field";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("operations")) db.createObjectStore("operations", { keyPath: "clientId" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: "operations" | "blobs", mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const fieldStore = {
  list: () => run<QueuedOperation[]>("operations", "readonly", (store) => store.getAll() as IDBRequest<QueuedOperation[]>),
  put: (operation: QueuedOperation) => run("operations", "readwrite", (store) => store.put(operation)),
  remove: (clientId: string) => run("operations", "readwrite", (store) => store.delete(clientId)),
  putBlob: (key: string, blob: Blob) => run("blobs", "readwrite", (store) => store.put(blob, key)),
  getBlob: (key: string) => run<Blob | undefined>("blobs", "readonly", (store) => store.get(key) as IDBRequest<Blob | undefined>),
  removeBlob: (key: string) => run("blobs", "readwrite", (store) => store.delete(key)),
};
