'use strict';
const expect = require('chai').expect;
const Adapter = require('./lib/adapterSim');
const SimulatedServer = require('./lib/mqttServer');
const ClientEmitter = require('./lib/mqttClient');
const Client = require('../lib/client');

let port = 1883;

describe('MQTT client', function () {
    let adapter;
    let simulatedServer;
    let client;
    const states = {};
    this.timeout(3000);

    before('MQTT client: Start MQTT simulatedServer', done => {
        adapter = new Adapter({
            port: ++port,
            url: '127.0.0.1',
            onchange: true,
            clientId: 'testAdapter',
        });
        simulatedServer = new SimulatedServer({ port, dontSend: true });
        client = new Client(adapter, states);
        done();
    });

    it('MQTT client: Check if connected to MQTT broker', done => {
        setTimeout(async () => {
            const data = await adapter.getStateAsync('info.connection');
            expect(data.val).to.be.equal(true);
            done();
        }, 200);
    });

    after('MQTT simulatedServer: Stop MQTT simulatedServer', done => {
        simulatedServer.stop(done);
        client.destroy();
    });
});
