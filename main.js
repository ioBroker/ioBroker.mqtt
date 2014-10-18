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
var adapter = require(__dirname + '/../../lib/adapter.js')('mqtt');

var client = null;
var server = null;
var values = {};
var states = {};

var messageboxLen = 11;// '.messagebox'.length;

function decrypt(key, value) {
    var result = "";
    for(var i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

adapter.on('message', function (obj) {
    if (obj) processMessage(obj);
    processMessages();
});

adapter.on('ready', function () {
    adapter.config.pass = decrypt("Zgfr56gFe87jJOM", adapter.config.pass);
    if (adapter.config.ssl && adapter.config.type == 'server') {
        // Read the certificates and store it under
        // "adapter/mqtt/cert/privatekey.pem" and
        // "adapter/mqtt/cert/certificate.pem"
        // because mqtt does not support certificates not from file
        adapter.getForeignObject('system.config', function (err, obj) {
            if (err || !obj || !obj.common.certificates || !obj.common.certificates[adapter.config.certPublic] || !obj.common.certificates[adapter.config.certPrivate]) {
                adapter.log.error('Cannot enable secure MQTT server, because no certificates found: ' + adapter.config.certPublic + ', ' + adapter.config.certPrivate);
                setTimeout(function () {
                    process.exit(1);
                }, 500);
            } else {
                var fs = require('fs');
                // Take care about flash disk and do not write the same
                if (!fs.existsSync(__dirname + '/cert')) {
                    fs.mkdirSync(__dirname + '/cert');
                    fs.writeFileSync(__dirname + '/cert/privatekey.pem', obj.common.certificates[adapter.config.certPrivate]);
                    fs.writeFileSync(__dirname + '/cert/certificate.pem', obj.common.certificates[adapter.config.certPublic]);
                } else {
                    if (!fs.existsSync(__dirname + '/cert/privatekey.pem')) {
                        fs.writeFileSync(__dirname + '/cert/privatekey.pem', obj.common.certificates[adapter.config.certPrivate]);
                    } else {
                        var cert = fs.readFileSync(__dirname + '/cert/privatekey.pem');
                        if (cert != obj.common.certificates[adapter.config.certPrivate]) {
                            fs.writeFileSync(__dirname + '/cert/privatekey.pem', obj.common.certificates[adapter.config.certPrivate]);
                        }
                    }
                    if (!fs.existsSync(__dirname + '/cert/certificate.pem')) {
                        fs.writeFileSync(__dirname + '/cert/certificate.pem', obj.common.certificates[adapter.config.certPublic]);
                    } else {
                        var cert = fs.readFileSync(__dirname + '/cert/certificate.pem');
                        if (cert != obj.common.certificates[adapter.config.certPublic]) {
                            fs.writeFileSync(__dirname + '/cert/certificate.pem', obj.common.certificates[adapter.config.certPublic]);
                        }
                    }
                }

                main();
            }
        });
    } else {
        if (fs.existsSync(__dirname + '/cert/privatekey.pem')) {
            fs.unlinkSync(__dirname + '/cert/privatekey.pem');
        }
        if (fs.existsSync(__dirname + '/cert/certificate.pem')) {
            fs.unlinkSync(__dirname + '/cert/certificate.pem');
        }

        if (fs.existsSync(__dirname + '/cert')) fs.rmdirSync(__dirname + '/cert');
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
    // you can use the ack flag to detect if state is desired or acknowledged
    if (state.ack && (id.length <= messageboxLen || id.substring(id.length - messageboxLen) != '.messagebox')) {
        var old = states[id] ? states[id].val : null;
        states[id] = state;
        if (!adapter.config.onchange || old !== state.val) {
            id = id.replace(/\./g, '/');
            if (server) {
                for (var k in server.clients) {
                    server.clients[k].publish({topic: id, payload: state2string(state.val)});
                }
            } else if (client) {
                client.publish(id, state2string(state.val));
            }
        }
    }
});

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch(obj.command) {
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

function createClient(url, port, user, pass, patterns, ssl) {
    var _url = ((!ssl) ? 'mqtt' : 'mqtts') + '://' + (user ? (user + ':' + pass + '@') : '') + url + (port ? (':' + port) : '') + '?clientId=ioBroker.' + adapter.namespace;
    adapter.log.info('Try to connect to ' + _url);
    client = mqtt.connect(_url);
    if (!patterns) patterns = '#';
    if (typeof patterns == 'string') {
        patterns = patterns.split(',');
    }

    for (var i = 0; i < patterns.length; i++) {
        patterns[i] = patterns[i].trim();
        client.subscribe(patterns[i]);
    }

    client.on('message', function(topic, message) {
        if (!topic) return;
        if (adapter.config.debug) adapter.log.info(topic + ' : ' + message);

        // Ignore message if value does not changed
        if (adapter.config.onchange) {
            var oldValue = values[topic];
            if (oldValue !== undefined && oldValue == message) {
                return;
            } else {
                values[topic] = message;
            }
        }

        topic = topic.replace(/\//g, '.');
        if (topic[0] == '.') topic = topic.substring(1);
        adapter.setState(topic.replace(/\//g, '.'), {val: message, ack: true});
    });

    client.on('connect', function () {
        adapter.log.info('Connected to ' + url);
        for (var id in states) {
            if (id.length <= messageboxLen || id.substring(id.length - messageboxLen) != '.messagebox') {
                client.publish(id.replace(/\//g, '.'), state2string(states[id].val));
            }
        }
    });
}

function createServer(ip, port, ssl) {
    var cltFunction = function(client) {
        var self = this;

        if (!self.clients) self.clients = {};

        client.on('connect', function(packet) {
            adapter.log.info('Client [' + packet.clientId + '] connected');
            client.connack({returnCode: 0});
            client.id = packet.clientId;
            self.clients[client.id] = client;

            // Send all subscribed variables to client
            for (var id in states) {
                if (id.length <= messageboxLen || id.substring(id.length - messageboxLen) != '.messagebox') {
                    client.publish({topic: id.replace(/\./g, '/'), payload: state2string(states[id].val)});
                }
            }
        });

        client.on('publish', function(packet) {
            if (adapter.config.debug) adapter.log.info('Client [' + client.id + '] publishes "' + packet.topic + '": ' +  packet.payload);
            for (var k in self.clients) {
                self.clients[k].publish({topic: packet.topic, payload: packet.payload});
            }

            var topic = packet.topic.replace(/\//g, '.');
            if (states[topic] === undefined) {
                topic = adapter.namespace + ((topic[0] == '.') ? topic : ('.' + topic));
            }

            adapter.setState(topic, {val: packet.payload, ack: true});
        });

        client.on('subscribe', function(packet) {
            var granted = [];
            for (var i = 0; i < packet.subscriptions.length; i++) {
                adapter.log.info('Client [' + client.id + '] subscribes on "' + packet.subscriptions[i].topic + '"');
                granted.push(packet.subscriptions[i].qos);
            }

            client.suback({granted: granted, messageId: packet.messageId});
        });

        client.on('pingreq', function(packet) {
            adapter.log.debug('Client [' + client.id + '] pingreq');
            client.pingresp();
        });

        client.on('disconnect', function(packet) {
            adapter.log.info('Client [' + client.id + '] disconnected');
            client.stream.end();
        });

        client.on('close', function(err) {
            adapter.log.info('Client [' + client.id + '] closed');
            delete self.clients[client.id];
        });

        client.on('error', function(err) {
            adapter.log.error('[' + client.id + '] ' + err);

            if (!self.clients[client.id]) return;

            delete self.clients[client.id];
            client.stream.end();
        });
    };

    if (!ssl) {
        server = mqtt.createServer(cltFunction).listen(port || 1883);
    } else {
        server = mqtt.createSecureServer(
            __dirname + '/cert/privatekey.pem',
            __dirname + '/cert/certificate.pem',
            cltFunction).listen(port || 1883);
    }
}

function main() {
    var cnt = 0;

    // Subscribe on own variables to publish it
    if (adapter.config.publish) {
        var parts = adapter.config.publish.split(',');
        for (var t = 0; t < parts.length; t++) {
            adapter.subscribeForeignStates(parts[t].trim());
            cnt++;
            adapter.getForeignStates(parts[t].trim(), function (err, res) {
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
                        createClient(adapter.config.url, adapter.config.port, adapter.config.user, adapter.config.pass, adapter.config.patterns, adapter.config.ssl);
                    } else {
                        createServer('0.0.0.0', adapter.config.port, adapter.config.ssl);
                    }
                }
            });
        }
    }
    // If no subscription, start client or server
    if (!cnt) {
        if (adapter.config.type == 'client') {
            createClient(adapter.config.url, adapter.config.port, adapter.config.user, adapter.config.pass, adapter.config.patterns, adapter.config.ssl);
        } else {
            createServer('0.0.0.0', adapter.config.port, adapter.config.ssl);
        }
    }
}

