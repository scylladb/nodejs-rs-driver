"use strict";

import type { PreparedInfo } from "./new-utils";

/**
 * Caches the metadata of prepared statements, keyed by the query text.
 */
class PreparedCache {
    #cache: { [query: string]: PreparedInfo };

    constructor() {
        this.#cache = {};
    }

    /**
     * Returns the cached metadata for the query, or `undefined` when the query
     * has not been prepared yet.
     */
    getElement(key: string): PreparedInfo | undefined {
        return this.#cache[key];
    }

    storeElement(key: string, element: PreparedInfo): void {
        this.#cache[key] = element;
    }
}

export { PreparedCache };
