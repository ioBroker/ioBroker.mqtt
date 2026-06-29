'use strict';
const expect = require('chai').expect;
const Adapter = require('./lib/adapterSim');
const Server = require('../dist/lib/server');
const Client = require('./lib/mqttClient');

let port = 1883;

describe('MQTT server', function () {
    let adapter;
    let server;
    const states = {};
    this.timeout(3000);

    before('MQTT server: Start MQTT server', done => {
        adapter = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true,
        });
        server = new Server(adapter, states);
        done();
    });

    it('MQTT server: Check if connected to MQTT broker', done => {
        const client = new Client(
            isConnected => {
                if (done) {
                    expect(isConnected).to.be.true;
                    client.destroy();
                    done();
                    done = null;
                }
            },
            null,
            {
                url: '127.0.0.1:' + port,
                clientId: 'testClient1',
            },
        );
    });

    it('MQTT server: Check if subscribes stored', () => {
        let client;
        const data = 1;
        return new Promise(resolve => {
            client = new Client(
                isConnected => {
                    if (isConnected) {
                        client.subscribe('aaa');
                        setTimeout(() => client.destroy(), 200); // let time to send it out
                    } else {
                        adapter.setForeignState('mqtt.0.aaa', data);
                        server.onStateChange('mqtt.0.aaa', { val: data, ack: false });
                        setTimeout(() => resolve(), 100);
                    }
                },
                null,
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'testClient2',
                    resubscribe: false,
                },
            );
        }).then(() => {
            new Promise(resolve => {
                client = new Client(
                    () => {},
                    (topic, message) => {
                        if (topic === 'aaa') {
                            expect(topic).to.be.equal('aaa');
                            expect(message.toString()).to.be.equal(data.toString());
                            client.destroy();
                            resolve();
                        }
                    },
                    {
                        url: `127.0.0.1:${port}`,
                        clean: false,
                        clientId: 'testClient2',
                        resubscribe: false,
                    },
                );
            });
        });
    });

    it('MQTT server: Check if QoS1 retransmitted', done => {
        let client;
        const data = 1;
        let count = 0;
        const id = 'aaa2';
        let allowPuback = false;
        let receiveFunc;
        new Promise(resolve => {
            client = new Client(
                isConnected => {
                    if (isConnected) {
                        client.subscribe(id, { qos: 1 });
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data) => receiveFunc && receiveFunc(topic, data),
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'testClient3',
                    resubscribe: false,
                },
            );
            const sendPacket = client.client._sendPacket;
            // do not change "function (...)" to "=>"
            client.client._sendPacket = function (packet, cb, cbStorePut) {
                // ignore one puback
                if (packet.cmd === 'puback' && !allowPuback) {
                    count++;
                    cb && cb();
                    return;
                }
                sendPacket.call(this, packet, cb, cbStorePut);
            };
        })
            .then(async () => {
                await adapter.setForeignObjectAsync(`mqtt.0.${id}`, {
                    _id: `mqtt.0.${id}`,
                    common: { type: 'number' },
                    native: {},
                    type: 'state',
                });
                await adapter.setForeignStateAsync(`mqtt.0.${id}`, data);
                server.onStateChange(`mqtt.0.${id}`, { val: data, ack: false });

                return new Promise(resolve => {
                    setTimeout(() => resolve(), 1000);
                });
            })
            .then(() => {
                console.log(`[${new Date().toISOString()} continue tests`);
                expect(count).to.be.equal(1);
                allowPuback = true;
                receiveFunc = () => {
                    client.destroy();
                    done();
                };
            });
    }).timeout(5000);

    it('MQTT server: Check if QoS2 retransmitted', done => {
        let receiverClient;
        let emitterClient;
        const data = 1;
        const id = 'aaa3';
        let count = 0;
        let allowPubrec = false;
        let receiveFunc;
        new Promise(resolve => {
            receiverClient = new Client(
                isConnected => {
                    if (isConnected) {
                        receiverClient.subscribe(id, { qos: 2 });
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data) => receiveFunc && receiveFunc(topic, data),
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'receiverClient',
                    resubscribe: false,
                },
            );
            emitterClient = new Client(null, null, {
                url: `127.0.0.1:${port}`,
                clean: true,
                clientId: 'emitterClient',
                resubscribe: false,
            });
            const sendPacket = receiverClient.client._sendPacket;

            // do not change "function (...)" to "=>"
            receiverClient.client._sendPacket = function (packet, cb, cbStorePut) {
                // ignore pubrec
                if (packet.cmd === 'pubrec' && !allowPubrec) {
                    count++;
                    cb && cb();
                    return;
                }
                sendPacket.call(this, packet, cb);
            };
        })
            .then(() => {
                return new Promise(resolve => {
                    emitterClient.publish(id, data.toString(), 2, () => {}); // Send QoS 2
                    setTimeout(() => resolve(), 100);
                });
            })
            .then(() => {
                expect(count).to.be.equal(1);
                allowPubrec = true;
                receiveFunc = () => {
                    receiverClient.destroy();
                    emitterClient.destroy();
                    done();
                };
            });
    }).timeout(5000);

    it('MQTT server: Check if message with QoS1 received', done => {
        let receiverClient;
        let emitterClient;
        const data = 1;
        const id = 'aaa4';
        let receiveFunc;
        new Promise(resolve => {
            receiverClient = new Client(
                isConnected => {
                    if (isConnected) {
                        receiverClient.subscribe(id, { qos: 1 });
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data, packet) => receiveFunc && receiveFunc(topic, data, packet),
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'receiverClient',
                    resubscribe: false,
                },
            );
            emitterClient = new Client(null, null, {
                url: `127.0.0.1:${port}`,
                clean: true,
                clientId: 'emitterClient',
                resubscribe: false,
            });
        }).then(() => {
            return new Promise(resolve => {
                receiveFunc = (topic, data, packet) => {
                    expect(data).to.be.ok;
                    expect(topic).to.be.ok;
                    expect(packet.qos).to.be.equal(1);
                    receiverClient.destroy();
                    emitterClient.destroy();
                    done();
                };
                emitterClient.publish(id, data.toString(), 1, () => {}); // Send QoS 2
                setTimeout(() => resolve(), 100);
            });
        });
    }).timeout(1000);

    // check unsubscribe
    it('MQTT server: Check if unsubscribes works', () => {
        let client;
        const data = 1;
        let count = 0;
        return new Promise(resolve => {
            client = new Client(
                isConnected => {
                    if (isConnected) {
                        client.subscribe('aaa6');
                        setTimeout(() => {
                            adapter.setForeignState('mqtt.0.aaa6', data);
                            server.onStateChange('mqtt.0.aaa6', { val: data, ack: false });
                        }, 500);
                    }
                },
                (id, topic) => {
                    if (id.includes('aaa6')) {
                        console.log(`Received ${topic.toString()}`);
                        count++;
                        expect(count).to.be.equal(1);
                        setTimeout(() => resolve(), 100);
                    }
                },
                {
                    url: `127.0.0.1:${port}`,
                    clean: true,
                    clientId: 'testClient6',
                    resubscribe: false,
                },
            );
        }).then(() => {
            return new Promise(resolve => {
                client.unsubscribe('aaa6');
                client.unsubscribe('#');
                setTimeout(() => {
                    console.log('Resend data');
                    adapter.setForeignState('mqtt.0.aaa6', 2);
                    server.onStateChange('mqtt.0.aaa6', { val: 2, ack: false });
                    // wait 1 second to not receive the update
                    setTimeout(() => {
                        console.log('Done');
                        client.destroy();
                        resolve();
                    }, 1000);
                }, 300);
            });
        });
    }).timeout(3000);

    after('MQTT server: Stop MQTT server', done => {
        server.destroy(done);
    });
});
