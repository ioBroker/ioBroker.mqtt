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
    var namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');

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
                setTimeout(function () {
                    sendStates2Client(client, list);
                }, 0);
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

    function processTopic(id, topic, message, obj, ignoreClient) {
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
                adapter.setForeignState(topic2id[topic].id, {val: message, ack: true}, function (err, id) {
                    states[id] = {val: message, ack: true};
                });
            }
        } else {
            states[id] = {val: null, ack: true};
        }

        // send message to all other clients
        if (adapter.config.onchange && server) {
            setTimeout(function () {
                for (var k in clients) {
                    if (clients[k] == ignoreClient) continue;
                    sendState2Client(clients[k], id, message);
                }
            }, 0);
        }
        // ELSE
        // this will be done indirect. Message will be sent to js-controller and if adapter is subscribed, it gets this message over stateChange
    }

    function checkObject(id, topic, message, ignoreClient) {
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
                            if (err) adapter.log.error(err);
                        });

                        processTopic(id, topic, topic2id[topic].message, null, ignoreClient);
                    } else {
                        processTopic(obj._id, topic, topic2id[topic].message, obj, ignoreClient);
                    }
                });
            } else {
                processTopic(obj._id, topic, topic2id[topic].message, obj, ignoreClient);
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
                var topic   = packet.topic;
                var message = packet.payload;
                var id;

                if (topic2id[topic]) {
                    id = topic2id[topic].id || convertTopic2id(topic, false, config.prefix, adapter.namespace);
                } else {
                    id = convertTopic2id(topic, false, config.prefix, adapter.namespace);
                }

                if (!id) {
                    adapter.log.error('Invalid topic name: ' + JSON.stringify(topic));
                    return;
                }

                //adapter.log.info('Type: ' + typeof message);

                if (typeof message == 'object') message = message.toString('utf8');

                // try to convert 101,124,444,... To utf8 string
                if (typeof message == 'string' && message.match(/(\d)+,\s?(\d)+,\s?(\d)+/)) {
                    //adapter.log.info('Try to convert ' + message);

                    var parts = message.split(',');
                    var str = '';
                    for (var p = 0; p < parts.length; p++) {
                        str += String.fromCharCode(parseInt(parts.trim(), 10));
                    }
                    message = str;
                    //adapter.log.info('Converted ' + message);
                }

                // If state is unknown => create mqtt.X.topic
                if ((adapter.namespace + '.' + id).length > adapter.config.maxTopicLength) {
                    adapter.log.warn('Topic name is too long: ' + id.substring(0, 100) + '...');
                    return;
                }

                // required for type detection
                var f = parseFloat(message);

                // Try to convert into float
                if (f.toString() === message) message = f;
                if (message === 'true')  message = true;
                if (message === 'false') message = false;

                if (typeof message == 'string' && message[0] == '{') {
                    try {
                        message = JSON.parse(message);
                    } catch (e) {
                        adapter.log.error('Cannot parse ' + message)
                    }
                }

                if (!topic2id[topic]) {
                    checkObject(id, topic, message, client);
                }else if (topic2id[topic].id === null) {
                    topic2id[topic].message = message;
                    // still looking for id
                    if (adapter.config.debug) adapter.log.debug('Server received (but in process) "' + topic + '" (' + typeof message + '): ' + message);
                } else {
                    if (topic2id[topic].message !== undefined) delete topic2id[topic].message;

                    processTopic(topic2id[topic].id, topic, message, null, client);
                }
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
                    if (id.indexOf('*') == -1 && id.indexOf('#') == -1 && id.indexOf('+') == -1) {
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
                        if (pattern[0] == '.') pattern = pattern.substring(1);

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
                                if (checkPattern(client._subs, savedId)) {
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