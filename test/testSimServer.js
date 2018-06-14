const expect = require('chai').expect;
const Adapter = require('./lib/adapterSim');
const Server = require('../lib/server');
const Client = require('./lib/mqttClient');

let port = 1883;

describe('MQTT server', () => {
    let adapter;
    let server;
    let states   = {};

    before('MQTT server: Start MQTT server', done => {
        adapter = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true
        });
        server = new Server(adapter, states);
        done();
    });

    it.skip('MQTT server: Check if connected to MQTT broker', done => {
        let client = new Client(isConnected => {
                if (done) {
                    expect(isConnected).to.be.true;
                    client.destroy();
                    done();
                    done = null;
                }
            },
            null,
            {
                url: 'localhost:' + port,
                clientId: 'testClient1',
            }
        );
    });

    it.skip('MQTT server: Check if subscribes stored', () => {
        let client;
        const data = 1;
        return new Promise(resolve => {
            client = new Client(isConnected => {
                    if (isConnected) {
                        client.subscribe('aaa');
                        setTimeout(() => client.destroy(), 200); // let time to send it out
                    } else {
                        adapter.setForeignState('mqtt.0.aaa', data);
                        server.onStateChange('mqtt.0.aaa', {val: data, ack: false});
                        setTimeout(() => resolve(), 100);
                    }
                },
                null,
                {
                    url: 'localhost:' + port,
                    clean: false,
                    clientId: 'testClient2',
                    resubscribe: false
                }
            );
        })
            .then(() => {
                new Promise(resolve => {
                    client = new Client(
                        () => {

                        },
                        (topic, message) => {
                            expect(topic).to.be.equal('aaa');
                            expect(message.toString()).to.be.equal(data.toString());
                            client.destroy();
                            resolve();
                        },
                        {
                            url: 'localhost:' + port,
                            clean: false,
                            clientId: 'testClient2',
                            resubscribe: false
                        }
                    );
                })
            });
    });

    it.skip('MQTT server: Check if QoS1 retransmitted', done => {
        let client;
        const data = 1;
        let sendPacket;
        let count = 0;
        const id = 'aaa2';
        let allowPuback = false;
        let receiveFunc;
        new Promise(resolve => {
            client = new Client(isConnected => {
                    if (isConnected) {
                        client.subscribe(id);
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data) => receiveFunc && receiveFunc(topic, data),
                {
                    url: 'localhost:' + port,
                    clean: false,
                    clientId: 'testClient3',
                    resubscribe: false
                }
            );
            sendPacket = client.client._sendPacket;
            client.client._sendPacket = function (packet, cb) {
                // ignore puback
                if (packet.cmd === 'puback' && !allowPuback) {
                    count++;
                    cb && cb();
                    return;
                }
                sendPacket.call(this, packet, cb);
            };
        })
        .then(() => {
            return new Promise(resolve => {
                adapter.setForeignState('mqtt.0.' + id, data);
                server.onStateChange('mqtt.0.' + id, {val: data, ack: false});
                setTimeout(() => resolve(), 100);
            });
        })
        .then(() => {
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
        let sendPacket;
        let count = 0;
        let allowPuback = false;
        let receiveFunc;
        new Promise(resolve => {
            receiverClient = new Client(isConnected => {
                    if (isConnected) {
                        receiverClient.subscribe(id);
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data) => receiveFunc && receiveFunc(topic, data),
                {
                    url: 'localhost:' + port,
                    clean: false,
                    clientId: 'receiverClient',
                    resubscribe: false
                }
            );
            emitterClient = new Client(null, null,
                {
                    url: 'localhost:' + port,
                    clean: true,
                    clientId: 'emitterClient',
                    resubscribe: false
                }
            );
            sendPacket = receiverClient.client._sendPacket;
            receiverClient.client._sendPacket = function (packet, cb) {
                // ignore puback
                if (packet.cmd === 'pubcomp' && !allowPuback) {
                    count++;
                    cb && cb();
                    return;
                }
                sendPacket.call(this, packet, cb);
            };
        })
            .then(() => {
                return new Promise(resolve => {
                    emitterClient.publish(id, data.toString(), 2);
                    setTimeout(() => resolve(), 100);
                });
            })
            .then(() => {
                expect(count).to.be.equal(1);
                allowPuback = true;
                receiveFunc = () => {
                    receiverClient.destroy();
                    emitterClient.destroy();
                    done();
                };
            });
    }).timeout(5000);

    after('MQTT server: Stop MQTT server', done => {
        server.destroy(done);
    });
});
