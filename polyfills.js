(function () {
  'use strict';

  if (typeof Promise !== 'undefined' && typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }


  if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsertComputed !== 'function') {
    Map.prototype.getOrInsertComputed = function (key, callback) {
      if (this.has(key)) return this.get(key);
      var value = callback(key);
      this.set(key, value);
      return value;
    };
  }

  if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsert !== 'function') {
    Map.prototype.getOrInsert = function (key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    };
  }

  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function (obj, key) {
      return Object.prototype.hasOwnProperty.call(Object(obj), key);
    };
  }

  if (typeof URL !== 'undefined' && typeof URL.parse !== 'function') {
    URL.parse = function (url, base) {
      try { return base !== undefined ? new URL(url, base) : new URL(url); }
      catch (_) { return null; }
    };
  }

  if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.fromBase64 !== 'function') {
    Uint8Array.fromBase64 = function (value) {
      var binary = atob(String(value).replace(/\s+/g, ''));
      var out = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    };
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any !== 'function' && typeof AbortController !== 'undefined') {
    AbortSignal.any = function (signals) {
      var controller = new AbortController();
      var list = Array.prototype.slice.call(signals || []);
      function abortFrom(signal) {
        if (controller.signal.aborted) return;
        try { controller.abort(signal && 'reason' in signal ? signal.reason : undefined); }
        catch (_) { controller.abort(); }
      }
      for (var i = 0; i < list.length; i += 1) {
        var signal = list[i];
        if (!signal) continue;
        if (signal.aborted) { abortFrom(signal); break; }
        signal.addEventListener('abort', (function (s) { return function () { abortFrom(s); }; })(signal), { once: true });
      }
      return controller.signal;
    };
  }

  function streamIterator(stream, preventCancel) {
    var reader = stream.getReader();
    var finished = false;
    var iterator = {
      next: function () {
        if (finished) return Promise.resolve({ value: undefined, done: true });
        return reader.read().then(function (result) {
          if (result.done) {
            finished = true;
            try { reader.releaseLock(); } catch (_) {}
          }
          return result;
        });
      },
      return: function (value) {
        if (finished) return Promise.resolve({ value: value, done: true });
        finished = true;
        var action = preventCancel ? Promise.resolve() : Promise.resolve(reader.cancel(value)).catch(function () {});
        return action.then(function () {
          try { reader.releaseLock(); } catch (_) {}
          return { value: value, done: true };
        });
      },
      throw: function (reason) {
        finished = true;
        return Promise.resolve(reader.cancel(reason)).catch(function () {}).then(function () {
          try { reader.releaseLock(); } catch (_) {}
          return Promise.reject(reason);
        });
      }
    };
    if (typeof Symbol !== 'undefined' && Symbol.asyncIterator) {
      iterator[Symbol.asyncIterator] = function () { return this; };
    }
    return iterator;
  }

  if (typeof ReadableStream !== 'undefined' && typeof Symbol !== 'undefined' && Symbol.asyncIterator) {
    if (typeof ReadableStream.prototype.values !== 'function') {
      ReadableStream.prototype.values = function (options) {
        return streamIterator(this, !!(options && options.preventCancel));
      };
    }
    if (typeof ReadableStream.prototype[Symbol.asyncIterator] !== 'function') {
      ReadableStream.prototype[Symbol.asyncIterator] = function () {
        return this.values();
      };
    }
  }

  if (typeof structuredClone !== 'function') {
    window.structuredClone = function clone(value) {
      var seen = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
      function copy(input) {
        if (input === null || typeof input !== 'object') return input;
        if (seen && seen.has(input)) return seen.get(input);
        if (input instanceof Date) return new Date(input.getTime());
        if (input instanceof RegExp) return new RegExp(input.source, input.flags);
        if (input instanceof ArrayBuffer) return input.slice(0);
        if (ArrayBuffer.isView && ArrayBuffer.isView(input)) {
          if (input instanceof DataView) return new DataView(copy(input.buffer), input.byteOffset, input.byteLength);
          return new input.constructor(input);
        }
        if (typeof Map !== 'undefined' && input instanceof Map) {
          var map = new Map(); if (seen) seen.set(input, map);
          input.forEach(function (v, k) { map.set(copy(k), copy(v)); });
          return map;
        }
        if (typeof Set !== 'undefined' && input instanceof Set) {
          var set = new Set(); if (seen) seen.set(input, set);
          input.forEach(function (v) { set.add(copy(v)); });
          return set;
        }
        if (Array.isArray(input)) {
          var arr = []; if (seen) seen.set(input, arr);
          for (var i = 0; i < input.length; i += 1) arr[i] = copy(input[i]);
          return arr;
        }
        var proto = Object.getPrototypeOf(input);
        if (proto === Object.prototype || proto === null) {
          var obj = {}; if (seen) seen.set(input, obj);
          Object.keys(input).forEach(function (key) { obj[key] = copy(input[key]); });
          return obj;
        }
        return input;
      }
      return copy(value);
    };
  }
})();
