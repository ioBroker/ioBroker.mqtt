/**
 *
 *      ioBroker mqtt Adapter
 *
 *      (c) 2014-2015 bluefox
 *
 *      MIT License
 *
 */

var utils   = require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('mqtt');

var mqtt    = null;

var client  = null;
var servers = null;
var clients = {};
var states  = {};
var objects = [];

var messageboxRegex = new RegExp("\.messagebox$");

function decrypt(key, value) {
    var result = "";
    for (var i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

adapter.on('message', function (obj) {
    if (obj) processMessage(obj);
    processMessages();
});

adapter.on('ready', function () {
    var fs = require('fs');
    adapter.config.pass = decrypt("Zgfr56gFe87jJOM", adapter.config.pass);
    if (adapter.config.ssl && adapter.config.type == 'server') {
        // Read the certificates and store it under
        // "adapter/mqtt/cert/privatekey.pem" and
        // "adapter/mqtt/cert/certificate.pem"
        // because mqtt does not support certificates not from file
        adapter.getForeignObject('system.certificates', function (err, obj) {
            if (err || !obj || !obj.native || !obj.native.certificates || !obj.native.certificates[adapter.config.certPublic] || !obj.native.certificates[adapter.config.certPrivate]) {
                adapter.log.error('Cannot enable secure MQTT server, because no certificates found: ' + adapter.config.certPublic + ', ' + adapter.config.certPrivate);
                setTimeout(function () {
                    process.exit(1);
                }, 500);
            } else {
                adapter.config.certificates = {
                    key:  obj.native.certificates[adapter.config.certPrivate],
                    cert: obj.native.certificates[adapter.config.certPublic]
                };

                main();
            }
        });
    } else {
        // Start
        main();
    }
});

adapter.on('unload', function () {
    if (client) {
        client.end();
        client = null;
    }

    if (servers) {
        // to release all resources
        servers.destroy(function(){
            console.log('all gone!');
        });
        servers = null;
    }
});


function checkPattern(patterns, id) {
    for (var pattern in patterns) {
        if (patterns[pattern].regex.test(id)) return patterns[pattern];
    }

    return null;
}

function id2topic(id, pattern) {
    var topic;
    if (pattern.substring(0, (adapter.config.prefix + adapter.namespace).length) == (adapter.config.prefix + adapter.namespace)) {
        topic = adapter.config.prefix + id;
    } else if (pattern.substring(0, adapter.namespace.length) == adapter.namespace) {
        topic = id;
    } else if (adapter.config.prefix && pattern.substring(0, adapter.config.prefix.length) == adapter.config.prefix) {
        topic = adapter.config.prefix + id;//.substring(adapter.namespace.length + 1);
    } else if (id.substring(0, adapter.namespace.length) == adapter.namespace) {
        topic = id.substring(adapter.namespace.length + 1);
    } else {
        topic = id;
    }
    topic = topic.replace(/\./g, '/');
    return topic;
}

function state2string(val) {
    return (val === null) ? 'null' : (val === undefined ? 'undefined' : val.toString());
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
    pattern = topic2id(pattern, true);
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

function topic2id(topic, dontCutNamespace) {
    topic = topic.replace(/\//g, '.');
    if (topic[0] == '.') topic = topic.substring(1);
    if (topic[topic.length - 1] == '.') topic = topic.substring(0, topic.length - 1);

    // Remove own prefix if
    if (adapter.config.prefix && topic.substring(0, adapter.config.prefix.length) == adapter.config.prefix) {
        topic = topic.substring(adapter.config.prefix.length);
    }

    if (!dontCutNamespace && topic.substring(0, adapter.namespace.length) == adapter.namespace) {
        topic = topic.substring(adapter.namespace.length + 1);
    }

    return topic;
}

function send2Client(client, id, state) {
    if (messageboxRegex.test(id)) return;

    if (!client._subsID ||
        client._subsID[id] !== undefined) {
        var topic = (client._subsID) ? client._subsID[id].pattern : adapter.config.prefix + id.replace(/\./g, '/');

        if (adapter.config.debug) adapter.log.info('Send to client [' + client.id + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));
        client.publish({topic: topic, payload: (state ? state2string(state.val) : null)});

    } else
    //  Check patterns
    if (client._subs) {
        var pattern = checkPattern(client._subs, id);

        if (pattern) {
            var topic = id2topic(id, pattern.pattern);
            // Cache the value
            client._subsID[id] = {
                qos: pattern,
                pattern: topic
            };
            if (adapter.config.debug) adapter.log.info('Send to client [' + client.id + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));
            client.publish({topic: topic, payload: (state ? state2string(state.val) : null)});
        }
    }
}

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {

    // State deleted
    if (!state) {
        delete states[id];
        // If SEVRER
        if (servers) {
            for (var k in clients) {
                send2Client(clients[k], id, state);
            }
        } else
        // if CLIENT
        if (client) {
            var topic = id.replace(/\./g, '/');
            if (adapter.config.debug) adapter.log.info('Send to server "' + adapter.config.prefix + topic + '": deleted');
            client.publish(adapter.config.prefix + topic, null);
        }
    } else
    // you can use the ack flag to detect if state is desired or acknowledged
    if ((adapter.config.sendAckToo || !state.ack) && !messageboxRegex.test(id)) {
        var old = states[id] ? states[id].val : null;
        states[id] = state;

        // If value realy changed
        if (!adapter.config.onchange || old !== state.val) {
            if (servers) {
                for (var k in clients) {
                    send2Client(clients[k], id, state);
                }
            } else
            if (client) {
                var topic = id.replace(/\./g, '/');
                if (adapter.config.debug) adapter.log.info('Send to server "' + adapter.config.prefix + topic + '": ' + state2string(state.val));
                client.publish(adapter.config.prefix + topic, state2string(state.val));
            }
        }
    }
});

function updateClients() {
    var text = '';
    if (clients) {
        for (var id in clients) {
            text += (text ? ',' : '') + id;
        }
    }

    adapter.setState('clients', {val: text, ack: true});
}

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'test': {
            // Try to connect to mqtt broker
            if (obj.callback && obj.message) {
                mqtt = mqtt || require('mqtt');
                var _url = 'mqtt://' + (obj.message.user ? (obj.message.user + ':' + obj.message.pass + '@') : '') + obj.message.url + (obj.message.port ? (':' + obj.message.port) : '') + '?clientId=ioBroker.' + adapter.namespace;
                var _client = mqtt.connect(_url);
                // Set timeout for connection
                var timeout = setTimeout(function () {
                    _client.end();
                    adapter.sendTo(obj.from, obj.command, 'timeout', obj.callback);
                }, 2000);

                // If connected, return success
                _client.on('connect', function () {
                    _client.end();
                    clearTimeout(timeout);
                    adapter.sendTo(obj.from, obj.command, 'connected', obj.callback);
                });
            }
        }
    }
}

function processMessages() {
    adapter.getMessage(function (err, obj) {
        if (obj) {
            processMessage(obj.command, obj.message);
            processMessages();
        }
    });
}

function createClient(config) {
    mqtt = mqtt || require('mqtt');

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
        client.subscribe(config.patterns[i]);
    }

    client.on('message', function (topic, message) {
        if (!topic) return;

        // Ignore message if value does not changed
        if (config.onchange) {
            var oldValue = states[topic];
            if (oldValue !== undefined && oldValue == message) {
                return;
            } else {
                states[topic] = message;
            }
        }
        topic = topic2id(topic);

        if (typeof message == 'object') message = message.toString();

        var f = parseFloat(message);

        if (objects.indexOf(topic) == -1) {
            objects.push(topic);
            // Create object if exists
            adapter.getObject(topic, function (err, obj) {
                if (!obj) {
                    adapter.getForeignObject(topic, function (err, obj) {
                        if (!obj) {
                            adapter.createState('', '', topic, {
                                name:  topic,
                                write: true,
                                read:  true,
                                role:  'variable',
                                desc:  'mqtt client variable',
                                type:  (f.toString() == message) ? 'number' : 'string'
                            }, {
                                origin: adapter.namespace
                            });
                        }
                    });
                }
            });
        }

        if (f.toString() == message) message = f;

        if (config.debug) adapter.log.info('Server publishes "' + adapter.namespace + '.' + topic + '": ' + message);

        if (typeof message == 'string' && message[0] == '{') {
            try {
                message = JSON.parse(message);
                adapter.setState(topic, message);
                return;
            } catch (e) {
                adapter.log.warn('Cannot parse "' + topic + '": ' + message);
            }
        }

        adapter.setState(topic, {val: message, ack: true});
    });

    client.on('connect', function () {
        adapter.log.info('Connected to ' + config.url);
        if (config.publishAllOnStart) {
            for (var id in states) {
                if (!messageboxRegex.test(id)) {
                    client.publish(config.prefix + id.replace(/\./g, '/'), state2string(states[id].val));
                }
            }
        }
    });

    client.on('error', function (err) {
        adapter.log.error(err);
    });
}

function createServer(config) {
    var createStreamServer  = require('create-stream-server');
    var mqtt = require('mqtt-connection');

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
                    // If client still connected
                    for (var id in states) {
                        send2Client(client, id, states[id]);
                    }
                }, 2000);
            }
        });

        client.on('publish', function (packet) {
            /*for (var k in clients) {
                clients[k].publish({topic: packet.topic, payload: packet.payload});
            }*/
            var topic = topic2id(packet.topic);

            if (typeof packet.payload == 'object') packet.payload = packet.payload.toString();

            var f = parseFloat(packet.payload);

            // If state is unknown => create mqtt.X.topic
            if (states[topic] === undefined && states[adapter.namespace + '.' + topic] === undefined) {
                adapter.log.info('Create state ' + adapter.namespace + '.' + topic);

                adapter.setObject(topic, {
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
                        origin: client.id
                    }
                });
                topic = adapter.namespace + '.' + topic;
                states[topic] = {};
            }

            // Try to convert into float
            if (f.toString() == packet.payload) packet.payload = f;

            if (typeof packet.payload == 'string' && packet.payload[0] == '{') {
                try {
                    packet.payload = JSON.parse(packet.payload);

                    if (states[topic]) {
                        if (config.debug) adapter.log.info('Client [' + client.id + '] publishes "' + topic + '": ' + JSON.stringify(packet.payload));

                        adapter.setForeignState(topic, packet.payload, function (id) {
                            states[id] = packet.payload;
                        });
                    } else {
                        if (config.debug) adapter.log.info('Client [' + client.id + '] publishes "' + adapter.namespace + '.' + topic + '": ' + JSON.stringify(packet.payload));

                        adapter.setState(topic, packet.payload, function (id) {
                            states[id] = packet.payload;
                        });
                    }
                    return;
                } catch (e) {
                    adapter.log.warn('Cannot parse "' + topic + '": ' + packet.payload);
                }
            }
            if (states[topic]) {
                if (config.debug) adapter.log.info('Client [' + client.id + '] publishes "' + topic + '": ' +  packet.payload);
                adapter.setForeignState(topic, {val: packet.payload, ack: true}, function (id) {
                    states[id] = {val: packet.payload, ack: true};
                });
            } else {
                if (config.debug) adapter.log.info('Client [' + client.id + '] publishes "' + adapter.namespace + '.' + topic + '": ' +  packet.payload);
                adapter.setState(topic, {val: packet.payload, ack: true}, function (id) {
                    states[id] = {val: packet.payload, ack: true};
                });
            }
        });

        client.on('subscribe', function (packet) {
            var granted = [];
            if (!client._subsID) client._subsID = {};
            if (!client._subs)   client._subs = {};

            for (var i = 0; i < packet.subscriptions.length; i++) {
                granted.push(packet.subscriptions[i].qos);

                var topic = topic2id(packet.subscriptions[i].topic);

                if (topic.indexOf('*') == -1 && topic.indexOf('#') == -1 && topic.indexOf('+') == -1) {
                    // If state is unknown => create mqtt.X.topic
                    if (states[topic] === undefined && states[adapter.namespace + '.' + topic] === undefined) {
                        adapter.log.info('Create state ' + adapter.namespace + '.' + topic + ' for subscribe');
                        adapter.setObject(topic, {
                            type: 'state',
                            common: {
                                name:  packet.subscriptions[i].topic,
                                write: true,
                                read:  true,
                                role:  'variable',
                                desc:  'mqtt variable',
                                type:  'string',
                                def:   null
                            },
                            native: {
                                origin: client.id
                            }
                        }, function (err, obj) {
                            states[obj.id] = {val: null, ack: true};
                            adapter.setState(obj.id, {val: null, ack: true});
                        });
                        topic = adapter.namespace + '.' + topic;
                        client._subsID[topic] = {
                            qos:     packet.subscriptions[i].qos,
                            pattern: packet.subscriptions[i].topic
                        }
                        adapter.log.info('Client [' + client.id + '] subscribes on "' + topic + '"');
                    } else {
                        if (states[topic]) {
                            client._subsID[topic] = {
                                qos:     packet.subscriptions[i].qos,
                                pattern: packet.subscriptions[i].topic
                            };
                            adapter.log.info('Client [' + client.id + '] subscribes on "' + topic + '"');
                        } else {
                            client._subsID[adapter.namespace + '.' + topic] = {
                                qos:     packet.subscriptions[i].qos,
                                pattern: packet.subscriptions[i].topic
                            };
                            adapter.log.info('Client [' + client.id + '] subscribes on "' + adapter.namespace + '.' + topic + '"');
                        }

                    }
                } else {
                    var topic = pattern2RegEx(packet.subscriptions[i].topic);

                    var pattern = packet.subscriptions[i].topic.replace(/\//g, '.');
                    if (pattern[0] == '.') pattern = pattern.substring(1);

                    client._subs[packet.subscriptions[i].topic] = {
                        regex:   new RegExp(topic),
                        qos:     packet.subscriptions[i].qos,
                        pattern: pattern
                    };
                    adapter.log.info('Client [' + client.id + '] subscribes on "' + topic2id(packet.subscriptions[i].topic) + '" with regex /' + topic + '/');

                    topic = adapter.namespace + '.' + topic2id(packet.subscriptions[i].topic);
                    client._subs[topic] = {
                        regex:   new RegExp(pattern2RegEx(topic)),
                        qos:     packet.subscriptions[i].qos,
                        pattern: pattern
                    };
                    adapter.log.info('Client [' + client.id + '] subscribes on "' + topic + '"  with regex /' + pattern2RegEx(topic) + '/');
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

    servers = createStreamServer(serverConfig, options, function (clientStream) {
        cltFunction(mqtt(clientStream, {
            notData: !options.emitEvents
        }));
    });

    // to start
    servers.listen(function () {
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
}

var cnt = 0;
function readStatesForPattern(pattern) {
    adapter.getForeignStates(pattern, function (err, res) {
        if (!err && res) {
            if (!states) states = {};

            for (var id in res) {
                if (!messageboxRegex.test(id)) {
                    states[id] = res[id];
                }
            }
        }
        cnt--;
        // If all patters answered, start client or server
        if (!cnt) {
            if (adapter.config.type == 'client') {
                createClient(adapter.config);
            } else {
                createServer(adapter.config);
            }
        }
    });
}

function main() {
    // Subscribe on own variables to publish it
    if (adapter.config.publish) {
        var parts = adapter.config.publish.split(',');
        for (var t = 0; t < parts.length; t++) {
            parts[t] = parts[t].trim();
            adapter.subscribeForeignStates(parts[t].trim());
            cnt++;
            readStatesForPattern(parts[t]);
        }
    } else {
        // subscribe for all variables
        adapter.subscribeForeignStates('*');
        readStatesForPattern('*');
    }
    // If no subscription, start client or server
    if (!cnt) {
        if (adapter.config.type == 'client') {
            createClient(adapter.config);
        } else {
            createServer(adapter.config);
        }
    }
}

