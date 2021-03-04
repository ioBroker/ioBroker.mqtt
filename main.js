/**
 *
 *      ioBroker mqtt Adapter
 *
 *      (c) 2014-2021 bluefox <dogafox@gmail.com>
 *
 *      MIT License
 *
 */
'use strict';

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();
let adapter;

let server = null;
let client = null;
let states = {};

const messageboxRegex = new RegExp('\\.messagebox$');

function decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});

    adapter = new utils.Adapter(options);

    adapter.on('message', obj =>
        obj && processMessage(obj));

    adapter.on('ready', () => {
        adapter.config.pass = decrypt('Zgfr56gFe87jJOM', adapter.config.pass);
        adapter.config.maxTopicLength = adapter.config.maxTopicLength || 100;
        if (adapter.config.ssl && adapter.config.type === 'server') {
            // Load certificates
            adapter.getCertificates((err, certificates) => {
                adapter.config.certificates = certificates;
                main();
            });
        } else {
            // Start
            main();
        }
    });

    adapter.on('unload', () => {
        client && client.destroy();
        server && server.destroy();
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        adapter.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
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
            const oldVal = states[id] ? states[id].val : null;
            const oldAck = states[id] ? states[id].ack : null;
            states[id] = state;

            // If value really changed
            if (!adapter.config.onchange || oldVal !== state.val || oldAck !== state.ack) {
                // If SERVER
                server && server.onStateChange(id, state);
                // if CLIENT
                client && client.onStateChange(id, state);
            }
        }
    });
    return adapter;
}

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'sendMessage2Client':
            if (server) {
                adapter.log.debug(`Sending message from server to clients via topic ${obj.message.topic}: ${obj.message.message} ...`);
                server.onMessage(obj.message.topic, obj.message.message);
            } else if (client) {
                adapter.log.debug(`Sending message from client to server via topic ${obj.message.topic}: ${obj.message.message} ...`);
                client.onMessage(obj.message.topic, obj.message.message);
            } else {
                adapter.log.debug(`Neither MQTT server nor client not started, thus not sending message via topic ${obj.message.topic} (${obj.message.message}).`);
            }
            break;

        case 'sendState2Client':
            if (server) {
                adapter.log.debug(`Sending message from server to clients ${obj.message.id}: ${obj.message.state} ...`);
                server.onStateChange(obj.message.id, obj.message.state);
            } else if (client) {
                adapter.log.debug(`Sending message from client to server ${obj.message.id}: ${obj.message.state} ...`);
                client.onStateChange(obj.message.id, obj.message.state);
            } else {
                adapter.log.debug(`Neither MQTT server nor client not started, thus not sending message to client ${obj.message.id} (${obj.message.state}).`);
            }
            break;

        case 'test': {
            // Try to connect to mqtt broker
            if (obj.callback && obj.message) {
                const mqtt = require('mqtt');
                const _url = `mqtt://${obj.message.user ? (`${obj.message.user}:${obj.message.pass}@`) : ''}${obj.message.url}${obj.message.port ? (':' + obj.message.port) : ''}?clientId=ioBroker.${adapter.namespace}`;
                const _client = mqtt.connect(_url);
                // Set timeout for connection
                const timeout = setTimeout(() => {
                    _client.end();
                    adapter.sendTo(obj.from, obj.command, 'timeout', obj.callback);
                }, 2000);

                // If connected, return success
                _client.on('connect', () => {
                    _client.end();
                    clearTimeout(timeout);
                    adapter.sendTo(obj.from, obj.command, 'connected', obj.callback);
                });
                // If connected, return success
                _client.on('error', (err) => {
                    _client.end();
                    clearTimeout(timeout);
                    adapter.log.warn(`Error on mqtt test: ${err}`);
                    adapter.sendTo(obj.from, obj.command, 'error', obj.callback);
                });
            }
        }
    }
}

let cnt = 0;
function readStatesForPattern(pattern) {
    adapter.getForeignStates(pattern, (err, res) => {
        if (!err && res) {
            states = states || {};

            Object.keys(res).filter(id => !messageboxRegex.test(id))
                .forEach(id => states[id] = res[id]);
        }
        // If all patters answered, start client or server
        if (!--cnt) {
            if (adapter.config.type === 'client') {
                client = new require('./lib/client')(adapter, states);
            } else {
                server = new require('./lib/server')(adapter, states);
            }
        }
    });
}

function main() {
    adapter.config.forceCleanSession = adapter.config.forceCleanSession || 'no'; // default

    // Subscribe on own variables to publish it
    if (adapter.config.publish) {
        const parts = adapter.config.publish.split(',');
        for (let t = 0; t < parts.length; t++) {
            if (parts[t].indexOf('#') !== -1) {
                adapter.log.warn(`Used MQTT notation for ioBroker in pattern "${parts[t]}": use "${parts[t].replace(/#/g, '*')} notation`);
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

    adapter.config.defaultQoS = parseInt(adapter.config.defaultQoS, 10) || 0;
    adapter.config.retain = adapter.config.retain === 'true' || adapter.config.retain === true;
    adapter.config.persistent = adapter.config.persistent === 'true' || adapter.config.persistent === true;
    adapter.config.retransmitInterval = parseInt(adapter.config.retransmitInterval, 10) || 2000;
    adapter.config.retransmitCount = parseInt(adapter.config.retransmitCount, 10) || 10;

    if (adapter.config.retransmitInterval < adapter.config.sendInterval) {
        adapter.config.retransmitInterval = adapter.config.sendInterval * 5;
    }
    adapter.EXIT_CODES = utils.EXIT_CODES || {
        ADAPTER_REQUESTED_TERMINATION: 11
    };

    // If no subscription, start client or server
    if (!cnt) {
        if (adapter.config.type === 'client') {
            client = new require(__dirname + '/lib/client')(adapter, states);
        } else {
            server = new require(__dirname + '/lib/server')(adapter, states);
        }
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
