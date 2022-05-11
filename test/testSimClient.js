'use strict';
const expect = require('chai').expect;
const Adapter = require('./lib/adapterSim');
const Server = require('./lib/mqttServer');
const ClientEmitter = require('./lib/mqttClient');
const Client = require('../lib/client');

let port = 1883;

describe('MQTT client', function () {
    let adapter;
    let server;
    let client;
    const states   = {};
    this.timeout(3000);

    before('MQTT client: Start MQTT server', done => {
        adapter = new Adapter({
            port: ++port,
            url: 'localhost',
            onchange: true,
            clientId: 'testClient'
        });
        server = new Server({port});
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

    it('MQTT client: receive binary data', () => {
        let emitterClient;
        const _id = 'aaa9';
        const data = Buffer.from([0,1,2,3,4,5]);

        return new Promise(resolve => {
            emitterClient = new ClientEmitter(async isConnected => {
                if (isConnected) {
                    await adapter.setForeignObjectAsync('mqtt.0.' + _id, {common: {type: 'file'}, type: 'state', native: {}});

                    emitterClient.publish('mqtt/0/' + _id, data);
                    setTimeout(async () => resolve(), 500);
                }
            },
            null,
            {
                url: 'localhost:' + port,
                clean: true,
                clientId: 'testClient10',
                resubscribe: false
            });
        })
            .then(async () => {
                const buffer = await adapter.getForeignBinaryStateAsync('mqtt.0.' + _id);
                expect(buffer.byteLength).to.be.equal(data.byteLength);
                emitterClient.destroy();
            });
    }).timeout(3000);

    it('MQTT client: publish binary data', () => {
        let emitterClient;
        const _id = 'aaa9';
        const data = Buffer.from([0,1,2,3,4,5]);
        let count = 0;

        return new Promise(resolve => {
            emitterClient = new ClientEmitter(async isConnected => {
                if (isConnected) {
                    await adapter.setForeignBinaryStateAsync('mqtt.0.' + _id, data);
                    client.onStateChange('mqtt.0.' + _id, {binary: true});
                }
            },
            (id, topic, packet) => {
                if (id.includes(_id)) {
                    console.log('Received ' + topic.toString());
                    expect(packet.payload.byteLength).to.be.equal(data.length);
                    expect(packet.payload[2]).to.be.equal(data[2]);
                    count++;
                    expect(count).to.be.equal(1);
                    setTimeout(() => resolve(), 100);
                }
            },
            {
                url: 'localhost:' + port,
                clean: true,
                clientId: 'testClient11',
                resubscribe: false
            });
        })
            .then(async () => {
                emitterClient.destroy();
            });
    }).timeout(3000);

    after('MQTT server: Stop MQTT server', done => {
        server.stop(done);
        client.destroy();
    });
});
