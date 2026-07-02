import assert from 'node:assert';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const { convertMessage } = require('../build/lib/common');

// Minimal adapter stub – convertMessage only uses `log` (for the invalid-JSON debug branch).
const adapter = {
    log: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as ioBroker.Adapter;

describe('Test convert version', function () {
    it('Number', () => {
        assert.deepStrictEqual(convertMessage('data', '233.57', adapter, false), {
            message: 233.57,
            isStateObject: false,
        });
    });

    describe('parseCharCodes', () => {
        it('converts valid comma-separated char codes when enabled', () => {
            assert.deepStrictEqual(convertMessage('data', '72,101,108,108,111', adapter, true), {
                message: 'Hello',
                isStateObject: false,
            });
        });

        it('leaves the message untouched when disabled (default)', () => {
            assert.deepStrictEqual(convertMessage('data', '72,101,108,108,111', adapter, false), {
                message: '72,101,108,108,111',
                isStateObject: false,
            });
        });

        it('does not convert large numbers (NUKI regression) even when enabled', () => {
            // "3,0,442236930,1,2" contains values > 255 → must stay a raw string, not become garbage
            assert.deepStrictEqual(convertMessage('data', '3,0,442236930,1,2', adapter, true), {
                message: '3,0,442236930,1,2',
                isStateObject: false,
            });
        });

        it('does not convert when a value is negative even when enabled', () => {
            assert.deepStrictEqual(convertMessage('data', '65,66,67,-1', adapter, true), {
                message: '65,66,67,-1',
                isStateObject: false,
            });
        });

        it('does not convert when a later part is not a number', () => {
            assert.deepStrictEqual(convertMessage('data', '65,66,67,abc', adapter, true), {
                message: '65,66,67,abc',
                isStateObject: false,
            });
        });

        it('accepts the whole 0-255 range when enabled', () => {
            const result = convertMessage('data', '0,128,255', adapter, true);
            assert.strictEqual(result.isStateObject, false);
            assert.strictEqual(result.message, String.fromCharCode(0, 128, 255));
        });
    });
});
