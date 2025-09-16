const expect = require('chai').expect;
const convertMessage = require('../lib/common').convertMessage;

describe('Test convert version', function () {
    it('Number', async () => {
        expect(convertMessage('data', '233.57')).to.be.equal(233.57);
    });

    it('Character code conversion - valid ASCII codes', async () => {
        expect(convertMessage('data', '65,66,67')).to.be.equal('ABC');
        expect(convertMessage('data', '72,101,108,108,111')).to.be.equal('Hello');
        expect(convertMessage('data', '32,87,111,114,108,100')).to.be.equal(' World');
    });

    it('Character code conversion - invalid codes should remain unchanged', async () => {
        // NUKI 3.0 Pro lock data - should NOT be converted
        expect(convertMessage('data', '3,0,442236930,1,2')).to.be.equal('3,0,442236930,1,2');
        
        // Values above 255 should NOT be converted
        expect(convertMessage('data', '256,512,1024')).to.be.equal('256,512,1024');
        expect(convertMessage('data', '70000,80000,90000')).to.be.equal('70000,80000,90000');
        
        // Negative numbers should NOT be converted
        expect(convertMessage('data', '-1,2,3')).to.be.equal('-1,2,3');
        
        // Mix of valid and invalid should NOT be converted
        expect(convertMessage('data', '0,65535,1114112')).to.be.equal('0,65535,1114112');
    });

    it('Character code conversion - edge cases', async () => {
        // Control characters (0-31) are valid
        expect(convertMessage('data', '9,10,13')).to.be.equal('\t\n\r');
        
        // Extended ASCII (128-255) is valid
        expect(convertMessage('data', '128,129,130')).to.be.equal('\x80\x81\x82');
        
        // Single number doesn't match pattern (requires at least 3 numbers) but may be converted to number
        expect(convertMessage('data', '65')).to.be.equal(65); // String '65' becomes number 65
        expect(convertMessage('data', '65,66')).to.be.equal(65.66); // Two numbers: '65,66' -> '65.66' -> 65.66
    });

    it('Character code conversion - non-numeric data unchanged', async () => {
        expect(convertMessage('data', 'hello,world')).to.be.equal('hello,world');
        expect(convertMessage('data', 'a,b,c')).to.be.equal('a,b,c');
        expect(convertMessage('data', '1,2,abc')).to.be.equal('1,2,abc');
        expect(convertMessage('data', '3.14,2.71,1.41')).to.be.equal('3.14,2.71,1.41');
    });
});
