var mqtt = require('mqtt');
var state2string       = require(__dirname + '/common').state2string;
var convertTopic2id    = require(__dirname + '/common').convertTopic2id;
var convertID2topic    = require(__dirname + '/common').convertID2topic;

var messageboxRegex    = new RegExp('\.messagebox$');

function MQTTClient(adapter, states) {
    if (!(this instanceof MQTTClient)) return new MQTTClient(adapter, states);
    var client   = null;
    var topic2id = {};
    var id2topic = {};

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
            client.publish(adapter.config.prefix + topic, s);
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


        client.publish(config.prefix + id.replace(/\./g, '/'), state2string(states[id].val), function (err) {
            if (err) adapter.log.error(err);
            setTimeout(function () {
                publishAllStates(config, toPublish);
            }, 0);
        });
    }

    var _constructor = (function (config) {

        var _url  = ((!config.ssl) ? 'mqtt' : 'mqtts') + '://' + (config.user ? (config.user + ':' + config.pass + '@') : '') + config.url + (config.port ? (':' + config.port) : '') + '?clientId=ioBroker.' + adapter.namespace;
        var __url = ((!config.ssl) ? 'mqtt' : 'mqtts') + '://' + (config.user ? (config.user + ':*******************@') : '') + config.url + (config.port ? (':' + config.port) : '') + '?clientId=ioBroker.' + adapter.namespace;
        adapter.log.info('Try to connect to ' + __url);
        client = mqtt.connect(_url);

        // By default subscribr on all topics
        if (!config.patterns) config.patterns = '#';

        if (typeof config.patterns == 'string') {
            config.patterns = config.patterns.split(',');
        }

        for (var i = 0; i < config.patterns.length; i++) {
            config.patterns[i] = config.patterns[i].trim();
            adapter.log.info('Subscribe on: "' + config.patterns[i] + '"');
            client.subscribe(config.patterns[i]);
        }

        client.on('message', function (topic, message) {
            if (!topic) return;
            var id;
            if (topic2id[topic]) {
                id = topic2id[topic].id || convertTopic2id(topic, false, config.prefix, adapter.namespace);
            } else {
                id = convertTopic2id(topic, false, config.prefix, adapter.namespace);
            }

            if (id.length > config.maxTopicLength) {
                adapter.log.warn('[' + client.id + '] Topic name is too long: ' + id.substring(0, 100) + '...');
                return;
            }

            if (typeof message == 'object') message = message.toString();

            var f = parseFloat(message);

            if (f.toString() == message) message = f;
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

            if (!topic2id[topic]) {
                topic2id[topic] = {id: null, message: message};

                // Create object if not exists
                adapter.getObject(id, function (err, obj) {
                    if (!obj) {
                        adapter.getForeignObject(id, function (err, obj) {
                            if (!obj) {
                                adapter.log.debug('Create object for topic: ' + topic);
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
                                    }
                                };

                                if (obj.common.type === 'object' && topic2id[topic].message.val !== undefined) {
                                    obj.common.type = typeof topic2id[topic].message.val;
                                }
                                id = adapter.namespace + '.' + id;
                                topic2id[topic].id = id;
                                id2topic[id]       = topic;

                                adapter.setForeignObject(topic2id[topic].id, obj, function (err) {
                                    if (err) adapter.log.error(err);
                                });

                                if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

                                // write
                                if (typeof topic2id[topic].message === 'object') {
                                    adapter.setForeignState(topic2id[topic].id, topic2id[topic].message);
                                } else {
                                    adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: true});
                                }
                            } else {
                                if (obj._id.substring(0, adapter.namespace.length + 1) === adapter.namespace + '.' &&
                                    !obj.native || !obj.native.topic) {
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
                                    adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: true});
                                }
                            }
                        });
                    } else {
                        if (obj._id.substring(0, adapter.namespace.length + 1) === adapter.namespace + '.' &&
                            !obj.native || !obj.native.topic) {
                            obj.native       = obj.native || {};
                            obj.native.topic = topic;
                            adapter.setForeignObject(obj._id, obj, function (err) {
                                if (err) adapter.log.error(err);
                            });
                        }

                        // this is topic from this adapter
                        topic2id[topic].id = obj._id;
                        id2topic[obj._id]  = topic;

                        if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

                        if (typeof topic2id[topic].message === 'object') {
                            adapter.setForeignState(topic2id[topic].id, topic2id[topic].message);
                        } else {
                            adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: true});
                        }
                    }
                });
            } else if (topic2id[topic].id === null) {
                if (config.debug) adapter.log.debug('Client received (but in process) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                topic2id[topic].message = message;
            } else {
                if (typeof message === 'object') {
                    if (!config.onchange || JSON.stringify(topic2id[topic].message) != JSON.stringify(message)) {
                        if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                        adapter.setForeignState(topic2id[topic].id, message);
                    } else {
                        if (config.debug) adapter.log.debug('Client received (but ignored) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                    }
                } else {
                    if (!config.onchange || topic2id[topic].message != message) {
                        if (config.debug) adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                        adapter.setForeignState(topic2id[topic].id, {val: message, ack: true});
                    } else {
                        if (config.debug) adapter.log.debug('Client received (but ignored) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                    }
                }
            }
        });

        client.on('connect', function () {
            adapter.log.info('Connected to ' + config.url);
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
            adapter.log.error(err);
        });
    })(adapter.config);

    process.on('uncaughtException', function (err) {
        adapter.log.error(err);
    });

    return this;
}


module.exports = MQTTClient;