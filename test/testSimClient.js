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

    it('MQTT client: New topic with {val:null} payload should get type "mixed"', done => {
        const topic = 'clientTypetestNull';
        // A separate MQTT client publishes to the simulated broker;
        // the broker forwards it to the ioBroker client adapter under test.
        const publisher = new ClientEmitter(
            isConnected => {
                if (isConnected) {
                    publisher.publish(topic, JSON.stringify({ val: null }));
                    setTimeout(async () => {
                        const obj = await adapter.getForeignObjectAsync(`mqtt.0.${topic}`);
                        expect(obj).to.exist;
                        expect(obj.common.type).to.equal('mixed');
                        publisher.destroy();
                        done();
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'clientTypeTestPublisher', subscribe: false },
        );
    }).timeout(3000);

    after('MQTT simulatedServer: Stop MQTT simulatedServer', done => {
        simulatedServer.stop(done);
        client.destroy();
    });
});
