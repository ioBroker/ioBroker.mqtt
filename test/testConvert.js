const expect  = require('chai').expect;
const convertMessage  = require('../lib/common').convertMessage;

describe('Test convert version', function () {
    it('Number', async () => {
        expect(convertMessage('data', '233.57')).to.be.equal(233.57);
    });
});