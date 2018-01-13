'use strict';

var createStreamServer = require(__dirname + '/streamServer');
var mqtt               = require('mqtt-connection');
var state2string       = require(__dirname + '/common').state2string;
var convertTopic2id    = require(__dirname + '/common').convertTopic2id;
var convertID2topic    = require(__dirname + '/common').convertID2topic;
var messageboxRegex    = new RegExp('\\.messagebox$');

function MQTTServer(adapter, states) {
    if (!(this instanceof MQTTServer)) return new MQTTServer(adapter, states);

    var server    = null;
    var clients   = {};
    var topic2id  = {};
    var id2topic  = {};
    var namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');
    var messageId = 1;

    adapter.config.sendOnStartInterval = parseInt(adapter.config.sendOnStartInterval, 10) || 2000;
    adapter.config.sendInterval        = parseInt(adapter.config.sendInterval, 10) || 0;

    this.destroy = function () {
        if (server) {
            // to release all resources
            server.destroy(function () {
                console.log('all gone!');
            });
            server = null;
        }
    };
    
    this.onStateChange = function (id, state) {
        adapter.log.debug('onStateChange ' + id + ': ' + JSON.stringify(state));
        if (server) {
            setTimeout(function () {
                for (var k in clients) {
                    sendState2Client(clients[k], id, state);
                }
            }, 0);
        }
    };

    function updateClients() {
        var text = '';
        if (clients) {
            for (var id in clients) {
                text += (text ? ',' : '') + id;
            }
        }

        adapter.setState('info.connection', {val: text, ack: true});
    }
    
    function sendState2Client(client, id, state, qos, retain, cb) {
        var topic;
        if (messageboxRegex.test(id)) return;
        if (typeof qos === 'function') {
            cb  = qos;
            qos = undefined;
        }

        if (!id2topic[id]) {
            adapter.getForeignObject(id, function (err, obj) {
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (object not found)');
                    if (cb) cb(id);
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, adapter.config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                sendState2Client(client, obj._id, state, qos, retain, cb);
            });
            return;
        }

        // client has subscription for this ID
        if (!client._subsID ||
            client._subsID[id]) {
            topic = id2topic[id];
            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '/' + topic + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));

            if (adapter.config.extraSet && state && !state.ack) {
                client.publish({topic: topic + '/set', payload: (state ? state2string(state.val) : null), qos: qos, retain: retain, messageId: messageId++});
            } else {
                client.publish({topic: topic, payload: (state ? state2string(state.val) : null), qos: qos, retain: retain, messageId: messageId++});
            }
            messageId &= 0xFFFFFFFF;
        } else
        //  Check patterns
        if (client._subs && checkPattern(client._subs, id)) {
            topic = id2topic[id];
            // Cache the value
            client._subsID[id] = true;
            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '/' + topic + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));

            if (adapter.config.extraSet && state && !state.ack) {
                client.publish({topic: topic + '/set', payload: (state ? state2string(state.val) : null), qos: qos, retain: retain});
            } else {
                client.publish({topic: topic, payload: (state ? state2string(state.val) : null), qos: qos, retain: retain});
            }
        }
        if (cb) cb(id);
    }
    
    function sendStates2Client(client, list) {
        if (list && list.length) {
            var id = list.shift();
            sendState2Client(client, id, states[id], function () {
                setTimeout(function () {
                    sendStates2Client(client, list);
                }, adapter.config.sendInterval);
            });
        } else {
            //return;
        }
    }

    /*
     4.7.1.2 Multi-level wildcard

     The number sign (‘#’ U+0023) is a wildcard character that matches any number of levels within a topic. The multi-level wildcard represents the parent and any number of child levels. The multi-level wildcard character MUST be specified either on its own or following a topic level separator. In either case it MUST be the last character specified in the Topic Filter [MQTT-4.7.1-2].

     Non normative comment
     For example, if a Client subscribes to “sport/tennis/player1/#”, it would receive messages published using these topic names:
     ·         “sport/tennis/player1”
     ·         “sport/tennis/player1/ranking”
     ·         “sport/tennis/player1/score/wimbledon”

     Non normative comment
     ·         “sport/#” also matches the singular “sport”, since # includes the parent level.
     ·         “#” is valid and will receive every Application Message
     ·         “sport/tennis/#” is valid
     ·         “sport/tennis#” is not valid
     ·         “sport/tennis/#/ranking” is not valid

     */
    function checkPattern(patterns, id) {
        for (var pattern in patterns) {
            if (patterns.hasOwnProperty(pattern) && patterns[pattern].regex.test(id)) {
                return patterns[pattern];
            }
        }

        return null;
    }

    function processTopic(id, topic, message, qos, retain, isAck, obj, ignoreClient) {
        // expand old version of objects
        if (obj && namespaceRegEx.test(id) && (!obj.native || !obj.native.topic)) {
            obj.native       = obj.native || {};
            obj.native.topic = topic;
            adapter.setForeignObject(id, obj);
        }
        // this is topic from other adapter
        topic2id[topic].id           = id;
        id2topic[topic2id[topic].id] = topic;

        if (adapter.config.debug) adapter.log.debug('Server received "' + topic + '" (' + typeof message + '): ' + message);

        if (message !== undefined) {
            if (typeof message === 'object') {
                adapter.setForeignState(topic2id[topic].id, message, function (err, id) {
                    states[id] = message;
                });
            } else {
                adapter.setForeignState(topic2id[topic].id, {val: message, ack: isAck}, function (err, id) {
                    states[id] = {val: message, ack: isAck};
                });
            }
        } else {
            states[id] = {val: null, ack: isAck};
        }

        // send message to all other clients
        if (adapter.config.onchange && server && message !== undefined) {
            setTimeout(function () {
                if (typeof message !== 'object') {
                    message = {val: message};
                }
                for (var k in clients) {
                    // if get and set have different topic names, send state to issuing client too.
                    if (clients[k] === ignoreClient && !adapter.config.extraSet) continue;
                    sendState2Client(clients[k], id, message, qos, retain);
                }
            }, 0);
        }
        // ELSE
        // this will be done indirect. Message will be sent to js-controller and if adapter is subscribed, it gets this message over stateChange
    }

    function checkObject(id, topic, message, qos, retain, isAck, ignoreClient) {
        topic2id[topic] = {id: null, message: message};

        adapter.getObject(id, function (err, obj) {
            if (!obj) {
                adapter.getForeignObject(id, function (err, obj) {
                    if (!obj) {
                        id = adapter.namespace + '.' + id;
                        // create state
                        obj = {
                            common: {
                                name:  topic,
                                write: true,
                                read:  true,
                                role:  'variable',
                                desc:  'mqtt server variable',
                                type:  topic2id[topic].message !== undefined ? typeof topic2id[topic].message : 'string'
                            },
                            native: {
                                topic: topic
                            },
                            type: 'state'
                        };
                        if (obj.common.type === 'object' && topic2id[topic].message !== undefined && topic2id[topic].message.val !== undefined) {
                            obj.common.type = typeof topic2id[topic].message.val;
                        }

                        adapter.log.debug('Create object for topic: ' + topic + '[ID: ' + id + ']');
                        adapter.setForeignObject(id, obj, function (err) {
                            if (err) adapter.log.error('setForeignObject: ' + err);
                        });

                        processTopic(id, topic, topic2id[topic].message, qos, retain, isAck, null, ignoreClient);
                    } else {
                        processTopic(obj._id, topic, topic2id[topic].message, qos, retain, isAck, obj, ignoreClient);
                    }
                });
            } else {
                processTopic(obj._id, topic, topic2id[topic].message, qos, retain, isAck, obj, ignoreClient);
            }
        });
    }

    /*4.7.1.3 Single level wildcard

     The plus sign (‘+’ U+002B) is a wildcard character that matches only one topic level.

     The single-level wildcard can be used at any level in the Topic Filter, including first and last levels. Where it is used it MUST occupy an entire level of the filter [MQTT-4.7.1-3]. It can be used at more than one level in the Topic Filter and can be used in conjunction with the multilevel wildcard.

     Non normative comment
     For example, “sport/tennis/+” matches “sport/tennis/player1” and “sport/tennis/player2”, but not “sport/tennis/player1/ranking”. Also, because the single-level wildcard matches only a single level, “sport/+” does not match “sport” but it does match “sport/”.

     Non normative comment
     ·         “+” is valid
     ·         “+/tennis/#” is valid
     ·         “sport+” is not valid
     ·         “sport/+/player1” is valid
     ·         “/finance” matches “+/+” and “/+”, but not “+”
     */
    function pattern2RegEx(pattern) {
        pattern = convertTopic2id(pattern, true, adapter.config.prefix, adapter.namespace);
        pattern = pattern.replace(/#/g, '*');
        pattern = pattern.replace(/\$/g, '\\$');
        pattern = pattern.replace(/\^/g, '\\^');

        if (pattern !== '*') {
            if (pattern[0] === '*' && pattern[pattern.length - 1] !== '*') pattern += '$';
            if (pattern[0] !== '*' && pattern[pattern.length - 1] === '*') pattern = '^' + pattern;
            if (pattern[0] === '+') pattern = '^[^.]*' + pattern.substring(1);
            if (pattern[pattern.length - 1] === '+') pattern = pattern.substring(0, pattern.length - 1) + '[^.]*$';
        }
        pattern = pattern.replace(/\./g, '\\.');
        pattern = pattern.replace(/\*/g, '.*');
        pattern = pattern.replace(/\+/g, '[^.]*');
        return pattern;
    }

    function receivedTopic(packet, client) {
        var isAck   = true;
        var topic   = packet.topic;
        var message = packet.payload;
        var qos     = packet.qos;
        var retain  = packet.retain;
        var id;

        if (adapter.config.extraSet) {
            if (packet.topic.match(/\/set$/)) {
                isAck = false;
                packet.topic = packet.topic.substring(0, packet.topic.length - 4);
            }
        }

        if (topic2id[topic]) {
            id = topic2id[topic].id || convertTopic2id(topic, false, adapter.config.prefix, adapter.namespace);
        } else {
            id = convertTopic2id(topic, false, adapter.config.prefix, adapter.namespace);
        }

        if (!id) {
            adapter.log.error('Invalid topic name: ' + JSON.stringify(topic));
            return;
        }

        //adapter.log.info('Type: ' + typeof message);
        var type = typeof message;

        if (type !== 'string' && type !== 'number' && type !== 'boolean') {
            message = message ? message.toString('utf8') : 'null';
            type = 'string';
        }

        // try to convert 101,124,444,... To utf8 string
        if (type === 'string' && message.match(/^(\d)+,\s?(\d)+,\s?(\d)+/)) {
            //adapter.log.info('Try to convert ' + message);

            var parts = message.split(',');
            try {
                var str = '';
                for (var p = 0; p < parts.length; p++) {
                    str += String.fromCharCode(parseInt(parts[p].trim(), 10));
                }
                message = str;
            } catch (e) {
                // cannot convert and ignore it
            }
            //adapter.log.info('Converted ' + message);
        }

        // If state is unknown => create mqtt.X.topic
        if ((adapter.namespace + '.' + id).length > adapter.config.maxTopicLength) {
            adapter.log.warn('Topic name is too long: ' + id.substring(0, 100) + '...');
            return;
        }

        if (type === 'string') {
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

            if (f.toString() === _val) message = f;
            if (message === 'true')  message = true;
            if (message === 'false') message = false;
        }


        if (type === 'string' && message[0] === '{') {
            try {
                var _message = JSON.parse(message);
                // Fast solution
                if (_message.val !== undefined) {
                    message = _message;
                    // Really right, but slow
                    //var valid = true;
                    //for (var attr in _message) {
                    //    if (!_message.hasOwnProperty(attr)) continue;
                    //    if (attr !== 'val' && attr !== 'ack' && attr !== 'ts' && attr !== 'q' &&
                    //        attr !== 'lc' && attr !== 'comm' && attr !== 'lc') {
                    //        valid = false;
                    //        break;
                    //    }
                    //}
                    //if (valid) message = _message;
                }


            } catch (e) {
                adapter.log.error('Cannot parse ' + message)
            }
        }

        if (!topic2id[topic]) {
            checkObject(id, topic, message, qos, retain, isAck, client);
        } else if (topic2id[topic].id === null) {
            topic2id[topic].message = message;
            // still looking for id
            if (adapter.config.debug) adapter.log.debug('Server received (but in process) "' + topic + '" (' + typeof message + '): ' + message);
        } else {
            if (topic2id[topic].message !== undefined) delete topic2id[topic].message;

            processTopic(topic2id[topic].id, topic, message, qos, retain, isAck, null, client);
        }
    }

    var _constructor = (function (config) {
        var cltFunction = function (client) {

            client.on('connect', function (options) {
                client.id = options.clientId;
                if (config.user) {
                    if (config.user !== options.username ||
                        config.pass !== (options.password || '').toString()) {
                        adapter.log.warn('Client [' + options.clientId + '] has invalid password(' + options.password + ') or username(' + options.username + ')');
                        client.connack({returnCode: 4});
                        if (clients[client.id]) delete clients[client.id];
                        client.stream.end();
                        updateClients();
                        return;
                    }
                }

                adapter.log.info('Client [' + options.clientId + '] connected');
                client.connack({returnCode: 0});
                clients[client.id] = client;
                updateClients();

                if (options.will) { //  the client's will message options. object that supports the following properties:
                    // topic:   the will topic. string
                    // payload: the will payload. string
                    // qos:     will qos level. number
                    // retain:  will retain flag. boolean
                    client._will = JSON.parse(JSON.stringify(options.will));
                    var id;
                    if (topic2id[client._will.topic]) {
                        id = topic2id[client._will.topic].id || convertTopic2id(client._will.topic, false, config.prefix, adapter.namespace);
                    } else {
                        id = convertTopic2id(client._will.topic, false, config.prefix, adapter.namespace);
                    }
                    checkObject(id, client._will.topic);
                }

                // Send all subscribed variables to client
                if (config.publishAllOnStart) {

                    // Give to client 2 seconds to send subscribe
                    client._sendOnStart = setTimeout(function () {
                        client._sendOnStart = null;
                        var list = [];
                        // If client still connected
                        for (var id in states) {
                            if (states.hasOwnProperty(id)) {
                                list.push(id);
                            }
                        }
                        sendStates2Client(client, list);
                    }, adapter.config.sendOnStartInterval);
                }
            });

            client.on('publish', function (packet) {
                receivedTopic(packet, client);
            });

            client.on('subscribe', function (packet) {
                var granted = [];
                if (!client._subsID) client._subsID = {};
                if (!client._subs)   client._subs = {};

                for (var i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);

                    var topic  = packet.subscriptions[i].topic;
                    var id;

                    if (topic2id[topic]) {
                        id = topic2id[topic].id || convertTopic2id(topic, false, config.prefix, adapter.namespace);
                    } else {
                        id = convertTopic2id(topic, false, config.prefix, adapter.namespace);
                    }

                    if (!id) {
                        adapter.log.error('Invalid topic: ' + topic);
                        continue;
                    }

                    // if pattern without wildchars
                    if (id.indexOf('*') === -1 && id.indexOf('#') === -1 && id.indexOf('+') === -1) {
                        // If state is unknown => create mqtt.X.topic
                        if (!topic2id[topic]) {
                            checkObject(id, topic);
                            id = adapter.namespace + '.' + id;
                            adapter.log.info('Client [' + client.id + '] subscribes on topic "' + topic + '"');
                            client._subsID[id] = true;
                        } else {
                            client._subsID[topic2id[topic].id] = true;
                            adapter.log.info('Client [' + client.id + '] subscribes on "' + topic2id[topic].id + '"');
                            if (adapter.config.publishOnSubscribe) {
                                adapter.log.info('publishOnSubscribe');
                                sendState2Client(client, topic2id[topic].id, states[topic2id[topic].id]);
                            }
                        }
                    } else {
                        var pattern = topic.replace(/\//g, '.');
                        if (pattern[0] === '.') pattern = pattern.substring(1);

                        // add simple pattern
                        client._subs[topic] = {
                            regex:   new RegExp(pattern2RegEx(pattern)),
                            qos:     packet.subscriptions[i].qos,
                            pattern: pattern
                        };
                        adapter.log.info('Client [' + client.id + '] subscribes on "' + id + '" with regex /' + pattern2RegEx(pattern) + '/');

                        // add simple mqtt.0.pattern
                        pattern = adapter.namespace + '/' + pattern;
                        client._subs[adapter.namespace + '/' + topic] = {
                            regex:   new RegExp(pattern2RegEx(pattern)),
                            qos:     packet.subscriptions[i].qos,
                            pattern: pattern
                        };
                        adapter.log.info('Client [' + client.id + '] subscribes on "' + id + '"  with regex /' + pattern2RegEx(pattern) + '/');

                        if (adapter.config.publishOnSubscribe) {
                            adapter.log.info('publishOnSubscribe send all known states');
                            for (var savedId in states) {
                                if (states.hasOwnProperty(savedId) && checkPattern(client._subs, savedId)) {
                                    sendState2Client(client, savedId, states[savedId]);
                                }
                            }
                        }
                    }
                }

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('pingreq', function (/*packet*/) {
                adapter.log.debug('Client [' + client.id + '] pingreq');
                client.pingresp();
            });

            client.on('disconnect', function (/*packet*/) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.info('Client [' + client.id + '] disconnected');
                client.stream.end();
                if (clients[client.id]) {
                    delete clients[client.id];
                    if (client._will) receivedTopic(client._will);
                    updateClients();
                }
            });

            client.on('close', function (had_error) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                if (had_error) adapter.log.error('Closed because of error');
                adapter.log.info('Client [' + client.id + '] closed');
                if (clients[client.id]) {
                    delete clients[client.id];
                    if (client._will) receivedTopic(client._will);
                    updateClients();
                }
            });

            client.on('error', function (err) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.warn('Client error [' + client.id + ']: ' + err);

                if (!clients[client.id]) return;

                delete clients[client.id];
                if (client._will) receivedTopic(client._will);
                updateClients();
                client.stream.end();
            });
        };

        var serverConfig = {};
        var options = {
            ssl:        config.certificates,
            emitEvents: true // default
        };

        config.port = parseInt(config.port, 10) || 1883;

        if (config.ssl) {
            serverConfig.mqtts = 'ssl://0.0.0.0:' + config.port;
            if (config.webSocket) {
                serverConfig.mqtwss = 'wss://0.0.0.0:'  + (config.port + 1);
            }
        } else {
            serverConfig.mqtts = 'tcp://0.0.0.0:' + config.port;
            if (config.webSocket) {
                serverConfig.mqtwss = 'ws://0.0.0.0:'  + (config.port + 1);
            }
        }

        // create connected object and state
        adapter.getObject('info.connection', function (err, obj) {
            if (!obj || !obj.common || obj.common.type !== 'string') {
                obj = {
                    _id:  'info.connection',
                    type: 'state',
                    common: {
                        role:  'info.clients',
                        name:  'List of connected clients',
                        type:  'string',
                        read:  true,
                        write: false,
                        def:   false
                    },
                    native: {}
                };

                adapter.setObject('info.connection', obj, function () {
                    updateClients();
                });
            } else {
                updateClients();
            }
        });

        server = createStreamServer(serverConfig, options, function (clientStream) {
            cltFunction(mqtt(clientStream, {
                notData: !options.emitEvents
            }));
        });

        // to start
        server.listen(function () {
            if (config.ssl) {
                adapter.log.info('Starting MQTT (Secure) ' + (config.user ? 'authenticated ' : '') + ' server on port ' + config.port);
                if (config.webSocket) {
                    adapter.log.info('Starting MQTT-WebSocket (Secure) ' + (config.user ? 'authenticated ' : '') + ' server on port ' + (config.port + 1));
                }
            } else {
                adapter.log.info('Starting MQTT ' + (config.user ? 'authenticated ' : '') + ' server on port ' + config.port);
                if (config.webSocket) {
                    adapter.log.info('Starting MQTT-WebSocket ' + (config.user ? 'authenticated ' : '') + ' server on port ' + (config.port + 1));
                }
            }
        });
    })(adapter.config);
    
    return this;
}

module.exports = MQTTServer;