// @ts-nocheck
"use strict";

const vm = require("vm");
const utils = require("../utils");
const types = require("../types");

/**
 * @ignore
 */
class ResultMapper {
    /**
     * Gets a generated function to adapt the row to a document.
     * @param {ModelMappingInfo} info
     * @param {ResultSet} rs
     * @returns {Function}
     */
    static getSelectAdapter(info, rs) {
        const columns = rs.columns;
        if (!columns) {
            throw new Error("Expected ROWS result obtained VOID");
        }

        let scriptText =
            "(function rowAdapter(row, info) {\n" +
            "  const item = info.newInstance();\n";

        for (const c of columns) {
            scriptText += `  item['${info.getPropertyName(c.name)}'] = `;

            if (!info.getToModelFn(c.name)) {
                scriptText += `row['${c.name}'];\n`;
            } else {
                scriptText += `info.getToModelFn('${c.name}')(row['${c.name}']);\n`;
            }
        }

        scriptText += "  return item;\n})";

        const script = new vm.Script(scriptText, {
            filename: "gen-result-mapper.js",
        });
        return script.runInThisContext();
    }

    /**
     * Gets a function used to adapt VOID results or conditional updates.
     * @param {ResultSet} rs
     * @returns {Function}
     */
    static getMutationAdapter(rs) {
        if (rs.columns === null) {
            // VOID result
            return utils.noop;
        }

        if (
            rs.columns.length === 1 &&
            rs.columns[0].name === "[applied]" &&
            rs.columns[0].type.code === types.dataTypes.boolean
        ) {
            return utils.noop;
        }

        return ResultMapper.#getConditionalRowAdapter(rs);
    }

    static #getConditionalRowAdapter(rs) {
        return function conditionalRowAdapter(row, info) {
            const item = info.newInstance();

            // Skip the first column ("[applied]")
            for (let i = 1; i < rs.columns.length; i++) {
                const c = rs.columns[i];
                item[info.getPropertyName(c.name)] = row[c.name];
            }

            return item;
        };
    }

    /**
     * @param {ModelMappingInfo} info
     * @param {ResultSet} rs
     * @returns {{canCache: Boolean, fn: Function}}
     */
    static getCustomQueryAdapter(info, rs) {
        if (rs.columns === null || rs.columns.length === 0) {
            // VOID result
            return { canCache: true, fn: utils.noop };
        }

        if (
            rs.columns[0].name === "[applied]" &&
            rs.columns[0].type.code === types.dataTypes.boolean
        ) {
            // Conditional update results adapter functions should not be cached
            return {
                canCache: false,
                fn: ResultMapper.#getConditionalRowAdapter(rs),
            };
        }

        return { canCache: true, fn: ResultMapper.getSelectAdapter(info, rs) };
    }
}

module.exports = ResultMapper;
