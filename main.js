/**
 *
 *      ioBroker mqtt Adapter
 *
 *      (c) 2014 bluefox
 *
 *      MIT License
 *
 */

var mqtt =    require('mqtt');
var utils =   require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('mqtt');

var client  = null;
var server  = null;
var values  = {};
var states  = {};
var objects = [];

var messageboxLen = 11;// '.messagebox'.length;

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
                // Take care about flash disk and do not write the same
                if (!fs.existsSync(__dirname + '/cert')) {
                    fs.mkdirSync(__dirname + '/cert');
                    fs.writeFileSync(__dirname + '/cert/privatekey.pem', obj.native.certificates[adapter.config.certPrivate]);
                    fs.writeFileSync(__dirname + '/cert/certificate.pem', obj.native.certificates[adapter.config.certPublic]);
                } else {
                    var cert;
                    if (!fs.existsSync(__dirname + '/cert/privatekey.pem')) {
                        fs.writeFileSync(__dirname + '/cert/privatekey.pem', obj.native.certificates[adapter.config.certPrivate]);
                    } else {
                        cert = fs.readFileSync(__dirname + '/cert/privatekey.pem');
                        if (cert != obj.native.certificates[adapter.config.certPrivate]) {
                            fs.writeFileSync(__dirname + '/cert/privatekey.pem', obj.native.certificates[adapter.config.certPrivate]);
                        }
                    }
                    if (!fs.existsSync(__dirname + '/cert/certificate.pem')) {
                        fs.writeFileSync(__dirname + '/cert/certificate.pem', obj.native.certificates[adapter.config.certPublic]);
                    } else {
                        cert = fs.readFileSync(__dirname + '/cert/certificate.pem');
                        if (cert != obj.native.certificates[adapter.config.certPublic]) {
                            fs.writeFileSync(__dirname + '/cert/certificate.pem', obj.native.certificates[adapter.config.certPublic]);
                        }
                    }
                }

                main();
            }
        });
    } else {
        // Delete certificates if they exist
        if (fs.existsSync(__dirname + '/cert/privatekey.pem')) {
            fs.unlinkSync(__dirname + '/cert/privatekey.pem');
        }
        if (fs.existsSync(__dirname + '/cert/certificate.pem')) {
            fs.unlinkSync(__dirname + '/cert/certificate.pem');
        }

        if (fs.existsSync(__dirname + '/cert')) fs.rmdirSync(__dirname + '/cert');

        // Start
        main();
    }
});

adapter.on('unload', function () {
    if (client) {
        client.end();
        client = null;
    }

    if (server) {
        for (var k in server.clients) {
            server.clients[k].stream.end();
        }
        server.clients = {};
        server = null;
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    if (!state) {
        delete states[id];
        id = id.replace(/\./g, '/');
        if (server) {
            for (var k in server.clients) {
                server.clients[k].publish({topic: adapter.config.prefix + id, payload: null});
            }
        } else if (client) {
            client.publish(adapter.config.prefix + id, null);
        }
    } else
    // you can use the ack flag to detect if state is desired or acknowledged
    if (state.ack && !id.match(/\.messagebox$/)) {
        var old = states[id] ? states[id].val : null;
        states[id] = state;
        if (!adapter.config.onchange || old !== state.val) {
            id = id.replace(/\./g, '/');
            if (server) {
                for (var k in server.clients) {
                    server.clients[k].publish({topic: adapter.config.prefix + id, payload: state2string(state.val)});
                }
            } else if (client) {
                client.publish(adapter.config.prefix + id, state2string(state.val));
            }
        }
    }
});

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'test': {
            // Try to connect to mqtt broker
            if (obj.callback && obj.message) {
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

function state2string(val) {
    return (val === null) ? 'null' : (val === undefined ? 'undefined' : val.toString());
}

function createClient(config) {
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
        if (config.debug) adapter.log.info(topic + ' : ' + message);

        // Ignore message if value does not changed
        if (config.onchange) {
            var oldValue = values[topic];
            if (oldValue !== undefined && oldValue == message) {
                return;
            } else {
                values[topic] = message;
            }
        }
        // Remove own prefix
        if (config.prefix && topic.substring(0, config.prefix.length) == config.prefix) topic = topic.substring(config.prefix.length);

        topic = topic.replace(/\//g, '.');
        if (topic[0] == '.') topic = topic.substring(1);

        if (objects.indexOf(topic) == -1) {
            objects.push(topic);
            // Create object if exists
            adapter.getObject(topic, function (err, obj) {
                if (!obj) {
                    adapter.setObject(topic, {
                        common: {
                            name: topic,
                            type: 'value'
                        },
                        native: {},
                        type: 'state'
                    });
                }
            });
        }
        var f = parseFloat(message);
        if (f.toString() == message) message = f;

        adapter.setState(topic, {val: message, ack: true});
    });

    client.on('connect', function () {
        adapter.log.info('Connected to ' + config.url);
        if (config.publishAllOnStart) {
            for (var id in states) {
                if (id.length <= messageboxLen || id.substring(id.length - messageboxLen) != '.messagebox') {
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
    var cltFunction = function (client) {
        var self = this;

        if (!self.clients) self.clients = {};

        client.on('connect', function (packet) {
            client.id = packet.clientId;
            if (config.user) {
                if (config.user != packet.username ||
                    config.pass != packet.password) {
                    adapter.log.warn('Client [' + packet.clientId + '] has invalid password(' + packet.password + ') or username(' + packet.username + ')');
                    client.connack({returnCode: 4});
                    if (self.clients[client.id]) delete self.clients[client.id];
                    client.stream.end();
                    return;
                }
            }

            adapter.log.info('Client [' + packet.clientId + '] connected');
            client.connack({returnCode: 0});
            self.clients[client.id] = client;

            // Send all subscribed variables to client
            if (config.publishAllOnStart) {
                for (var id in states) {
                    if (id.length <= messageboxLen || id.substring(id.length - messageboxLen) != '.messagebox') {
                        client.publish({topic: config.prefix + id.replace(/\./g, '/'), payload: state2string(states[id].val)});
                    }
                }
            }
        });

        client.on('publish', function (packet) {
            if (config.debug) adapter.log.info('Client [' + client.id + '] publishes "' + packet.topic + '": ' +  packet.payload);
            for (var k in self.clients) {
                self.clients[k].publish({topic: packet.topic, payload: packet.payload});
            }
            var topic = packet.topic;

            // Remove own prefix if
            if (config.prefix && topic.substring(0, config.prefix.length) == config.prefix) {
                topic = topic.substring(config.prefix.length);
            }

            topic = topic.replace(/\//g, '.');

            // If foreign state, add "mqtt.0" prefix
            if (states[topic] === undefined) {
                topic = adapter.namespace + ((topic[0] == '.') ? topic : ('.' + topic));
            }

            if (objects.indexOf(topic) == -1) {
                objects.push(topic);
                // Create object if not exists
                adapter.getObject(topic, function (err, obj) {
                    if (!obj) {
                        adapter.setObject(topic, {
                            common: {
                                name: topic,
                                type: 'value'
                            },
                            native: {},
                            type: 'state'
                        });
                    }
                });
            }

            // Try to convert into float
            var f = parseFloat(packet.payload);
            if (f.toString() == packet.payload) packet.payload = f;

            adapter.setState(topic, {val: packet.payload, ack: true});
        });

        client.on('subscribe', function (packet) {
            var granted = [];
            for (var i = 0; i < packet.subscriptions.length; i++) {
                adapter.log.info('Client [' + client.id + '] subscribes on "' + packet.subscriptions[i].topic + '"');
                granted.push(packet.subscriptions[i].qos);
            }

            client.suback({granted: granted, messageId: packet.messageId});
        });

        client.on('pingreq', function (packet) {
            adapter.log.debug('Client [' + client.id + '] pingreq');
            client.pingresp();
        });

        client.on('disconnect', function (packet) {
            adapter.log.info('Client [' + client.id + '] disconnected');
            client.stream.end();
        });

        client.on('close', function (err) {
            adapter.log.info('Client [' + client.id + '] closed');
            delete self.clients[client.id];
        });

        client.on('error', function (err) {
            adapter.log.error('[' + client.id + '] ' + err);

            if (!self.clients[client.id]) return;

            delete self.clients[client.id];
            client.stream.end();
        });
    };

    if (!config.ssl) {
        adapter.log.info('Started MQTT ' + (config.user ? 'authenticated ' : '') + 'server on port ' + (config.port || 1883));
        server = mqtt.createServer(cltFunction).listen(config.port || 1883);
    } else {
        adapter.log.info('Started MQTTs security ' + (config.user ? 'authenticated ' : '') + 'server on port ' + (config.port || 1883));
        server = mqtt.createSecureServer(
            __dirname + '/cert/privatekey.pem',
            __dirname + '/cert/certificate.pem',
            cltFunction).listen(config.port || 1883);
    }
}

var cnt = 0;
function readStatesForPattern(pattern) {
    adapter.getForeignStates(pattern, function (err, res) {
        if (!err && res) {
            if (!states) states = {};

            for (var id in res) {
                if (id.length <= messageboxLen || id.substring(id.length - messageboxLen) != '.messagebox') {
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

