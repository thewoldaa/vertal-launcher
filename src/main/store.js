'use strict';
/** Tiny synchronous JSON file store. No external dependency needed. */
const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {() => string} fileFn - returns absolute path to the JSON file
   * @param {any} defaultValue - value used when the file doesn't exist yet
   */
  constructor(fileFn, defaultValue) {
    this.fileFn = fileFn;
    this.defaultValue = defaultValue;
    this._cache = null;
  }

  _file() {
    return this.fileFn();
  }

  read() {
    if (this._cache !== null) return this._cache;
    const file = this._file();
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      this._cache = JSON.parse(raw);
    } catch (e) {
      this._cache = JSON.parse(JSON.stringify(this.defaultValue));
    }
    return this._cache;
  }

  write(value) {
    this._cache = value;
    const file = this._file();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    return value;
  }

  update(mutatorFn) {
    const current = this.read();
    const next = mutatorFn(current) || current;
    return this.write(next);
  }
}

module.exports = { JsonStore };
