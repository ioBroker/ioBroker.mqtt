/**
 *
 *      ioBroker mqtt Adapter
 *
 *      (c) 2014-2015 bluefox
 *
 *      MIT License
 *
 */

var utils    = require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter  = utils.adapter('mqtt');

var server   = null;
var client   = null;
var states   = {};

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
    adapter.config.maxTopicLength = adapter.config.maxTopicLength || 100;
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
    if (client) client.destroy();
    if (server) server.destroy();
});


// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    adapter.log.debug('stateChange ' + id + ': ' + JSON.stringify(state));
    var topic;
    // State deleted
    if (!state) {
        delete states[id];
        // If SERVER
        if (server) server.onStateChange(id);
        // if CLIENT
        if (client) client.onStateChange(id);
    } else
    // you can use the ack flag to detect if state is desired or acknowledged
    if ((adapter.config.sendAckToo || !state.ack) && !messageboxRegex.test(id)) {
        var oldVal = states[id] ? states[id].val : null;
        var oldAck = states[id] ? states[id].ack : null;
        states[id] = state;

        // If value really changed
        if (!adapter.config.onchange || oldVal !== state.val || oldAck !== state.ack) {
            // If SERVER
            if (server) server.onStateChange(id, state);
            // if CLIENT
            if (client) client.onStateChange(id, state);
        }
    }
});

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'test': {
            // Try to connect to mqtt broker
            if (obj.callback && obj.message) {
                var mqtt = require('mqtt');
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
        // If all patters answered, start client or server
        if (!--cnt) {
            if (adapter.config.type == 'client') {
                client = new require(__dirname + '/lib/client')(adapter, states);
            } else {
                server = new require(__dirname + '/lib/server')(adapter, states);
            }
        }
    });
}

function main() {
    // Subscribe on own variables to publish it
    if (adapter.config.publish) {
        var parts = adapter.config.publish.split(',');
        for (var t = 0; t < parts.length; t++) {
            if (parts[t].indexOf('#') !== -1) {
                adapter.log.warn('Used MQTT notation for ioBroker in pattern "' + parts[t] + '": use "' + parts[t].replace(/#/g, '*') + ' notation');
                parts[t] = parts[t].replace(/#/g, '*');
            }
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
            client = new require(__dirname + '/lib/client')(adapter, states);
        } else {
            server = new require(__dirname + '/lib/server')(adapter, states);
        }
    }
}

