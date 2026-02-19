'use strict';
const expect = require('chai').expect;
const Adapter = require('./lib/adapterSim');
const Server = require('../lib/server');
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

/**
 * Regression test for the QoS 2 session lockup fix.
 *
 * Scenario being tested:
 *   1. The broker publishes a QoS 2 message to a subscribed client.
 *   2. The client never responds with PUBREC, so the broker retransmits the message.
 *   3. Eventually the broker exceeds its retransmit count and deletes the message
 *      from its outgoing queue (client._messages).
 *   4. The client then sends a late PUBREC for the deleted messageId.
 *   5. The broker must respond with PUBREL to complete the handshake (the fix).
 *      Without the fix the broker would silently drop the PUBREC, leaving the client
 *      stuck in an infinite PUBREC loop.
 *
 * A dedicated server instance is used with very short retransmit settings so the
 * message is purged after ≈200 ms, keeping the test fast.
 */
describe('MQTT server: QoS2 session lockup regression', function () {
    let adapter2;
    let server2;
    const states2 = {};

    before('MQTT server: QoS2 lockup: Start server', done => {
        adapter2 = new Adapter({
            port: ++port,
            defaultQoS: 2,
            onchange: true,
            // Very short retransmit settings so the message is purged after ~200 ms:
            // First tick (100 ms): count=0, not yet exceeded → resend, count becomes 1
            // Second tick (100 ms): count=1 > retransmitCount=0 → delete
            retransmitInterval: 100,
            retransmitCount: 0,
        });
        server2 = new Server(adapter2, states2);
        // Give the TCP server a chance to start listening before the tests run
        setTimeout(done, 100);
    });

    it('MQTT server: QoS2 lockup: Broker sends PUBREL for orphaned PUBREC messageId', done => {
        const net = require('net');
        const mqttCon = require('mqtt-connection');
        const stream = net.createConnection(port, '127.0.0.1');
        const client = mqttCon(stream);

        let capturedMessageId = null;
        let firstPublishSeen = false;

        stream.on('error', err => {
            // Only fail the test if it hasn't already passed
            if (capturedMessageId === null) {
                done(err);
            }
        });

        // Step 1 – Connected: subscribe to the test topic with QoS 2
        client.on('connack', () => {
            client.subscribe({
                subscriptions: [{ topic: 'qos2orphan', qos: 2 }],
                messageId: 1,
            });
        });

        // Step 2 – Subscribed: trigger the broker to publish a QoS 2 message
        client.on('suback', async () => {
            // Ensure the object exists before calling onStateChange so that
            // getMqttMessage can resolve the id → topic mapping.
            await adapter2.setForeignObjectAsync('mqtt.0.qos2orphan', {
                _id: 'mqtt.0.qos2orphan',
                type: 'state',
                common: { type: 'string', name: 'qos2orphan', role: 'variable', read: true, write: true },
                native: {},
            });
            states2['mqtt.0.qos2orphan'] = { val: 'testPayload', ack: false };
            server2.onStateChange('mqtt.0.qos2orphan', { val: 'testPayload', ack: false });
        });

        // Step 3 – PUBLISH received: capture messageId but intentionally withhold PUBREC
        //          so that the broker retransmits and eventually purges the message.
        client.on('publish', packet => {
            if (!firstPublishSeen && packet.qos === 2) {
                firstPublishSeen = true;
                capturedMessageId = packet.messageId;

                // Wait long enough (400 ms > 2 × 100 ms retransmit interval) for the
                // broker to retransmit once and then delete the message from _messages.
                setTimeout(() => {
                    expect(capturedMessageId).to.be.a('number');
                    // Send PUBREC for the now-deleted messageId (the "orphaned" PUBREC)
                    client.pubrec({ messageId: capturedMessageId });
                }, 400);
            }
            // Ignore any retransmitted PUBLISH packets
        });

        // Step 4 – PUBREL received: the broker must send PUBREL for the unknown messageId
        //          (this is the behaviour introduced by the fix)
        client.on('pubrel', packet => {
            if (packet.messageId === capturedMessageId) {
                // Complete the handshake from the client side
                client.pubcomp({ messageId: packet.messageId });
                // Give pubcomp a moment to be flushed before tearing down the stream
                setTimeout(() => {
                    stream.destroy();
                    done();
                }, 50);
            }
        });

        // Initiate the MQTT connection
        client.connect({
            clientId: 'qos2OrphanRegression',
            clean: true,
            keepalive: 0,
            protocolId: 'MQTT',
            protocolVersion: 4,
        });
    }).timeout(5000);

    after('MQTT server: QoS2 lockup: Stop server', done => {
        server2.destroy(done);
    });
});
