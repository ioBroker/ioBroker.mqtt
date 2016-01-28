var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');

var objects = null;
var states  = null;
var mqttClientEmitter = null;
var mqttClientDetector = null;
var connected = false;
var lastReceivedTopic1;
var lastReceivedMessage1;
var lastReceivedTopic2;
var lastReceivedMessage2;

var rules = {
    '/mqtt/0/test1': 'mqtt.0.test1',
    'mqtt/0/test2':  'mqtt.0.test2',
    'test3':         'mqtt.0.test3',
    'te s t4':       'mqtt.0.te_s_t4',
    'system/adapter/admin/upload':  'system.adapter.admin.upload',
    '/system/adapter/admin/upload': 'system.adapter.admin.upload'
};

function checkMqtt2Adapter(id, _expectedId, _it, _done) {
    _it.timeout(1000);
    var value = 'Roger' + Math.round(Math.random() * 100);
    var mqttid = id;
    if (!_expectedId) {
        id = id.replace(/\//g, '.').replace(/\s/g, '_');
        if (id[0] == '.') id = id.substring(1);
    } else {
        id = _expectedId;
    }
    if (id.indexOf('.') == -1) id = 'mqtt.0.' + id;

    lastReceivedMessage1 = null;
    lastReceivedTopic1   = null;
    lastReceivedTopic2   = null;
    lastReceivedMessage2 = null;

    mqttClientEmitter.publish(mqttid, value, function (err) {
        expect(err).to.be.undefined;

        setTimeout(function () {
            /*expect(lastReceivedTopic2).to.be.equal(mqttid);
             expect(lastReceivedMessage2).to.be.equal(value);*/

            objects.getObject(id, function (err, obj) {
                expect(obj).to.be.not.null.and.not.undefined;
                expect(obj._id).to.be.equal(id);
                expect(obj.type).to.be.equal('state');

                if (mqttid.indexOf('mqtt') != -1) {
                    expect(obj.native.topic).to.be.equal(mqttid);
                }

                states.getState(id, function (err, state) {
                    expect(state).to.be.not.null.and.not.undefined;
                    expect(state.val).to.be.equal(value);
                    expect(state.ack).to.be.true;
                    _done();
                });
            });
        }, 100);
    });
}

function checkAdapter2Mqtt(id, mqttid, _it, _done) {
    var value = 'NewRoger' + Math.round(Math.random() * 100);
    _it.timeout(5000);

    console.log(new Date().getTime() + ' Send ' + id + ' with value '+ value);

    lastReceivedTopic1   = null;
    lastReceivedMessage1 = null;
    lastReceivedTopic2   = null;
    lastReceivedMessage2 = null;

    states.setState(id, {
        val: value,
        ack: false
    }, function (err, id) {
        setTimeout(function () {
            expect(lastReceivedTopic1).to.be.equal(mqttid);
            expect(lastReceivedMessage1).to.be.equal(value);
            _done();
        }, 100);
    });
}

function checkConnection(done) {
    states.getState('mqtt.0.clients', function (err, state) {
        if (err) console.error(err);
        if (state && state.val && state.val.indexOf(',') != -1) {
            connected = true;
            done();
        } else {
            setTimeout(function () {
                checkConnection(done);
            }, 1000);
        }
    });
}

describe('Test mqtt server', function() {
    before('Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm
        var clientConnected1 = false;
        var clientConnected2 = false;
        var brokerStarted   = false;

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.publish  = 'mqtt.0.*';
            config.native.type     = 'server';
            setup.setAdapterConfig(config.common, config.native);

            setup.startController(function (_objects, _states) {
                objects = _objects;
                states  = _states;
                brokerStarted = true;
                if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                    _done();
                    _done = null;
                }
            });
        });

        // start mqtt server
        var MqttClient = require(__dirname + '/lib/mqttClient.js');

        // Start client to emit topics
        mqttClientEmitter = new MqttClient(function () {
            // on connected
            //console.log('Test MQTT Client is connected to MQTT broker');
            clientConnected1 = true;
            if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                _done();
                _done = null;
            }
        }, function (topic, message) {
            console.log((new Date()).getTime() + ' emitter received ' + topic + ': ' + message.toString());
            // on receive
            lastReceivedTopic1   = topic;
            lastReceivedMessage1 = message ? message.toString() : null;
        }, 'Emitter');

        // Start client to receive topics
        mqttClientDetector = new MqttClient(function () {
            // on connected
            //console.log('Test MQTT Client is connected to MQTT broker');
            clientConnected2 = true;
            if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                _done();
                _done = null;
            }
        }, function (topic, message) {
            console.log((new Date()).getTime() + ' detector received ' + topic + ': ' + message.toString());
            // on receive
            lastReceivedTopic2   = topic;
            lastReceivedMessage2 = message ? message.toString() : null;
        }, 'Detector');
    });

    it('Check if connected to MQTT broker', function (done) {
        this.timeout(2000);
        if (!connected) {
            checkConnection(done);
        } else {
            done();
        }
    });

    for (var r in rules) {
        (function(id, topic) {
            it('Check receive ' + id, function (done) {
                checkMqtt2Adapter(id, topic, this, done);
            });
        })(r, rules[r]);
    }

    // give time to client to receive all messages
    it('wait', function (done) {
        this.timeout(2000);
        setTimeout(function () {
            done();
        }, 1500);
    });

    for (var r in rules) {
        (function(id, topic) {
            if (topic.indexOf('mqtt') != -1) {
                it('Check send ' + topic, function (done) {
                    checkAdapter2Mqtt(topic, id, this, done);
                });
            }
        })(r, rules[r]);
    }
    
    it('detector must receive /mqtt/0/test1', function (done) {
        var mqttid = '/mqtt/0/test1';
        var value  = 'AABB';
        mqttClientEmitter.publish(mqttid, JSON.stringify({val: value, ack: false}), function (err) {
            expect(err).to.be.undefined;

            setTimeout(function () {
                expect(lastReceivedTopic2).to.be.equal(mqttid);
                expect(lastReceivedMessage2).to.be.equal(value);
                done();
            }, 100);
        });
    });

    after('Stop js-controller', function (done) {
        this.timeout(5000);
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        setup.stopController(function () {
            done();
        });
    });
});