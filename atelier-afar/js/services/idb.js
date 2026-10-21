// Petite surcouche promesse autour d'IndexedDB.
// Les fichiers audio sont stockés en ArrayBuffer (plus fiable que Blob sur les anciens Safari).

const DB_NAME = 'atelier-afar';
const DB_VERSION = 1;
export const STORES = { takes: 'takes', audio: 'audio' };

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB n\'est pas disponible dans ce navigateur (navigation privée ?).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.takes)) db.createObjectStore(STORES.takes, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.audio)) db.createObjectStore(STORES.audio);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base locale est bloquée par un autre onglet. Fermez les autres onglets de l\'application.'));
  });
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée (espace de stockage insuffisant ?).'));
  });
}

export const getAll = (store) => tx([store], 'readonly', (t) => wrap(t.objectStore(store).getAll()));
export const get = (store, key) => tx([store], 'readonly', (t) => wrap(t.objectStore(store).get(key)));
export const put = (store, value, key) => tx([store], 'readwrite', (t) => wrap(t.objectStore(store).put(value, key)));
export const del = (store, key) => tx([store], 'readwrite', (t) => wrap(t.objectStore(store).delete(key)));
export const clear = (store) => tx([store], 'readwrite', (t) => wrap(t.objectStore(store).clear()));

/** Écrit la prise et son audio dans une seule transaction. */
export const putTakeWithAudio = (take, buffer) =>
  tx([STORES.takes, STORES.audio], 'readwrite', (t) => {
    t.objectStore(STORES.takes).put(take);
    t.objectStore(STORES.audio).put(buffer, take.id);
  });

export const putMany = (store, values) =>
  tx([store], 'readwrite', (t) => { const s = t.objectStore(store); values.forEach((v) => s.put(v)); });

export const deleteTakesWithAudio = (ids) =>
  tx([STORES.takes, STORES.audio], 'readwrite', (t) => {
    ids.forEach((id) => { t.objectStore(STORES.takes).delete(id); t.objectStore(STORES.audio).delete(id); });
  });
