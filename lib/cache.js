// @ts-nocheck
const _rust = require("../index");

class PreparedCache {
  /**
   * @type {Map<string, list<Object | string>>}
   */
  #cache;

  constructor() {
    this.#cache = {};
  }

  /**
   *
   * @param {string} key
   * @returns {list<Object | string>}
   */
  getElement(key) {
    return this.#cache[key];
  }

  /**
   *
   * @param {string} key
   * @param {list<Object | string>} element
   */
  storeElement(key, element) {
    this.#cache[key] = element;
  }
}

module.exports.PreparedCache = PreparedCache;
