var createStreamServer = require('create-stream-server');
var mqtt               = require('mqtt-connection');
var state2string       = require(__dirname + '/common').state2string;
var convertTopic2id    = require(__dirname + '/common').convertTopic2id;
var convertID2topic    = require(__dirname + '/common').convertID2topic;
var messageboxRegex    = new RegExp("\.messagebox$");

function MQTTServer(adapter, states) {
    if (!(this instanceof MQTTServer)) return new MQTTServer(adapter, states);

    var server   = null;
    var clients  = {};
    var topic2id = {};
    var id2topic = {};

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
        if (server) {
            for (var k in clients) {
                sendState2Client(clients[k], id, state);
            }
        }
    };

    function updateClients() {
        var text = '';
        if (clients) {
            for (var id in clients) {
                text += (text ? ',' : '') + id;
            }
        }

        adapter.setState('clients', {val: text, ack: true});
    }
    
    function sendState2Client(client, id, state, cb) {
        var topic;
        if (messageboxRegex.test(id)) return;

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
                sendState2Client(client, obj._id, state);
            });
            return;
        }

        // client has subscription for this ID
        if (!client._subsID ||
            client._subsID[id]) {
            topic = id2topic[id];

            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));
            client.publish({topic: topic, payload: (state ? state2string(state.val) : null)});
        } else
        //  Check patterns
        if (client._subs && checkPattern(client._subs, id)) {
            topic = id2topic[id];
            // Cache the value
            client._subsID[id] = true;
            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));
            client.publish({topic: topic, payload: (state ? state2string(state.val) : null)});
        }
        if (cb) cb(id);
    }
    
    function sendStates2Client(client, list) {
        if (list && list.length) {
            var id = list.shift();
            sendState2Client(client, id, states[id], function () {
                sendStates2Client(client, list);
            });
        } else {
            return;
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
            if (patterns[pattern].regex.test(id)) return patterns[pattern];
        }

        return null;
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
        pattern = pattern.replace(/\#/g, '*');
        pattern = pattern.replace(/\$/g, '\\$');
        pattern = pattern.replace(/\^/g, '\\^');

        if (pattern != '*') {
            if (pattern[0] == '*' && pattern[pattern.length - 1] != '*') pattern += '$';
            if (pattern[0] != '*' && pattern[pattern.length - 1] == '*') pattern = '^' + pattern;
            if (pattern[0] == '+') pattern = '^[^.]*' + pattern.substring(1);
            if (pattern[pattern.length - 1] == '+') pattern = pattern.substring(0, pattern.length - 1) + '[^.]*$';
        }
        pattern = pattern.replace(/\./g, '\\.');
        pattern = pattern.replace(/\*/g, '.*');
        pattern = pattern.replace(/\+/g, '[^.]*');
        return pattern;
    }

    var _constructor = (function (config) {
        var cltFunction = function (client) {

            client.on('connect', function (packet) {
                client.id = packet.clientId;
                if (config.user) {
                    if (config.user != packet.username ||
                        config.pass != packet.password) {
                        adapter.log.warn('Client [' + packet.clientId + '] has invalid password(' + packet.password + ') or username(' + packet.username + ')');
                        client.connack({returnCode: 4});
                        if (clients[client.id]) delete clients[client.id];
                        client.stream.end();
                        updateClients();
                        return;
                    }
                }

                adapter.log.info('Client [' + packet.clientId + '] connected');
                client.connack({returnCode: 0});
                clients[client.id] = client;
                updateClients();

                // Send all subscribed variables to client
                if (config.publishAllOnStart) {

                    // Give to client 2 seconds to send subscribe
                    client._sendOnStart = setTimeout(function () {
                        client._sendOnStart = null;
                        var list = [];
                        // If client still connected
                        for (var id in states) {
                            list.push(id);
                        }
                        sendStates2Client(client, list);
                    }, 2000);
                }
            });

            client.on('publish', function (packet) {
                /*for (var k in clients) {
                 clients[k].publish({topic: packet.topic, payload: packet.payload});
                 }*/
                var id = topic2id[packet.topic] || convertTopic2id(packet.topic, false, config.prefix, adapter.namespace);

                if (!id) {
                    adapter.log.error('Invalid topic name: ' + JSON.stringify(packet.topic));
                    return;
                }

                //adapter.log.info('Type: ' + typeof packet.payload);

                if (typeof packet.payload == 'object') packet.payload = packet.payload.toString('utf8');

                // try to convert 101,124,444,... To utf8 string
                if (typeof packet.payload == 'string' && packet.payload.match(/(\d)+,\s?(\d)+,\s?(\d)+/)) {
                    //adapter.log.info('Try to convert ' + packet.payload);

                    var parts = packet.payload.split(',');
                    var str = '';
                    for (var p = 0; p < parts.length; p++) {
                        str += String.fromCharCode(parseInt(parts.trim(), 10));
                    }
                    packet.payload = str;
                    //adapter.log.info('Converted ' + packet.payload);
                }

                // If state is unknown => create mqtt.X.topic
                if ((adapter.namespace + '.' + id).length > adapter.config.maxTopicLength) {
                    adapter.log.warn('Topic name is too long: ' + id.substring(0, 100) + '...');
                    return;
                }

                if (states[id] === undefined && states[adapter.namespace + '.' + id] === undefined) {
                    id = adapter.namespace + '.' + id;
                    adapter.log.info('Create state ' + id);

                    adapter.setObject(id, {
                        type: 'state',
                        common: {
                            name:  packet.topic,
                            write: true,
                            read:  true,
                            role:  'variable',
                            desc:  'mqtt variable',
                            type:  (f.toString() == packet.payload) ? 'number' : 'string'
                        },
                        native: {
                            topic:  packet.topic,
                            origin: client.id
                        }
                    });
                    if (!topic2id[packet.topic]) topic2id[packet.topic] = id;
                    states[id] = {};
                }

                var f = parseFloat(packet.payload);

                // Try to convert into float
                if (f.toString() === packet.payload) packet.payload = f;
                if (packet.payload === 'true')  packet.payload = true;
                if (packet.payload === 'false') packet.payload = false;

                /*if (typeof packet.payload == 'string' && packet.payload[0] == '{') {
                 try {
                 packet.payload = JSON.parse(packet.payload);

                 if (states[topic]) {
                 if (config.debug) adapter.log.debug('Client [' + client.id + '] publishes "' + topic + '": ' + JSON.stringify(packet.payload));

                 adapter.setForeignState(topic, packet.payload, function (id) {
                 states[id] = packet.payload;
                 });
                 } else {
                 if (config.debug) adapter.log.debug('Client [' + client.id + '] publishes "' + adapter.namespace + '.' + topic + '": ' + JSON.stringify(packet.payload));

                 adapter.setState(topic, packet.payload, function (id) {
                 states[id] = packet.payload;
                 });
                 }
                 return;
                 } catch (e) {
                 adapter.log.warn('Cannot parse "' + topic + '": ' + packet.payload);
                 }
                 }*/
                if (states[id]) {
                    if (!topic2id[packet.topic]) topic2id[packet.topic] = id;

                    if (config.debug) adapter.log.debug('Client [' + client.id + '] publishes "' + id + '" (' + typeof packet.payload + '): ' +  packet.payload);
                    adapter.setForeignState(id, {val: packet.payload, ack: true}, function (err, id) {
                        states[id] = {val: packet.payload, ack: true};
                    });
                } else {
                    id = adapter.namespace + '.' + id;
                    if (!topic2id[packet.topic]) topic2id[packet.topic] = id;

                    if (config.debug) adapter.log.debug('Client [' + client.id + '] _publishes "' + id + '"(' + typeof packet.payload + '): ' +  packet.payload);
                    adapter.setForeignState(id, {val: packet.payload, ack: true}, function (err, _id) {
                        states[_id] = {val: packet.payload, ack: true};
                    });
                }
            });

            client.on('subscribe', function (packet) {
                var granted = [];
                if (!client._subsID) client._subsID = {};
                if (!client._subs)   client._subs = {};

                for (var i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);

                    var topic  = packet.subscriptions[i].topic;
                    var id = topic2id[topic] || convertTopic2id(topic, false, config.prefix, adapter.namespace);

                    if (!id) {
                        adapter.log.error('Invalid topic: ' + topic);
                        continue;
                    }

                    if (id.indexOf('*') == -1 && id.indexOf('#') == -1 && id.indexOf('+') == -1) {
                        // If state is unknown => create mqtt.X.topic
                        if (states[id] === undefined && states[adapter.namespace + '.' + id] === undefined) {
                            id = adapter.namespace + '.' + id;
                            adapter.log.info('Create state ' + id + ' for subscribe');
                            adapter.setForeignObject(id, {
                                type: 'state',
                                common: {
                                    name:  topic,
                                    write: true,
                                    read:  true,
                                    role:  'variable',
                                    desc:  'mqtt variable',
                                    type:  'string',
                                    def:   null
                                },
                                native: {
                                    topic:  topic,
                                    origin: client.id
                                }
                            }, function (err, obj) {
                                states[obj.id] = {val: null, ack: true};
                                adapter.setForeignState(obj.id, {val: null, ack: true});
                            });
                            client._subsID[id] = true;
                            adapter.log.info('Client [' + client.id + '] subscribes on "' + id + '"');
                            topic2id[topic] = id;
                        } else {
                            if (states[id]) {
                                client._subsID[id] = true;
                                adapter.log.info('Client [' + client.id + '] subscribes on "' + id + '"');
                                if (adapter.config.publishOnSubscribe) {
                                    if (!client._subsID[id]) {
                                        adapter.log.info('publishOnSubscribe');
                                        sendState2Client(client, id, states[id]);
                                    }
                                }
                                if (!topic2id[topic]) topic2id[topic] = id;
                            } else {
                                id = adapter.namespace + '.' + id;
                                if (!topic2id[topic]) topic2id[topic] = id;
                                client._subsID[id] = true;
                                adapter.log.info('Client [' + client.id + '] subscribes on "' + id + '"');
                            }
                        }
                    } else {
                        var pattern = topic.replace(/\//g, '.');
                        if (pattern[0] == '.') pattern = pattern.substring(1);

                        client._subs[topic] = {
                            regex:   new RegExp(pattern2RegEx(pattern)),
                            qos:     packet.subscriptions[i].qos,
                            pattern: pattern
                        };
                        adapter.log.info('Client [' + client.id + '] subscribes on "' + id + '" with regex /' + pattern2RegEx(pattern) + '/');

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
                                if (checkPattern(client._subs, savedId)) {
                                //if (!client._subsID[convertTopic2id(savedId, false, config.prefix)]) {
                                    sendState2Client(client, savedId, states[savedId]);
                                }
                            }
                        }
                    }
                }

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('pingreq', function (packet) {
                adapter.log.debug('Client [' + client.id + '] pingreq');
                client.pingresp();
            });

            client.on('disconnect', function (packet) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.info('Client [' + client.id + '] disconnected');
                client.stream.end();
            });

            client.on('close', function (err) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.info('Client [' + client.id + '] closed');
                delete clients[client.id];
                updateClients();
            });

            client.on('error', function (err) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.warn('[' + client.id + '] ' + err);

                if (!clients[client.id]) return;

                delete clients[client.id];
                updateClients();
                client.stream.end();
            });
        };

        var serverConfig = {};

        if (serverConfig.ssl) {
            serverConfig.mqtts = 'ssl://0.0.0.0:' + (config.port || 1883);
            if (serverConfig.webSocket) {
                serverConfig.mqtwss = 'wss://0.0.0.0:'  + ((config.port || 1883) + 1);
            }
        } else {
            serverConfig.mqtts = 'tcp://0.0.0.0:' + (config.port || 1883);
            if (serverConfig.webSocket) {
                serverConfig.mqtwss = 'ws://0.0.0.0:'  + ((config.port || 1883) + 1);
            }
        }

        var options = {
            ssl: adapter.config.certificates,
            emitEvents: true // default
        };

        server = createStreamServer(serverConfig, options, function (clientStream) {
            cltFunction(mqtt(clientStream, {
                notData: !options.emitEvents
            }));
        });

        // to start
        server.listen(function () {
            if (config.ssl) {
                adapter.log.info('Starting MQTT (Secure) ' + (config.user ? 'authenticated ' : '') + ' server on port ' + (config.port || 1883));
                if (config.webSocket) {
                    adapter.log.info('Starting MQTT-WebSocket (Secure) ' + (config.user ? 'authenticated ' : '') + ' server on port ' + ((config.port || 1883) + 1));
                }
            } else {
                adapter.log.info('Starting MQTT ' + (config.user ? 'authenticated ' : '') + ' server on port ' + (config.port || 1883));
                if (config.webSocket) {
                    adapter.log.info('Starting MQTT-WebSocket ' + (config.user ? 'authenticated ' : '') + ' server on port ' + ((config.port || 1883) + 1));
                }
            }
        });
    })(adapter.config);
    
    return this;
}


module.exports = MQTTServer;