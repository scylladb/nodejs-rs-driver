"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const resultsWrapper = require("../../lib/types/results-wrapper");

describe("Native page buffer", function () {
    it("expose-gc: should release page bytes after Buffers are collected", async function () {
        if (!global.gc) {
            this.skip();
        }

        const before = rust.testsPageBufferFinalizations();
        (function createBuffers() {
            for (let i = 0; i < 128; i++) {
                const page = rust.testsCreatePageBuffer(4096);
                assert.strictEqual(page[0], 0x5a);
            }
        })();

        for (
            let i = 0;
            i < 20 && rust.testsPageBufferFinalizations() < before + 128;
            i++
        ) {
            global.gc();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        assert.isAtLeast(rust.testsPageBufferFinalizations(), before + 128);
    });

    it("should keep bytes alive after converting them to Buffers", function () {
        const pages = Array.from({ length: 128 }, () =>
            rust.testsCreatePageBuffer(4096),
        );

        for (const page of pages) {
            assert.isTrue(Buffer.isBuffer(page));
            assert.strictEqual(page.length, 4096);
            assert.strictEqual(page[0], 0x5a);
            assert.strictEqual(page[4095], 0x5a);
        }
    });

    it("should return an empty Buffer for an empty page", function () {
        const page = rust.testsCreatePageBuffer(0);
        assert.isTrue(Buffer.isBuffer(page));
        assert.strictEqual(page.length, 0);
    });

    for (const copyBuffer of [false, true]) {
        it(`should select the right page path with copyBuffer=${copyBuffer}`, function () {
            const page = Buffer.from([1, 2, 3]);
            const result = {
                getRows() {
                    assert.isFalse(copyBuffer);
                    return [page, 1];
                },
                getRowsShared() {
                    assert.isTrue(copyBuffer);
                    return [page, 1];
                },
                getColumnsNames() {
                    return [];
                },
                getColumnsTypes() {
                    return [];
                },
            };
            const encoder = {
                encodingOptions: { copyBuffer },
                decodeRows(data) {
                    assert.strictEqual(data, page);
                    return [];
                },
            };

            assert.deepEqual(
                resultsWrapper.getRowsFromResultsWrapper(result, encoder),
                [],
            );
        });
    }
});
