/*
 * Tiny IndexedDB key/value wrapper so a post-in-progress (including the card
 * images) survives a page refresh. Everything stays in this browser.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'wtb-wts-grid';
  var STORE = 'kv';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(req && req.result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  global.Store = {
    get: function (key) {
      return run('readonly', function (s) { return s.get(key); });
    },
    set: function (key, value) {
      return run('readwrite', function (s) { return s.put(value, key); });
    },
    del: function (key) {
      return run('readwrite', function (s) { return s.delete(key); });
    },
    clear: function () {
      return run('readwrite', function (s) { return s.clear(); });
    }
  };
})(window);
