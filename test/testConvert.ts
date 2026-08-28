import assert from 'node:assert';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const {
    convertMessage,
    convertTopic2id,
    convertID2topic,
    pattern2RegEx,
    isEchoOfReceived,
    findIdForTopic,
    parseSharedTopic,
} = require('../build/lib/common');

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

    describe('findIdForTopic (IDs with characters that are not allowed in a topic)', () => {
        // The Shelly adapter creates IDs like "shelly.0.SHCB-1#3494546B9BEC#1"
        const shellyId = 'shelly.0.SHCB-1#3494546B9BEC#1.lights.Switch';
        const states = {
            [shellyId]: { val: true } as ioBroker.State,
            'shelly.0.SHCB-1_3494546B9BEC_2.lights.Switch': { val: true } as ioBroker.State,
            'hm-rpc.0.ABC.STATE': { val: true } as ioBroker.State,
        };

        it('resolves a topic back to the ID it was created from', () => {
            const topic = convertID2topic(shellyId, null, 'ferienhaus/', 'mqtt.0', '');
            assert.strictEqual(topic, 'ferienhaus/shelly/0/SHCB-1_3494546B9BEC_1/lights/Switch');
            assert.strictEqual(findIdForTopic(topic, states, 'ferienhaus/', 'mqtt.0', ''), shellyId);
        });

        it('works without a prefix', () => {
            assert.strictEqual(
                findIdForTopic('shelly/0/SHCB-1_3494546B9BEC_1/lights/Switch', states, '', 'mqtt.0', ''),
                shellyId,
            );
        });

        it('resolves an ID containing a space', () => {
            const id = 'javascript.0.My Script.value';
            const topic = convertID2topic(id, null, '', 'mqtt.0', '');
            assert.strictEqual(topic, 'javascript/0/My Script/value');
            assert.strictEqual(findIdForTopic(topic, { [id]: { val: 1 } as ioBroker.State }, '', 'mqtt.0', ''), id);
        });

        it('respects removePrefix', () => {
            const id = 'shelly.0.SHCB-1#3494546B9BEC#1.lights.Switch';
            const topic = convertID2topic(id, null, '', 'mqtt.0', 'shelly.0.');
            assert.strictEqual(topic, 'SHCB-1_3494546B9BEC_1/lights/Switch');
            assert.strictEqual(findIdForTopic(topic, states, '', 'mqtt.0', 'shelly.0.'), id);
        });

        it('does not resolve an ID that survives the conversion', () => {
            // "hm-rpc.0.ABC.STATE" can be restored by convertTopic2id, so it must not be reported
            assert.strictEqual(findIdForTopic('hm-rpc/0/ABC/STATE', states, '', 'mqtt.0', ''), undefined);
        });

        it('returns undefined for an unknown topic', () => {
            assert.strictEqual(findIdForTopic('shelly/0/unknown/lights/Switch', states, '', 'mqtt.0', ''), undefined);
            assert.strictEqual(findIdForTopic('', states, '', 'mqtt.0', ''), undefined);
        });

        it('returns undefined if no state is published', () => {
            assert.strictEqual(findIdForTopic('shelly/0/SHCB-1_3494546B9BEC_1', {}, '', 'mqtt.0', ''), undefined);
        });
    });

    describe('parseSharedTopic (MQTT 5 shared subscriptions)', () => {
        it('splits a shared subscription into share name and filter', () => {
            assert.deepStrictEqual(parseSharedTopic('$share/group/a/b'), { shareName: 'group', filter: 'a/b' });
        });

        it('keeps wildcards in the filter', () => {
            assert.deepStrictEqual(parseSharedTopic('$share/g/sensors/#'), { shareName: 'g', filter: 'sensors/#' });
        });

        it('leaves a normal topic untouched', () => {
            assert.deepStrictEqual(parseSharedTopic('a/b'), { filter: 'a/b' });
            assert.deepStrictEqual(parseSharedTopic('shares/a/b'), { filter: 'shares/a/b' });
        });

        it('is not a shared subscription without a filter', () => {
            assert.deepStrictEqual(parseSharedTopic('$share/group'), { filter: '$share/group' });
            assert.deepStrictEqual(parseSharedTopic('$share/group/'), { filter: '$share/group/' });
        });

        it('rejects an empty share name or one with a wildcard', () => {
            assert.deepStrictEqual(parseSharedTopic('$share//a/b'), { filter: '$share//a/b' });
            assert.deepStrictEqual(parseSharedTopic('$share/gr+up/a'), { filter: '$share/gr+up/a' });
            assert.deepStrictEqual(parseSharedTopic('$share/gr#up/a'), { filter: '$share/gr#up/a' });
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
