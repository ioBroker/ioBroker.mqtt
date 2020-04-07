'use strict';

const mqtt            = require('mqtt');
const utils           = require('@iobroker/adapter-core');
const tools           = require(utils.controllerDir + '/lib/tools');
const state2string    = require('./common').state2string;
const convertTopic2id = require('./common').convertTopic2id;
const convertID2topic = require('./common').convertID2topic;

const messageboxRegex = new RegExp('\\.messagebox$');

function getAppName() {
    const parts = __dirname.replace(/\\/g, '/').split('/');
    return parts[parts.length - 2].split('.')[0];
}
utils.appName = getAppName();

function MQTTClient(adapter, states) {
    if (!(this instanceof MQTTClient)) {
        return new MQTTClient(adapter, states);
    }

    let client      = null;
    const topic2id  = {};
    const id2topic  = {};
    const namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');
    let connected   = false;

    this.destroy = () => {
        if (client) {
            client.end();
            client = null;
        }
    };

    this.onStateChange = (id, state) => send2Server(id, state);
    this.onMessage = (topic, message) => publishMessage(topic, message);

    function send2Server(id, state, cb) {
        if (!client) return;
        const topic = id2topic[id];
        adapter.log.info('send2Server ' + id + '[' + topic + ']');
        
        if (!topic) {
            return adapter.getForeignObject(id, (err, obj) => {
                if (!client) return;
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (object not found)');
                    cb && cb(id);
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, adapter.config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                send2Server(obj._id, state, cb);
            });
        }

        publishMessage(
            adapter.config.extraSet && state && !state.ack ? topic + '/set' : topic,
            state ? state : null
        );

        cb && cb(id);
    }

    function publishMessage(topic, message) {
        if (!message) {
            message = null;
            adapter.log.debug('Send to server "' + topic + '": deleted');
        } else {
            adapter.log.debug('Send to server "' + adapter.config.prefix + topic + '": ' + message);
        }

        client.publish(topic, state2string(message, adapter.config.sendStateObject), {qos: adapter.config.defaultQoS, retain: adapter.config.retain});
    }

    function publishAllStates(config, toPublish) {
        if (!toPublish || !toPublish.length) {
            adapter.log.info('All states published');
            return;
        }

        if (!client) return;

        const id = toPublish[0];
        if (!id2topic[id]) {
            adapter.getForeignObject(id, (err, obj) => {
                if (!client) return;
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: "' + id + '" (object not found)');
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                setImmediate(() => publishAllStates(config, toPublish));
            });
            return;
        }
        toPublish.shift();

        if (adapter.config.extraSet && states[id] && !states[id].ack) {
            client.publish(id2topic[id] + '/set', state2string(states[id], adapter.config.sendStateObject), {qos: adapter.config.defaultQoS, retain: adapter.config.retain}, err => {
                err && adapter.log.error('client.publish2: ' + err);
                setImmediate(() => publishAllStates(config, toPublish));
            });
        } else {
            if (states[id]) {
                client.publish(id2topic[id], state2string(states[id], adapter.config.sendStateObject), {qos: adapter.config.defaultQoS, retain: adapter.config.retain}, err => {
                    err && adapter.log.error('client.publish: ' + err);
                    setImmediate(() => publishAllStates(config, toPublish));
                });
            } else {
                setImmediate(() => publishAllStates(config, toPublish));
            }
        }
    }

    (function _constructor(config) {
        const  clientId = config.clientId || ((tools.getHostname ? tools.getHostname() : utils.appName) + '.' + adapter.namespace);
        const _url  = ((!config.ssl) ? 'mqtt' : 'mqtts') + '://' + (config.user ? (config.user + ':' + config.pass + '@') : '') + config.url + (config.port ? (':' + config.port) : '') + '?clientId=' + clientId;
        const __url = ((!config.ssl) ? 'mqtt' : 'mqtts') + '://' + (config.user ? (config.user + ':*******************@') : '') + config.url + (config.port ? (':' + config.port) : '') + '?clientId=' + clientId;
        adapter.log.info('Try to connect to ' + __url);
        
        client = mqtt.connect(_url, {
            keepalive:          config.keepalive || 10, /* in seconds */
            protocolId:         'MQTT',
            protocolVersion:    4,
            reconnectPeriod:    config.reconnectPeriod || 1000, /* in milliseconds */
            connectTimeout:     (config.connectTimeout || 30) * 1000, /* in milliseconds */
            clean:              !config.persistent
        });

        // By default subscribe on all topics
        config.patterns = config.patterns || '#';

        if (typeof config.patterns === 'string') {
            config.patterns = config.patterns.split(',');
        }

        // create connected object and state
        adapter.getObject('info.connection', (err, obj) => {
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

                adapter.setObject('info.connection', obj, () => adapter.setState('info.connection', connected, true));
            }
        });

        // create last Session object and state to store previous
        // topics in case of persisted sessions
        if (config.persistent) {
            adapter.getObject('info.lastSession', (err, obj) => {
                if (!obj || !obj.common || obj.common.type !== 'string') {
                    obj = {
                        _id:  'info.lastSession',
                        type: 'state',
                        common: {
                            role:  'variable',
                            name:  'Last session\'s topics',
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   false
                        },
                        native: {}
                    };

                    adapter.setObject('info.lastSession', obj, () => adapter.setState('info.lastSession', '', true));
                }
            });
        }

        // topic from MQTT broker received
        client.on('message', (topic, message) => {
            if (!topic) return;

            let isAck = true;

            if (adapter.config.extraSet) {
                if (topic.match(/\/set$/)) {
                    isAck = false;
                    topic = topic.substring(0, topic.length - 4);
                }
            }

            // try to convert topic to ID
            let id = (topic2id[topic] && topic2id[topic].id) || convertTopic2id(topic, false, config.prefix, adapter.namespace);

            if (id.length > config.maxTopicLength) {
                adapter.log.warn('[' + client.id + '] Topic name is too long: ' + id.substring(0, 100) + '...');
                return;
            }

            if (typeof message === 'object') {
                message = message.toString();
            }

            if (typeof message === 'string') {
                // Try to convert value
                let _val = message.replace(',', '.').replace(/^\+/, '');

                // +23.560 => 23.56, -23.000 => -23
                if (_val.indexOf('.') !== -1) {
                    let i = _val.length - 1;
                    while (_val[i] === '0' || _val[i] === '.') {
                        i--;
                        if (_val[i + 1] === '.') break;
                    }
                    if (_val[i + 1] === '0' || _val[i + 1] === '.') {
                        _val = _val.substring(0, i + 1);
                    }
                }
                const f = parseFloat(_val);

                if (f.toString() === _val) message = f;
                if (message === 'true')  message = true;
                if (message === 'false') message = false;
            }

            if (config.debug) {
                adapter.log.debug('Server publishes "' + topic + '": ' + message);
            }

            if (typeof message === 'string' && message[0] === '{') {
                try {
                    const _message = JSON.parse(message);
                    if (_message.val !== undefined && _message.ack !== undefined) {
                        message = _message;
                    }
                } catch (e) {
                    adapter.log.warn('Cannot parse "' + topic + '": ' + message);
                }
            }

            // if no cache for this topic found
            if (!topic2id[topic]) {
                topic2id[topic] = {id: null, isAck: isAck, message: message};

                // Create object if not exists
                adapter.getObject(id, (err, obj) => {
                    if (!obj) {
                        adapter.getForeignObject(id, (err, obj) => {
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

                                adapter.setForeignObject(topic2id[topic].id, obj, err => err && adapter.log.error('setForeignObject: ' + err));

                                config.debug && adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

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

                                config.debug && adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

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
                            adapter.setForeignObject(obj._id, obj, err => err && adapter.log.error('setForeignObject2: ' + err));
                        }

                        // this is topic from this adapter
                        topic2id[topic].id = obj._id;
                        id2topic[obj._id]  = topic;

                        config.debug && adapter.log.debug('Client received "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);

                        if (typeof topic2id[topic].message === 'object') {
                            adapter.setForeignState(topic2id[topic].id, topic2id[topic].message);
                        } else {
                            adapter.setForeignState(topic2id[topic].id, {val: topic2id[topic].message, ack: topic2id[topic].isAck});
                        }
                    }
                });
            } else if (topic2id[topic].id === null) {
                config.debug && adapter.log.debug('Client received (but in process) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                topic2id[topic].message = message;
            } else {
                if (!config.onchange) {
                    if (topic2id[topic].message !== undefined) delete topic2id[topic].message;
                    if (topic2id[topic].isAck !== undefined)   delete topic2id[topic].isAck;
                }
                if (typeof message === 'object') {
                    if (!config.onchange || JSON.stringify(topic2id[topic].message) !== JSON.stringify(message)) {
                        config.debug && adapter.log.debug('Client received "' + topic + '" (' + typeof message + '): ' + message);
                        adapter.setForeignState(topic2id[topic].id, message);
                    } else {
                        config.debug && adapter.log.debug('Client received (but ignored) "' + topic + '" (' + typeof message + '): ' + message);
                    }
                } else {
                    if (!config.onchange || topic2id[topic].message !== message || topic2id[topic].isAck !== isAck) {
                        if (config.onchange) {
                            topic2id[topic].message = message;
                            topic2id[topic].isAck = isAck;
                        }
                        config.debug && adapter.log.debug('Client received "' + topic + '" (' + typeof message + '): ' + message);
                        adapter.setForeignState(topic2id[topic].id, {val: message, ack: isAck});
                    } else {
                        config.debug && adapter.log.debug('Client received (but ignored) "' + topic + '" (' + typeof topic2id[topic].message + '): ' + topic2id[topic].message);
                    }
                }
            }
        });

        client.on('connect', () => {
            adapter.log.info('Connected to ' + config.url);
            connected = true;
            adapter.setState('info.connection', connected, true);

            // unsubscribe old topics in persisted session
            if (config.persistent) {
                adapter.getState('info.lastSession', (err, state) => {
                    const patternsPrevious = JSON.parse(state.val) || [];

                    const patternsDiff = patternsPrevious.filter(x => !config.patterns.includes(x));

                    for (let i = 0; i < patternsDiff.length; i++) {
                        patternsDiff[i] = patternsDiff[i].trim();
                        adapter.log.debug('Unsubscribed Topic: "' + patternsDiff[i] + '"');
                        client.unsubscribe(patternsDiff[i]);
                    }

                    adapter.setState('info.lastSession', JSON.stringify(config.patterns), true);
                });
            }

            // subscribe current topics
            for (let i = 0; i < config.patterns.length; i++) {
                config.patterns[i] = config.patterns[i].trim();
                adapter.log.info('Subscribe on: "' + config.patterns[i] + '"');
                client.subscribe(config.patterns[i]);
            }

            if (config.publishAllOnStart) {
                const toPublish = [];
                Object.keys(states).forEach(id => !messageboxRegex.test(id) && toPublish.push(id));
                publishAllStates(config, toPublish);
            }
        });

        client.on('error', err => {
            adapter.log.error('Client error:' + err);

            if (connected) {
                adapter.log.info('Disconnected from ' + config.url);
                connected = false;
                adapter.setState('info.connection', connected, true);
            }
        });

        client.on('close', err => {
            if (connected) {
                adapter.log.info('Disconnected from ' + config.url + ': ' + err);
                connected = false;
                adapter.setState('info.connection', connected, true);
            }
        });
    })(adapter.config);

    process.on('uncaughtException', err => adapter.log.error('uncaughtException: ' + err));

    return this;
}

module.exports = MQTTClient;