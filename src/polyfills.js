// Polyfill used by the PDF viewer in browsers without native support.
function installGetOrInsertComputed(ctor) {
  if (typeof ctor === 'undefined' || typeof ctor.prototype.getOrInsertComputed === 'function') return
  ctor.prototype.getOrInsertComputed = function (key, callbackFn) {
    if (!this.has(key)) {
      this.set(key, callbackFn(key))
    }
    return this.get(key)
  }
}

installGetOrInsertComputed(Map)
installGetOrInsertComputed(WeakMap)
