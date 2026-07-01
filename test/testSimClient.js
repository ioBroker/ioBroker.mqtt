'use strict';
const assert = require('node:assert');
const Adapter = require('./lib/adapterSim').default;
const SimulatedServer = require('./lib/mqttServer').default;
const ClientEmitter = require('./lib/mqttClient').default;
const Client = require('../build/lib/MQTTClient').default;

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
            assert.strictEqual(data.val, true);
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
                        assert.ok(obj);
                        assert.strictEqual(obj.common.type, 'mixed');
                        publisher.destroy();
                        done();
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'clientTypeTestPublisher', subscribe: false },
        );
    }).timeout(3000);

    it('MQTT client: Existing numeric topic should keep type "number" after repeated JSON state publish', done => {
        const topic = 'clientTypetestNumber';
        const publisher = new ClientEmitter(
            isConnected => {
                if (isConnected) {
                    // First publish: creates topic with type 'number'
                    publisher.publish(topic, JSON.stringify({ val: 42 }));
                    setTimeout(() => {
                        // Second publish: must not flip type to 'object'/'mixed'
                        publisher.publish(topic, JSON.stringify({ val: 7 }));
                        setTimeout(async () => {
                            const obj = await adapter.getForeignObjectAsync(`mqtt.0.${topic}`);
                            assert.ok(obj);
                            assert.strictEqual(obj.common.type, 'number');
                            publisher.destroy();
                            done();
                        }, 500);
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'clientTypeTestNumberPublisher', subscribe: false },
        );
    }).timeout(3000);

    after('MQTT simulatedServer: Stop MQTT simulatedServer', done => {
        simulatedServer.stop(done);
        client.destroy();
    });
});
