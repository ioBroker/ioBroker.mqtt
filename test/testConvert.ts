import assert from 'node:assert';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const { convertMessage } = require('../build/lib/common');

describe('Test convert version', function () {
    it('Number', () => {
        assert.deepStrictEqual(convertMessage('data', '233.57'), { message: 233.57, isStateObject: false });
    });
});
