import assert from 'node:assert';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const { convertMessage, convertTopic2id, pattern2RegEx, isEchoOfReceived } = require('../build/lib/common');

// Minimal adapter stub – convertMessage only uses `log` (for the invalid-JSON debug branch).
const adapter = {
    namespace: 'mqtt.0',
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

    describe('convertTopic2id dotToUnderscore', () => {
        it('keeps dots as hierarchy separators when disabled (default)', () => {
            // Wolf heating (ism7mqtt) sends "HK1.Vorlauftemperatur" → dot creates an extra level
            assert.strictEqual(
                convertTopic2id('wolf/HK1.Vorlauftemperatur', false, '', 'mqtt.0'),
                'wolf.HK1.Vorlauftemperatur',
            );
        });

        it('replaces dots in topic names with underscore when enabled', () => {
            assert.strictEqual(
                convertTopic2id('wolf/HK1.Vorlauftemperatur', false, '', 'mqtt.0', true),
                'wolf.HK1_Vorlauftemperatur',
            );
        });

        it('replaces every dot, also with multiple levels and dots', () => {
            assert.strictEqual(convertTopic2id('a/b.c/d.e.f', false, '', 'mqtt.0', true), 'a.b_c.d_e_f');
        });

        it('does not touch a topic without dots when enabled', () => {
            assert.strictEqual(convertTopic2id('a/b/c', false, '', 'mqtt.0', true), 'a.b.c');
        });

        it('still strips the own namespace when enabled', () => {
            assert.strictEqual(convertTopic2id('mqtt/0/a.b', false, '', 'mqtt.0', true), 'a_b');
        });
    });

    describe('pattern2RegEx dotToUnderscore', () => {
        it('an ignored-topic pattern with a dotted name matches the converted id', () => {
            const regex = new RegExp(pattern2RegEx('wolf/HK1.Vorlauftemperatur', adapter, '', true));
            const id = convertTopic2id('wolf/HK1.Vorlauftemperatur', false, '', 'mqtt.0', true);
            assert.strictEqual(regex.test(id), true);
        });

        it('a wildcard pattern still matches an underscore-converted id', () => {
            const regex = new RegExp(pattern2RegEx('wolf/#', adapter, '', true));
            const id = convertTopic2id('wolf/HK1.Vorlauftemperatur', false, '', 'mqtt.0', true);
            assert.strictEqual(regex.test(id), true);
        });
    });

    describe('isEchoOfReceived (loop protection #414)', () => {
        it('suppresses a matching value within the window', () => {
            assert.strictEqual(isEchoOfReceived({ val: '"on"', ts: 1000 }, '"on"', 1500, 2000), true);
        });

        it('does not suppress a different value within the window', () => {
            assert.strictEqual(isEchoOfReceived({ val: '"on"', ts: 1000 }, '"off"', 1500, 2000), false);
        });

        it('does not suppress once the window has passed', () => {
            assert.strictEqual(isEchoOfReceived({ val: '"on"', ts: 1000 }, '"on"', 3001, 2000), false);
        });

        it('suppresses exactly at the window boundary', () => {
            assert.strictEqual(isEchoOfReceived({ val: '42', ts: 1000 }, '42', 3000, 2000), true);
        });

        it('is disabled when the interval is 0', () => {
            assert.strictEqual(isEchoOfReceived({ val: '"on"', ts: 1000 }, '"on"', 1000, 0), false);
        });

        it('returns false when nothing was received yet', () => {
            assert.strictEqual(isEchoOfReceived(undefined, '"on"', 1000, 2000), false);
        });
    });
});
