var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');

var objects = null;
var states  = null;
var mqttClient = null;
var connected = false;
var lastReceivedTopic;
var lastReceivedMessage;

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

    mqttClient.publish(mqttid, value);

    setTimeout(function () {
        objects.getObject(id, function (err, obj) {
            expect(obj).to.be.not.null.and.not.undefined;
            expect(obj._id).to.be.equal(id);
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
    }, 200);
}

function checkAdapter2Mqtt(id, mqttid, _it, _done) {
    var value = 'NewRoger' + Math.round(Math.random() * 100);
    _it.timeout(5000);

    console.log('Send ' + id);

    states.setState(id, {
        val: value,
        ack: false
    }, function (err, id) {
        setTimeout(function () {
            expect(lastReceivedTopic).to.be.equal(mqttid);
            expect(lastReceivedMessage).to.be.equal(value);
            _done();
        }, 200);
    });
}

function checkConnection(done) {
    states.getState('mqtt.0.clients', function (err, state) {
        if (err) console.error(err);
        if (state && state.val) {
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
        var clientConnected = false;
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
                if (_done && clientConnected) {
                    _done();
                    _done = null;
                }
            });
        });

        var MqttClient = require(__dirname + '/lib/mqttClient.js');

        // Start client to emit topics
        mqttClient = new MqttClient(function () {
            //on connected
            clientConnected = true;
            if (_done && brokerStarted && clientConnected) {
                _done();
                _done = null;
            }
        }, function (topic, message) {
            //console.log('Test MQTT Client received "' + topic + '": ' + message);
            // on receive
            lastReceivedTopic   = topic;
            lastReceivedMessage = message ? message.toString() : null;
        });
    });

    it('Check if test client connected', function (done) {
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

    after('Stop js-controller', function (done) {
        this.timeout(5000);
        setup.stopController(function () {
            done();
        });
    });
});