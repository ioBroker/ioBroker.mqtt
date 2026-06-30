const assert = require('node:assert');
const convertMessage = require('../build/lib/common').convertMessage;

describe('Test convert version', function () {
    it('Number', async () => {
        assert.strictEqual(convertMessage('data', '233.57'), 233.57);
    });
});
