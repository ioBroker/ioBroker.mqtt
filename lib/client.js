var mqtt            = require('mqtt');
var utils           = require(__dirname + '/utils');
var tools           = require(require(__dirname + '/utils').controllerDir + '/lib/tools');
var state2string    = require(__dirname + '/common').state2string;
var convertTopic2id = require(__dirname + '/common').convertTopic2id;
var convertID2topic = require(__dirname + '/common').convertID2topic;

var messageboxRegex = new RegExp('\\.messagebox$');

function MQTTClient(adapter, states) {
    if (!(this instanceof MQTTClient)) return new MQTTClient(adapter, states);

    var client    = null;
    var topic2id  = {};
    var id2topic  = {};
    var namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');
    var connected = false;

    this.destroy = function () {
        if (client) {
            client.end();
            client = null;
        }
    };

    this.onStateChange = function (id, state) {
        send2Server(id, state);
    };

    function send2Server(id, state, cb) {
        if (!client) return;
        var topic = id2topic[id];
        adapter.log.info('send2Server ' + id + '[' + topic + ']');
        if (!topic) {
            adapter.getForeignObject(id, function (err, obj) {
                if (!client) return;
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (object not found)');
                    if (cb) cb(id);
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, adapter.config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                send2Server(obj._id, state, cb);
            });
            return;
        }
        if (!state) {
            if (adapter.config.debug) adapter.log.debug('Send to server "' + adapter.config.prefix + topic + '": deleted');
            client.publish(adapter.config.prefix + topic, null);
        } else {
            var s = state2string(state.val);
            if (adapter.config.debug) adapter.log.debug('Send to server "' + adapter.config.prefix + topic + '": ' + s);

            if (adapter.config.extraSet && state && !state.ack) {
                client.publish(adapter.config.prefix + topic + '/set', s);
            } else {
                client.publish(adapter.config.prefix + topic, s);
            }
        }
        if (cb) cb(id);
    }

    function publishAllStates(config, toPublish) {
        if (!toPublish || !toPublish.length) {
            adapter.log.info('All states published');
            return;
        }

        if (!client) return;

        var id = toPublish[0];
        if (!id2topic[id]) {
            adapter.getForeignObject(id, function (err, obj) {
                if (!client) return;
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: "' + id + '" (object not found)');
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                setTimeout(function () {
                    publishAllStates(config, toPublish);
                }, 0);
            });
            return;
        }
        toPublish.shift();

        if (adapter.config.extraSet && states[id] && !states[id].ack) {
            client.publish(config.prefix + id.replace(/\./g, '/') + '/set', state2string(states[id].val), function (err) {
                if (err) adapter.log.error('client.publish2: ' + err);
                setTimeout(function () {
                    publishAllStates(config, toPublish);
                }, 0);
            });
        } else {
            if (states[id]) {
                client.publish(config.prefix + id.replace(/\./g, '/'), state2string(states[id].val), function (err) {
                    if (err) adapter.log.error('client.publish: ' + err);
                    setTimeout(function () {
                        publishAllStates(config, toPublish);
                    }, 0);
                });
            } else {
                setTimeout(function () {
                    publishAllStates(config, toPublish);
                }, 0);
            }
        }
    }

    var _constructor = (function (config) {

        var _url  = ((!config.ssl) ? 'mqtt' : 'mqtts') + '://' + (config.user ? (config.user + ':' + config.pass + '@') : '') + config.url + (config.port ? (':' + config.port) : '') + '?clientId=' + (tools.getHostname ? tools.getHostname() : utils.appName) + '.' + adapter.namespace;
        var __url = ((!config.ssl) ? 'mqtt' : 'mqtts') + '://' + (config.user ? (config.user + ':*******************@') : '') + config.url + (config.port ? (':' + config.port) : '') + '?clientId=' + (tools.getHostname ? tools.getHostname() : utils.appName) + '.' + adapter.namespace;
        adapter.log.info('Try to connect to ' + __url);
        client = mqtt.connect(_url, {
            keepalive:          config.keepalive || 10, /* in seconds */
            protocolId:         'MQTT',
            protocolVersion:    4,
            reconnectPeriod:    config.reconnectPeriod || 1000, /* in milliseconds */
            connectTimeout:     (config.connectTimeout || 30) * 1000, /* in milliseconds */
            clean:              config.clean === undefined ? true : config.clean
        });

        // By default subscribe on all topics
        if (!config.patterns) config.patterns = '#';

        if (typeof config.patterns == 'string') {
            config.patterns = config.patterns.split(',');
        }

        for (var i = 0; i < config.patterns.length; i++) {
            config.patterns[i] = config.patterns[i].trim();
            adapter.log.info('Subscribe on: "' + config.patterns[i] + '"');
            client.subscribe(config.patterns[i]);
        }

        // create connected object and state
        adapter.getObject('info.connection', function (err, obj) {
            if (!obj || !obj.common || obj.common.type !== 'boolean') {
                obj = {
                    _id:  'info.connection',
                    type: 'state',
                    common: {
                        role:  'indicator.connected',
                        name:  'If connected to MQTT broker',
                        type:  'boolean',
                        read:  true,
                        write: false,
                        def:   false
                    },
                    native: {}
                };

                adapter.setObject('info.connection', obj, function () {
                    adapter.setState('info.connection', connected, true);
                });
            }
        });

        // topic from MQTT broker received
        client.on('message', function (topic, message) {
            if (!topic) return;

            var isAck = true;

            if (adapter.config.extraSet) {
                if (topic.match(/\/set$/)) {
                    isAck = false;
                    topic = topic.substring(0, topic.length - 4);
                }
            }

            var id;
            // try to convert topic to ID
            if (topic2id[topic]) {
                id = topic2id[topic].id || convertTopic2id(topic, false, config.prefix, adapter.namespace);
            } else {
                id = convertTopic2id(topic, false, config.prefix, adapter.namespace);
            }

            if (id.length > config.maxTopicLength) {
                adapter.log.warn('[' + client.id + '] Topic name is too long: ' + id.substring(0, 100) + '...');
                return;
            }

            if (typeof message === 'object') message = message.toString();

            // Try to convert value
            var _val = message.replace(',', '.').replace(/^\+/, '');

            // +23.560 => 23.56, -23.000 => -23
            if (_val.indexOf('.') !== -1) {
                var i = _val.length - 1;
                while (_val[i] === '0' || _val[i] === '.') {
                    i--;
                    if (_val[i + 1] === '.') break;
                }
                if (_val[i + 1] === '0' || _val[i + 1] === '.') _val = _val.substring(0, i + 1);
            }
            var f = parseFloat(_val);

            if (f.toString() == _val) message = f;
            if (message === 'true')  message = true;
            if (message === 'false') message = false;

            if (config.debug) adapter.log.debug('Server publishes "' + topic + '": ' + message);

            if (typeof message === 'string' && message[0] === '{') {
                try {
                    message = JSON.parse(message);
                } catch (e) {
                    adapter.log.warn('Cannot parse "' + topic + '": ' + message);
                }
            }

            // if no cache for this topic found
            if (!topic2id[topic]) {
                topic2id[topic] = {id: null, isAck: isAck, message: message};

                // Create object if not exists
                adapter.getObject(id, function (err, obj) {
                    if (!obj) {
                        adapter.getForeignObject(id, function (err, obj) {
                            if (!obj) {
                                // create state
                                obj = {
                                    common: {
                                        name:  topic,
                                        write: true,
                                        read:  true,
                                        role:  'variable',
                                        desc:  'mqtt client variable',
                                        type:  typeof topic2id[topic].message
                                    },
                                    native: {
                                        topic: topic
                                    },
                                    type: 'state'
                                };

                                if (obj.common.type === 'object' && topic2id[topic].message.val !== undefined) {
                                    obj.common.type = typeof topic2id[topic].message.val;
                                }
                                id = adapter.namespace + '.' + id;
                                topic2id[topic].id = id;
                                id2topic[id]       = topic;

                                adapter.log.debug('Create object for topic: ' + topic + '[ID: ' + topic2id[topic].id + ']');

                                adapter.setForeignObject(topic2id[topic].id, obj, function (err) {
                                    if (err) adapter.log.error('setForeignObject: ' + err);
                                });

                                if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

                                // write
                                if (typeof topic2id[topic].message === 'object') {
                                    adapter.setForeignState(topic2id[topic].id, topic2id[topic].message);
                                } else {
                                    adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: topic2id[topic].isAck});
                                }
                            } else {
                                // expand old version of objects
                                if (namespaceRegEx.test(obj._id) && (!obj.native || !obj.native.topic)) {
                                    obj.native       = obj.native || {};
                                    obj.native.topic = topic;
                                    adapter.setForeignObject(obj._id, obj);
                                }
                                // this is topic from other adapter
                                topic2id[topic].id           = id;
                                id2topic[topic2id[topic].id] = topic;

                                if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

                                if (typeof topic2id[topic].message === 'object') {
                                    adapter.setForeignState(topic2id[topic].id, topic2id[topic].message);
                                } else {
                                    adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: topic2id[topic].isAck});
                                }
                            }
                        });
                    } else {
                        // expand old version of objects
                        if (namespaceRegEx.test(obj._id) && (!obj.native || !obj.native.topic)) {
                            obj.native       = obj.native || {};
                            obj.native.topic = topic;
                            adapter.setForeignObject(obj._id, obj, function (err) {
                                if (err) adapter.log.error('setForeignObject2: ' + err);
                            });
                        }

                        // this is topic from this adapter
                        topic2id[topic].id = obj._id;
                        id2topic[obj._id]  = topic;

                        if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

                        if (typeof topic2id[topic].message === 'object') {
                            adapter.setForeignState(topic2id[topic].id, topic2id[topic].message);
                        } else {
                            adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: topic2id[topic].isAck});
                        }
                    }
                });
            } else if (topic2id[topic].id === null) {
                if (config.debug) adapter.log.debug('Client received (but in process) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                topic2id[topic].message = message;
            } else {
                if (!config.onchange) {
                    if (topic2id[topic].message !== undefined) delete topic2id[topic].message;
                    if (topic2id[topic].isAck !== undefined)   delete topic2id[topic].isAck;
                }
                if (typeof message === 'object') {
                    if (!config.onchange || JSON.stringify(topic2id[topic].message) != JSON.stringify(message)) {
                        if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof message + '): ' + message);
                        adapter.setForeignState(topic2id[topic].id, message);
                    } else {
                        if (config.debug) adapter.log.debug('Client received (but ignored) "' + topic + '" (' + typeof message + '): ' + message);
                    }
                } else {
                    if (!config.onchange || topic2id[topic].message != message || topic2id[topic].isAck !== isAck) {
                        if (config.onchange) {
                            topic2id[topic].message = message;
                            topic2id[topic].isAck = isAck;
                        }
                        if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof message + '): ' + message);
                        adapter.setForeignState(topic2id[topic].id, {val: message, ack: isAck});
                    } else {
                        if (config.debug) adapter.log.debug('Client received (but ignored) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                    }
                }
            }
        });

        client.on('connect', function () {
            adapter.log.info('Connected to ' + config.url);
            connected = true;
            adapter.setState('info.connection', connected, true);

            if (config.publishAllOnStart) {
                var toPublish = [];
                for (var id in states) {
                    if (!messageboxRegex.test(id)) {
                        toPublish.push(id);
                    }
                }
                publishAllStates(config, toPublish);
            }
        });

        client.on('error', function (err) {
            adapter.log.error('Client error:' + err);

            if (connected) {
                adapter.log.info('Disconnected from ' + config.url);
                connected = false;
                adapter.setState('info.connection', connected, true);
            }
        });

        client.on('close', function (err) {
            if (connected) {
                adapter.log.info('Disconnected from ' + config.url);
                connected = false;
                adapter.setState('info.connection', connected, true);
            }
        });
    })(adapter.config);

    process.on('uncaughtException', function (err) {
        adapter.log.error('uncaughtException: ' + err);
    });

    return this;
}

module.exports = MQTTClient;