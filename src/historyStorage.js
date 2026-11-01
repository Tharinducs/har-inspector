const HISTORY_KEY = "harHistory";

const storageErrorMessage = (error) => error?.message || String(error);

const getSessionHistory = () => new Promise((resolve, reject) => {
  const storage = globalThis.chrome?.storage?.session;
  if (!storage) return reject(new Error("Chrome session storage is unavailable."));
  storage.get(HISTORY_KEY, (result) => {
    const storageError = globalThis.chrome?.runtime?.lastError;
    if (storageError) return reject(new Error(storageErrorMessage(storageError)));
    resolve(Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : []);
  });
});

const saveSessionHistory = (history) => new Promise((resolve, reject) => {
  const storage = globalThis.chrome?.storage?.session;
  if (!storage) return reject(new Error("Chrome session storage is unavailable."));
  storage.set({ [HISTORY_KEY]: history }, () => {
    const storageError = globalThis.chrome?.runtime?.lastError;
    if (storageError) return reject(new Error(storageErrorMessage(storageError)));
    resolve();
  });
});

const clearSessionHistory = () => new Promise((resolve, reject) => {
  const storage = globalThis.chrome?.storage?.session;
  if (!storage) return reject(new Error("Chrome session storage is unavailable."));
  storage.remove(HISTORY_KEY, () => {
    const storageError = globalThis.chrome?.runtime?.lastError;
    if (storageError) return reject(new Error(storageErrorMessage(storageError)));
    resolve();
  });
});

module.exports = { HISTORY_KEY, getSessionHistory, saveSessionHistory, clearSessionHistory };
