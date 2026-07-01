const assert = require('node:assert');
const convertMessage = require('../build/lib/common').convertMessage;

describe('Test convert version', function () {
    it('Number', async () => {
        assert.deepStrictEqual(convertMessage('data', '233.57'), { message: 233.57, isStateObject: false });
    });
});
