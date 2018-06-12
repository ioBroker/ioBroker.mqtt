'use strict';

const mqtt            = require('mqtt-connection');
const state2string    = require(__dirname + '/common').state2string;
const convertTopic2id = require(__dirname + '/common').convertTopic2id;
const convertID2topic = require(__dirname + '/common').convertID2topic;
const messageboxRegex = new RegExp('\\.messagebox$');

function MQTTServer(adapter, states) {
    if (!(this instanceof MQTTServer)) return new MQTTServer(adapter, states);

    const namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');

    let net;
    let http;
    let ws;
    let wsStream;
    let lastQueueCheck;
    let server      = null;
    let serverWs    = null;
    let serverForWs = null;
    let clients     = {};
    let topic2id    = {};
    let id2topic    = {};
    let messageId   = 1;
    let persistentSessions = {};

    adapter.config.sendOnStartInterval = parseInt(adapter.config.sendOnStartInterval, 10) || 2000;
    adapter.config.sendInterval        = parseInt(adapter.config.sendInterval,        10) || 0;

    this.destroy = () => {
        if (server) {
            // to release all resources
            server.close(() => console.log('all gone!'));
            server = null;
        }
        if (serverForWs) {
            // to release all resources
            serverForWs.close(() => console.log('all ws gone!'));
            serverForWs = null;
        }
    };

    this.onStateChange = (id, state) => {
        adapter.log.debug('onStateChange ' + id + ': ' + JSON.stringify(state));
        if (server) {
            setImmediate(() => {
                for (let k in clients) {
                    if (clients.hasOwnProperty(k)) {
                        sendState2Client(clients[k], id, state);
                    }
                }
            });
        }
    };

    function updateClients() {
        let text = '';
        if (clients) {
            for (let id in clients) {
                text += (text ? ',' : '') + id;
            }
        }

        adapter.setState('info.connection', {val: text, ack: true});
    }

    function sendState2Client(client, id, state, qos, retain, cb) {
        let topic;
        if (messageboxRegex.test(id)) return;
        if (typeof qos === 'function') {
            cb  = qos;
            qos = undefined;
        }

        if (!id2topic[id]) {
            adapter.getForeignObject(id, (err, obj) => {
                if (err) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (err: ' + err + ')');
                    if (cb) cb(id);
                    return;
                }
                if (!obj) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (object not found)');
                    if (cb) cb(id);
                    return;
                } else if (!obj._id) {
                    adapter.log.warn('Cannot resolve topic name for ID: ' + id + ' (object has no id): ' + JSON.stringify(obj));
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
        let message;
        if (!client._subsID ||
            client._subsID[id]) {
            topic = id2topic[id];
            if (adapter.config.debug) adapter.log.debug('Send to client [' + client.id + '/' + topic + '] "' + topic + '": ' + (state ? state2string(state.val) : 'deleted'));

            if (adapter.config.extraSet && state && !state.ack) {
                message = {topic: topic + '/set', payload: (state ? state2string(state.val) : null), qos: qos, retain: retain, messageId: messageId++};
            } else {
                message = {topic: topic, payload: (state ? state2string(state.val) : null), qos: qos, retain: retain, messageId: messageId++};
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
                message = {topic: topic + '/set', payload: (state ? state2string(state.val) : null), qos: qos, retain: retain, messageId: messageId++};
            } else {
                message = {topic: topic, payload: (state ? state2string(state.val) : null), qos: qos, retain: retain, messageId: messageId++};
            }
        }
        if (message) {
            client.publish(message);
            if (qos) {
                message.ts = Date.now();
                client._messages = client._messages || [];
                client._messages.push(message);
            }
        }

        if (cb) cb(id);
    }

    function sendStates2Client(client, list) {
        if (list && list.length) {
            const id = list.shift();
            sendState2Client(client, id, states[id], 0, true, () => {
                setTimeout(() => sendStates2Client(client, list), adapter.config.sendInterval);
            });
        } else {
            //return;
        }
    }
    function sendMessages2Client(client, messages, i) {
        i = i || 0;
        if (messages && i < messages.length) {
            sendState2Client(client, messages[i].id, messages[i].val, messages[i].qos, messages[i].retain, () => {
                setTimeout(() => sendMessages2Client(client, messages, i + 1), adapter.config.sendInterval);
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
        for (let pattern in patterns) {
            if (patterns.hasOwnProperty(pattern) && patterns[pattern].regex.test(id)) {
                return patterns[pattern];
            }
        }

        return null;
    }

    function processTopic(id, topic, message, qos, retain, isAck, obj, ignoreClient, cb) {
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
                adapter.setForeignState(topic2id[topic].id, message, (err, id) => states[id] = message);
            } else {
                adapter.setForeignState(topic2id[topic].id, {val: message, ack: isAck}, (err, id) => states[id] = {val: message, ack: isAck});
            }
        } else {
            states[id] = {val: null, ack: isAck};
        }

        // send message to all other clients
        if (adapter.config.onchange && server && message !== undefined) {
            setImmediate(() => {
                if (typeof message !== 'object') {
                    message = {val: message};
                }
                for (let k in clients) {
                    // if get and set have different topic names, send state to issuing client too.
                    if (clients[k] === ignoreClient && !adapter.config.extraSet) continue;
                    sendState2Client(clients[k], id, message, qos, retain, cb);
                }
            });
        }
        // ELSE
        // this will be done indirect. Message will be sent to js-controller and if adapter is subscribed, it gets this message over stateChange

        if (cb) cb();
    }

    function checkObject(id, topic, message, qos, retain, isAck, ignoreClient) {
        topic2id[topic] = {id: null, message: message};

        adapter.getObject(id, (err, obj) => {
            if (!obj) {
                adapter.getForeignObject(id, (err, obj) => {
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
                        adapter.setForeignObject(id, obj, err => err && adapter.log.error('setForeignObject: ' + err));

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

    function receivedTopic(packet, client, cb) {
        let   isAck   = true;
        const topic   = packet.topic;
        let   message = packet.payload;
        const qos     = packet.qos;
        const retain  = packet.retain;
        const now     = Date.now();
        let   id;

        if (qos === 1) {
            // send PUBACK to client
            client.puback({
                messageId: packet.messageId
            });
        } else if (qos === 2) {
            const pack = client._messages.find(e => {
                cb && cb();
                return e.messageId === packet.messageId;
            });
            if (pack) {
                // duplicate message => ignore
                adapter.log.warn('Ignored duplicate message with ID: ' + packet.messageId);
                cb && cb();
                return;
            } else {
                client._messages.push({topic, qos, retain, messageId: packet.messageId, ts: now, payload: message});
                client.pubrec({
                    messageId: packet.messageId
                });
            }
        }

        // check old messages => Todo move this part to setInterval for all clients and check it every 10 seconds together with resends
        if (client._messages.length && (!lastQueueCheck || now - lastQueueCheck > 20000)) {
            lastQueueCheck = now;
            for (let q = client._messages.length - 1; q >= 0; q--) {
                if (now - client._messages[q].ts > 10000) {
                    adapter.log.warn('Timeout for PUBREL message with ID: ' + client._messages[q].messageId);
                    client._messages.splice(q, 1);
                }
            }
        }

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
            if (cb) cb();
            return;
        }

        //adapter.log.info('Type: ' + typeof message);
        let type = typeof message;

        if (type !== 'string' && type !== 'number' && type !== 'boolean') {
            message = message ? message.toString('utf8') : 'null';
            type = 'string';
        }

        // try to convert 101,124,444,... To utf8 string
        if (type === 'string' && message.match(/^(\d)+,\s?(\d)+,\s?(\d)+/)) {
            //adapter.log.info('Try to convert ' + message);

            let parts = message.split(',');
            try {
                let str = '';
                for (let p = 0; p < parts.length; p++) {
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
            if (cb) cb();
            return;
        }

        if (type === 'string') {
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


        if (type === 'string' && message[0] === '{') {
            try {
                const _message = JSON.parse(message);
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
            if (cb) cb();
        } else if (topic2id[topic].id === null) {
            topic2id[topic].message = message;
            // still looking for id
            if (adapter.config.debug) adapter.log.debug('Server received (but in process) "' + topic + '" (' + typeof message + '): ' + message);
            if (cb) cb();
        } else {
            if (topic2id[topic].message !== undefined) delete topic2id[topic].message;

            processTopic(topic2id[topic].id, topic, message, qos, retain, isAck, null, client, cb);
        }
    }

    function clientClose(client, reason) {
        if (!client) return;

        if (client._sendOnStart) {
           clearTimeout(client._sendOnStart);
           client._sendOnStart = null;
        }
        if (client._resendonStart) {
            clearTimeout(client._resendonStart);
            client._resendonStart = null;
        }

        try {
            if (clients[client.id] && (client.timestamp === clients[client.id].timestamp)) {
                adapter.log.info('Client [' + client.id + '] ' + reason);
                delete clients[client.id];
                updateClients();
                if (client._will) {
                    receivedTopic(client._will, client, () => client.destroy());
                } else {
                    client.destroy();
                }
            } else {
                client.destroy();
            }
        } catch (e) {
            adapter.log.warn('Cannot close client: ' + e);
        }
    }

    function startServer(config, socket, server, port, bind, ssl, ws) {
        socket.on('connection', stream => {
            let client;
            if (ws) {
                client = mqtt(wsStream(stream));
            } else {
                client = mqtt(stream);
            }

            client.on('connect', options => {
                // set client id
                client.id = options.clientId;
                // store unique timestamp with each client
                client.timestamp = new Date().getTime();
                client.cleanSession = options.cleanSession;

                // get possible old client
                let oldClient = clients[client.id];

                if (config.user) {
                    if (config.user !== options.username ||
                        config.pass !== (options.password || '').toString()) {
                        adapter.log.warn('Client [' + options.clientId + '] has invalid password(' + options.password + ') or username(' + options.username + ')');
                        client.connack({returnCode: 4});
                        if (oldClient) {
                            // delete existing client
                            delete clients[client.id];
                            updateClients();
                            oldClient.destroy();
                        }
                        client.destroy();
                        return;
                    }
                }

                if (oldClient) {
                    adapter.log.info('Client [' + client.id + '] reconnected');
                    // need to destroy the old client
                    oldClient.destroy();
                } else {
                    adapter.log.info('Client [' + client.id + '] connected');
                }

                let sessionPresent = false;

                if (!client.cleanSession) {
                    if (persistentSessions[client.id]) {
                        sessionPresent = true;
                    } else {
                        persistentSessions[client.id] = {
                            _subsID: {},
                            _subs: {},
                            messages: []
                        };
                    }
                    client._messages = persistentSessions[client.id].messages;
                } else if (client.cleanSession) {
                    delete persistentSessions[client.id];
                }
                client._messages = client._messages || [];

                client.connack({returnCode: 0, sessionPresent});
                clients[client.id] = client;
                updateClients();

                if (options.will) { //  the client's will message options. object that supports the following properties:
                    // topic:   the will topic. string
                    // payload: the will payload. string
                    // qos:     will qos level. number
                    // retain:  will retain flag. boolean
                    client._will = JSON.parse(JSON.stringify(options.will));
                    let id;
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
                    client._sendOnStart = setTimeout(() => {
                        client._sendOnStart = null;
                        let list = [];
                        // If client still connected
                        for (let id in states) {
                            if (states.hasOwnProperty(id)) {
                                list.push(id);
                            }
                        }
                        sendStates2Client(client, list);
                    }, adapter.config.sendOnStartInterval);
                }

                if (persistentSessions[client.id]) {
                    client._subsID = persistentSessions[client.id]._subsID;
                    client._subs = persistentSessions[client.id]._subs;
                    if (persistentSessions[client.id].messages.length) {
                        // give to the client a little bit time
                        client._resendonStart = setTimeout(() => {
                            client._resendonStart = null;
                            sendMessages2Client(client, persistentSessions[client.id].messages);
                        }, 100);
                    }
                }
            });

            client.on('publish', packet => receivedTopic(packet, client));

            // response for QoS2
            client.on('pubrel', packet => {
                // simulate
                client.pubcomp({
                    messageId: packet.messageId
                });

                // remove this message from queue
                const message = client._messages.find(e => e.messageId === packet.messageId);

                if (message) {
                    const pos = client._messages.indexOf(message);
                    client._messages.splice(pos, 1);
                } else {
                    adapter.log.warn('Received pubrel for unknown message ID: ' + packet.messageId);
                }
            });

            client.on('subscribe', packet => {
                const granted = [];
                if (!client._subsID) client._subsID = {};
                if (!client._subs)   client._subs = {};

                for (let i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);

                    const topic  = packet.subscriptions[i].topic;
                    let id;

                    if (topic2id[topic]) {
                        id = topic2id[topic].id || convertTopic2id(topic, false, config.prefix, adapter.namespace);
                    } else {
                        id = convertTopic2id(topic, false, config.prefix, adapter.namespace);
                    }

                    if (!id) {
                        adapter.log.error('Invalid topic: ' + topic);
                        continue;
                    }

                    // if pattern without wildcards
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
                        let pattern = topic.replace(/\//g, '.');
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
                            for (const savedId in states) {
                                if (states.hasOwnProperty(savedId) && checkPattern(client._subs, savedId)) {
                                    sendState2Client(client, savedId, states[savedId]);
                                }
                            }
                        }
                    }
                }

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('pingreq', (/*packet*/) => {
                if (clients[client.id] && (client.timestamp === clients[client.id].timestamp)) {
                    adapter.log.debug('Client [' + client.id + '] pingreq');
                    client.pingresp();
                } else {
                    adapter.log.info('Received pingreq from disconnected client "' + client.id + '"');
                }
            });

            // connection error handling
            client.on('close',      had_error => clientClose(client, had_error ? 'closed because of error' : 'closed'));
            client.on('error',      e  => clientClose(client, e));
            client.on('disconnect', () => clientClose(client, 'disconnected'));

        });
        (server || socket).listen(port, bind, () => {
            adapter.log.info(`Starting MQTT ${ws ? '-WebSocket' : ''}${ssl ? ' (Secure)' : ''}' ${config.user ? 'authenticated ' : ''} server on port ${port}`);
        });
    }

    (function _constructor(config) {
        // create connected object and state
        adapter.getObject('info.connection', (err, obj) => {
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

                adapter.setObject('info.connection', obj, () => updateClients());
            } else {
                updateClients();
            }
        });

        config.port = parseInt(config.port, 10) || 1883;

        if (config.ssl) {
            net = net || require('tls');
            if (config.webSocket) {
                http = http || require('https');
            }
        } else {
            net = net || require('net');
            if (config.webSocket) {
                http = http || require('http');
            }
        }
        server = new net.Server(config.certificates);
        startServer(config, server, null, config.port, config.bind, config.ssl, false);
        if (config.webSocket) {
            http        = http     || require('https');
            ws          = ws       || require('ws');
            wsStream    = wsStream || require('websocket-stream');
            serverForWs = http.createServer(config.certificates);
            serverWs    = new ws.Server({server: serverForWs});

            startServer(config, serverWs, serverForWs, config.port + 1, config.bind, config.ssl, true);
        }
    })(adapter.config);

    return this;
}

module.exports = MQTTServer;
