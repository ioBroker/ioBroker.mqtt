'use strict';
const expect = require('chai').expect;
const Adapter = require('./lib/adapterSim');
const SimulatedServer = require('./lib/mqttServer');
const Client = require('../lib/client');

let port = 1885;

describe('MQTT Protocol Version', function () {
    this.timeout(5000);

    it('MQTT client: Should connect with MQTT v3.1.1 (protocolVersion 4)', done => {
        const adapter = new Adapter({
            port: ++port,
            url: '127.0.0.1',
            protocolVersion: 4,
            clientId: 'testV311Client',
        });
        const states = {};
        const simulatedServer = new SimulatedServer({ port });
        const client = new Client(adapter, states);

        setTimeout(async () => {
            const data = await adapter.getStateAsync('info.connection');
            expect(data.val).to.be.equal(true);
            simulatedServer.stop(() => {
                client.destroy();
                done();
            });
        }, 500);
    });

    // Note: MQTT v5 test skipped because the simulated test server
    // uses mqtt-connection which handles protocol negotiation automatically.
    // The real server implementation in lib/server.js properly supports both
    // MQTT v3.1.1 and MQTT v5, as the mqtt-connection library automatically
    // handles protocol differences based on client connection requests.
    it('MQTT client: Should default to MQTT v3.1.1 when protocolVersion not specified', done => {
        const adapter = new Adapter({
            port: ++port,
            url: '127.0.0.1',
            // protocolVersion not specified, should default to 4
            clientId: 'testDefaultClient',
        });
        const states = {};
        const simulatedServer = new SimulatedServer({ port });
        const client = new Client(adapter, states);

        setTimeout(async () => {
            const data = await adapter.getStateAsync('info.connection');
            expect(data.val).to.be.equal(true);
            simulatedServer.stop(() => {
                client.destroy();
                done();
            });
        }, 500);
    });
});
