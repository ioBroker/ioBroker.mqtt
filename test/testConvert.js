const expect = require('chai').expect;
const convertMessage = require('../lib/common').convertMessage;

describe('Test convert version', function () {
    it('Number', async () => {
        expect(convertMessage('data', '233.57')).to.be.equal(233.57);
    });

    it('Malformed JSON with leading zeros should be returned as string', async () => {
        // Create a mock adapter with log methods to capture log calls
        const logCalls = [];
        const mockAdapter = {
            log: {
                error: (msg) => logCalls.push({ level: 'error', msg }),
                warn: (msg) => logCalls.push({ level: 'warn', msg }),
                debug: (msg) => logCalls.push({ level: 'debug', msg })
            }
        };

        const malformedJson = '{"wind_speed":02,"wind_force":00,"humidity":640011}';
        const result = convertMessage('weatherstation', malformedJson, mockAdapter, 'mqttid');
        
        // Should return the original string since JSON parsing failed
        expect(result).to.be.equal(malformedJson);
        
        // Should not log anything since this is expected behavior
        expect(logCalls.length).to.be.equal(0);
    });

    it('Malformed JSON without clientID should be returned as string', async () => {
        // Create a mock adapter with log methods to capture log calls
        const logCalls = [];
        const mockAdapter = {
            log: {
                error: (msg) => logCalls.push({ level: 'error', msg }),
                warn: (msg) => logCalls.push({ level: 'warn', msg }),
                debug: (msg) => logCalls.push({ level: 'debug', msg })
            }
        };

        const malformedJson = '{"wind_speed":02,"wind_force":00}';
        const result = convertMessage('test', malformedJson, mockAdapter); // No clientID
        
        // Should return the original string since JSON parsing failed
        expect(result).to.be.equal(malformedJson);
        
        // Should not log anything since this is expected behavior
        expect(logCalls.length).to.be.equal(0);
    });

    it('Valid JSON should be parsed correctly', async () => {
        const logCalls = [];
        const mockAdapter = {
            log: {
                error: (msg) => logCalls.push({ level: 'error', msg }),
                warn: (msg) => logCalls.push({ level: 'warn', msg }),
                debug: (msg) => logCalls.push({ level: 'debug', msg })
            }
        };

        const validJson = '{"val": 123, "ack": true}';
        const result = convertMessage('test', validJson, mockAdapter);
        
        // Should return parsed object
        expect(result).to.be.an('object');
        expect(result.val).to.be.equal(123);
        expect(result.ack).to.be.equal(true);
        
        // Should not have logged any errors
        expect(logCalls.length).to.be.equal(0);
    });
});
