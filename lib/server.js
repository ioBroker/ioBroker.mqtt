'use strict';

const mqtt            = require('mqtt-connection');
const state2string    = require('./common').state2string;
const convertTopic2id = require('./common').convertTopic2id;
const convertID2topic = require('./common').convertID2topic;
const messageboxRegex = new RegExp('\\.messagebox$');

// todo delete from persistentSessions the sessions and messages after some time

function MQTTServer(adapter, states) {
    if (!(this instanceof MQTTServer)) {
        return new MQTTServer(adapter, states);
    }

    const namespaceRegEx = new RegExp('^' + adapter.namespace.replace('.', '\\.') + '\\.');

    let net;
    let http;
    let ws;
    let wsStream;
    let server      = null;
    let serverWs    = null;
    let serverForWs = null;
    const clients     = {};
    const topic2id    = {};
    const id2topic    = {};
    let messageId   = 1;
    let persistentSessions = {};
    let resending   = false;
    let resendTimer = null;

    adapter.config.sendOnStartInterval = parseInt(adapter.config.sendOnStartInterval, 10) || 2000;
    adapter.config.sendInterval        = parseInt(adapter.config.sendInterval,        10) || 0;

    this.destroy = (cb) => {
        if (resendTimer) {
            clearInterval(resendTimer);
            resendTimer = null;
        }
        persistentSessions = {};
        let tasks = 0;
        let timeout;
        if (cb) {
            timeout = setTimeout(() => {
                timeout = null;
                if (cb) {
                    cb();
                    cb = null;
                }
            }, 2000);
        }
        if (server) {
            tasks++;
            // to release all resources
            server.close(() => {
                console.log('all gone!');
                if (!--tasks && cb) {
                    clearTimeout(timeout);
                    cb();
                    cb = null;
                }
            });
            server = null;
        }

        if (serverForWs) {
            tasks++;
            // to release all resources
            serverForWs.close(() => {
                console.log('all ws gone!');
                if (!--tasks && cb) {
                    clearTimeout(timeout);
                    cb();
                    cb = null;
                }
            });
            serverForWs = null;
        }
        if (!tasks && cb) {
            clearTimeout(timeout);
            cb();
            cb = null;
        }
    };

    this.onMessage = (topic, message) => {
        if (server) {
            setImmediate(() => {
                for (const k in clients) {
                    if (Object.prototype.hasOwnProperty.call(clients, k)) {
                        sendMessage2Client(clients[k], topic, message, adapter.config.defaultQoS, true);
                    }
                }

                /*
                for (let clientId in persistentSessions) {
                    if (persistentSessions.hasOwnProperty(clientId) && !clients[clientId]) {
                        (function (_clientId) {
                            getMqttMessage(persistentSessions[_clientId], id, state, adapter.config.defaultQoS, true, (err, message) => {
                                message && persistentSessions[_clientId].messages.push(message);
                            });
                        })(clientId);
                    }
                }
				*/
            });
        }
    };

    this.onStateChange = (id, state) => {
        adapter.log.debug(`onStateChange ${id}: ${JSON.stringify(state)}`);
        if (server) {
            setImmediate(() => {
                for (const k in clients) {
                    if (Object.prototype.hasOwnProperty.call(clients, k)) {
                        sendState2Client(clients[k], id, state, adapter.config.defaultQoS, true);
                    }
                }
                for (const clientId in persistentSessions) {
                    if (Object.prototype.hasOwnProperty.call(persistentSessions, clientId) && !clients[clientId]) {
                        getMqttMessage(persistentSessions[clientId], id, state, adapter.config.defaultQoS, true, (err, message, persistentClient) => {
                            message && persistentClient && addMessageWithTopicCheck(persistentClient.messages, message);
                        });
                    }
                }
            });
        }
    };

    function updateClients() {
        let text = '';
        if (clients) {
            for (const id in clients) {
                if (Object.prototype.hasOwnProperty.call(clients, id)) {
                    text += (text ? ',' : '') + id;
                }
            }
        }

        adapter.setState('info.connection', {val: text, ack: true});
    }

    function getMqttMessage(client, id, state, qos, retain, cb) {
        if (typeof qos === 'function') {
            cb  = qos;
            qos = undefined;
        }
        if (typeof retain === 'function') {
            cb  = retain;
            retain = undefined;
        }

        if (!id2topic[id]) {
            return adapter.getForeignObject(id, (err, obj) => {
                if (err) {
                    return cb(`Client [${client.id}] Cannot resolve topic name for ID: ${id} (err: ${err})`);
                }
                if (!obj) {
                    return cb(`Client [${client.id}] Cannot resolve topic name for ID: ${id} (object not found)`);
                } else if (!obj._id) {
                    return cb(`Client [${client.id}] Cannot resolve topic name for ID: ${id} (object has no id): ${JSON.stringify(obj)}`);
                } else if (!obj.native || !obj.native.topic) {
                    id2topic[obj._id] = convertID2topic(obj._id, null, adapter.config.prefix, adapter.namespace);
                } else {
                    id2topic[obj._id] = obj.native.topic;
                }
                getMqttMessage(client, obj._id, state, qos, retain, cb);
            });
        }

        // client has subscription for this ID
        let message;
        let topic;
        let pattern;
        if (client._subsID && client._subsID[id]) {
            topic = id2topic[id];
            message = {
                topic: adapter.config.extraSet && state && !state.ack ? topic + '/set' : topic,
                payload: (state ? state2string(state.val) : null),
                qos: client._subsID[id].qos
            };
        }
        else {
            //  Check patterns
            if (client._subs && (pattern = checkPattern(client._subs, id)) !== null) {
                topic = id2topic[id];
                // Cache the value
                client._subsID = client._subsID || {};
                client._subsID[id] = pattern;

                message = {
                    topic: adapter.config.extraSet && state && !state.ack ? topic + '/set' : topic,
                    payload: (state ? state2string(state.val) : null),
                    qos: pattern.qos
                };
            }
        }

        if (message) {
            message = addMessageAttributes(message, {qos: qos, retain: retain});
        }

        cb(null, message, client);
    }

    function getNextMessageId() {
        const id = messageId;

        messageId++;
        if (messageId > 65535) {
            messageId = 1;
        }

        return id;
    }

    function addMessageAttributes(message, attributes) {
        message = Object.assign(message, {
            qos: message.qos === undefined ? attributes.qos : message.qos,
            retain: attributes.retain,
            messageId: getNextMessageId(),
            ts: Date.now(),
            count: 0,
            cmd: 'publish'
        });

        return message;
    }

    function sendMessage2Client(client, topic, payload, qos, retain, cb) {
        const message = addMessageAttributes({topic: topic, payload: payload}, {qos: client._subsID && client._subsID[topic] ? client._subsID[topic].qos : undefined, retain: retain});
        if (message) {
            if (adapter.config.debug) {
                adapter.log.debug(`Client [${client.id}] send to this client "${message.topic}": ${(message.payload !== null ? message.payload : 'deleted')}`);
            }

            client.publish(message);
            if (message.qos > 0) {
                client._messages = client._messages || [];
                client._messages.push(message);
            }
        }
        cb && cb();
    }

    function sendState2Client(client, id, state, qos, retain, cb) {
        if (messageboxRegex.test(id)) return;

        getMqttMessage(client, id, state, qos, retain, (err, message, client) => {
            if (message) {
                if (adapter.config.debug) {
                    adapter.log.debug(`Client [${client.id}] send to this client "${message.topic}": ${(message.payload !== null ? message.payload : 'deleted')}`);
                }
                client.publish(message);
                if (message.qos > 0) {
                    client._messages = client._messages || [];
                    client._messages.push(message);
                }
            }
            cb && cb(id);
        });
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

    function resendMessages2Client(client, messages, i) {
        i = i || 0;
        if (messages && i < messages.length) {
            try {
                messages[i].ts = Date.now();
                messages[i].count++;
                adapter.log.debug(`Client [${client.id}] Resend messages on connect: ${messages[i].topic} = ${messages[i].payload}`);
                if (messages[i].cmd === 'publish') {
                    messages[i].messageId = getNextMessageId();
                    client.publish(messages[i]);
                }
            } catch (e) {
                adapter.log.warn(`Client [${client.id}] Cannot resend message: ${e}`);
            }

            if (adapter.config.sendInterval) {
                setTimeout(() => resendMessages2Client(client, messages, i + 1), adapter.config.sendInterval);
            } else {
                setImmediate(() => resendMessages2Client(client, messages, i + 1));
            }
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
        for (const pattern in patterns) {
            if (Object.prototype.hasOwnProperty.call(patterns, pattern) && patterns[pattern].regex.test(id)) {
                return patterns[pattern];
            }
        }

        return null;
    }

    async function processTopic(id, topic, message, qos, retain, isAck, obj, ignoreClient, cb) {
        // expand old version of objects
        const messageType = typeof message;
        if (obj && namespaceRegEx.test(id) && ((!obj.native || !obj.native.topic) ||
            obj.common && obj.common.type !== messageType)) {
            if (obj.common && obj.common.type !== messageType) {
                // mqtt topics could change types, but log it to communicate user, if type is frequently fluctuating
                adapter.log.info(`Changed type of "${id}" from "${obj.common.type}" to "${messageType}"`);
                obj.common.type = messageType;
            }

            obj.native       = obj.native || {};
            obj.native.topic = topic;
            try {
                await adapter.setForeignObjectAsync(id, obj);
            } catch (e) {
                adapter.log.error(`Could not update object "${id}": ${e.message}`);
            }
        }
        // this is topic from other adapter
        topic2id[topic].id = id;
        id2topic[id]       = topic;

        adapter.config.debug && adapter.log.debug(`Server received "${topic}" (${typeof message}): ${message}`);

        if (message !== undefined) {
            if (typeof message === 'object') {
                adapter.setForeignState(id, message, (err, id) => states[id] = message);
            } else {
                adapter.setForeignState(id, {val: message, ack: isAck}, (err, id) => states[id] = {val: message, ack: isAck});
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
                for (const k in clients) {
                    // if get and set have different topic names, send state to issuing client too.
                    if (!Object.prototype.hasOwnProperty.call(clients, k) || (clients[k] === ignoreClient && !adapter.config.extraSet)) {
                        continue;
                    }
                    sendState2Client(clients[k], id, message, qos, retain, cb);
                }
            });
        }
        // ELSE
        // this will be done indirect. Message will be sent to js-controller and if adapter is subscribed, it gets this message over stateChange

        if (cb) cb();
    }

    function checkObject(id, topic, callback) {
        topic2id[topic] = topic2id[topic] || {id: null};

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

                        adapter.log.debug(`Create object for topic: ${topic}[ID: ${id}]`);
                        adapter.setForeignObject(id, obj, err => {
                            topic2id[topic].id = id;
                            err && adapter.log.error('setForeignObject: ' + err);
                            obj._id = id;
                            callback && callback(err, id, obj);
                        });
                    } else {
                        topic2id[topic].id = obj._id;
                        callback && callback(null, obj._id, obj);
                    }
                });
            } else {
                topic2id[topic].id = obj._id;
                callback && callback(null, obj._id, obj);
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
        let   topic   = packet.topic;
        let   message = packet.payload;
        const qos     = packet.qos;
        const retain  = packet.retain;
        const now     = Date.now();
        let   id;

        if (adapter.config.extraSet) {
            if (packet.topic.match(/\/set$/)) {
                isAck = false;
                packet.topic = packet.topic.substring(0, packet.topic.length - 4);
                topic = packet.topic;
            }
        }

        if (topic2id[topic]) {
            id = topic2id[topic].id || convertTopic2id(topic, false, adapter.config.prefix, adapter.namespace);
        } else {
            id = convertTopic2id(topic, false, adapter.config.prefix, adapter.namespace);
        }

        if (!id) {
            adapter.log.error(`Client [${client.id}] Invalid topic name: ${JSON.stringify(topic)}`);
            if (cb) {
                cb();
                cb = null;
            }
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

            const parts = message.split(',');
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
            adapter.log.warn(`Client [${client.id}] Topic name is too long: ${id.substring(0, 100)}...`);
            if (cb) {
                cb();
                cb = null;
            }
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
                    //    if (!Object.prototype.hasOwnProperty.call(_message, attr)) continue;
                    //    if (attr !== 'val' && attr !== 'ack' && attr !== 'ts' && attr !== 'q' &&
                    //        attr !== 'lc' && attr !== 'comm' && attr !== 'lc') {
                    //        valid = false;
                    //        break;
                    //    }
                    //}
                    //if (valid) message = _message;
                }
            } catch (e) {
                adapter.log.error(`Client [${client.id}] Cannot parse ${message}`);
            }
        }

        if (!topic2id[topic]) {
            checkObject(id, topic, (err, id, obj) => {
                processTopic(id, topic, message, qos, retain, isAck, obj, client);
                if (cb) {
                    cb();
                    cb = null;
                }
            });
        } else if (topic2id[topic].id === null) {
            topic2id[topic].message = message;
            // still looking for id
            if (adapter.config.debug) {
                adapter.log.debug(`Client [${client.id}] Server received (but in process) "${topic}" (${typeof message}): ${message}`);
            }
            if (cb) {
                cb();
                cb = null;
            }
        } else {
            if (topic2id[topic].message !== undefined) {
                delete topic2id[topic].message;
            }

            if (qos) {
                for (const clientId in persistentSessions) {
                    if (Object.prototype.hasOwnProperty.call(persistentSessions, clientId) && clientId !== client.id && !persistentSessions[clientId].connected) {
                        // try to collect this message if client subscribed
                        getMqttMessage(persistentSessions[clientId], id, message, adapter.config.defaultQoS, true, (err, sendMessage, persistentClient) => {
                            // if sendMessage is defined then the message should be delivered because subscribed, but we deliver the original message
                            sendMessage && persistentClient && addMessageWithTopicCheck(persistentClient.messages, {topic, qos, retain, messageId: packet.messageId || sendMessage.messageId, ts: now, payload: message, count: 0, cmd: 'publish'});
                        });
                    }
                }
            }

            processTopic(topic2id[topic].id, topic, message, qos, retain, isAck, null, client, cb);
        }
    }

    function addMessageWithTopicCheck(arr, message) {
        for (let i in arr) {
            if (arr[i].topic === message.topic) {
                // if same topic we do not add a new entry, but pot. update existing of newer
                if (message.ts > arr[i].ts) {
                    arr[i] = message;
                }
                return false;
            }
        }
        arr.push(message);
    }

    function clientClose(client, reason) {
        if (!client) return;

        if (persistentSessions[client.id]) {
            persistentSessions[client.id].connected = false;
        }

        if (client._sendOnStart) {
            clearTimeout(client._sendOnStart);
            client._sendOnStart = null;
        }
        if (client._resendonStart) {
            clearTimeout(client._resendonStart);
            client._resendonStart = null;
        }

        try {
            if (clients[client.id] && (client.__secret === clients[client.id].__secret)) {
                adapter.log.info(`Client [${client.id}] connection closed: ${reason}`);
                delete clients[client.id];
                updateClients();
                if (client._will && reason !== 'disconnected') {
                    receivedTopic(client._will, client,() => client.destroy());
                } else {
                    client.destroy();
                }
            } else {
                client.destroy();
            }
        } catch (e) {
            adapter.log.warn(`Client [${client.id}] Cannot close client: ${e}`);
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

            // Store unique connection identifier
            client.__secret = Date.now() + '_' + Math.round(Math.random() * 10000);

            client.on('connect', options => {
                // set client id
                client.id = options.clientId;
                if (adapter.config.forceCleanSession === 'clean') {
                    client.cleanSession = true;
                } else if (adapter.config.forceCleanSession === 'keep') {
                    client.cleanSession = false;
                } else {
                    client.cleanSession = options.cleanSession === undefined ? options.cleanSession : options.clean;
                }

                client._keepalive = options.keepalive;

                // get possible old client
                const oldClient = clients[client.id];

                if (config.user) {
                    if (config.user !== options.username ||
                        config.pass !== (options.password || '').toString()) {
                        adapter.log.warn(`Client [${client.id}] has invalid password(${options.password}) or username(${options.username})`);
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
                    adapter.log.info(`Client [${client.id}] reconnected. Old secret ${clients[client.id].__secret}. New secret ${client.__secret}`);
                    // need to destroy the old client

                    if (client.__secret !== clients[client.id].__secret) {
                        // it is another socket!!

                        // It was following situation:
                        // - old connection was active
                        // - new connection is on the same TCP
                        // Just forget him
                        // oldClient.destroy();
                    }
                } else {
                    adapter.log.info(`Client [${client.id}] connected with secret ${client.__secret}`);
                }

                let sessionPresent = false;

                if (!client.cleanSession && adapter.config.storeClientsTime !== 0) {
                    if (persistentSessions[client.id]) {
                        sessionPresent = true;
                        persistentSessions[client.id].lastSeen = Date.now();
                    } else {
                        persistentSessions[client.id] = {
                            _subsID: {},
                            _subs: {},
                            messages: [],
                            lastSeen: Date.now()
                        };
                    }
                    client._messages = persistentSessions[client.id].messages || [];
                    persistentSessions[client.id].connected = true;
                } else if (client.cleanSession && persistentSessions[client.id]) {
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

                    //something went wrong while JSON.parse, so payload of last will not handeled correct as buffer
                    client._will.payload = options.will.payload;
                    adapter.log.debug(`Client [${client.id}] with last will ${JSON.stringify(client._will)}`);
                }

                // Send all subscribed variables to client
                if (config.publishAllOnStart) {
                    // Give to client 2 seconds to send subscribe
                    client._sendOnStart = setTimeout(() => {
                        client._sendOnStart = null;
                        const list = [];
                        // If client still connected
                        for (const id in states) {
                            if (Object.prototype.hasOwnProperty.call(states, id)) {
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
                        client._resendonStart = setTimeout(clientId => {
                            client._resendonStart = null;
                            persistentSessions[clientId] && resendMessages2Client(client, persistentSessions[clientId].messages);
                        }, 100, client.id);
                    }
                }

                //set timeout for stream to 1,5 times keepalive [MQTT-3.1.2-24].
                if (!ws && client._keepalive !== 0) {
                    const streamtimeout_sec = 1.5 * client._keepalive;
                    stream.setTimeout(streamtimeout_sec * 1000);

                    adapter.log.debug(`Client [${client.id}] with keepalive ${client._keepalive} set timeout to ${streamtimeout_sec} seconds`);
                }
            });

            client.on('publish', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends publish. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                if (packet.qos === 1) {
                    // send PUBACK to client
                    client.puback({
                        messageId: packet.messageId
                    });
                } else if (packet.qos === 2) {
                    const pack = client._messages && client._messages.find(e => e.messageId === packet.messageId);
                    if (pack) {
                        // duplicate message => ignore
                        adapter.log.warn(`Client [${client.id}] Ignored duplicate message with ID: ${packet.messageId}`);
                        return;
                    } else {
                        packet.ts = Date.now();
                        packet.cmd = 'pubrel';
                        packet.count = 0;
                        client._messages = client._messages || [];
                        client._messages.push(packet);

                        client.pubrec({
                            messageId: packet.messageId
                        });
                        return;
                    }
                }

                receivedTopic(packet, client);
            });

            // response for QoS2
            client.on('pubrec', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends pubrec. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                const frame = client._messages && client._messages.find(e => e.messageId === packet.messageId);
                if (frame) {
                    client.pubrel({
                        messageId: packet.messageId
                    });
                } else {
                    adapter.log.warn(`Client [${client.id}] Received pubrec on ${client.id} for unknown messageId ${packet.messageId}`);
                }
            });

            // response for QoS2
            client.on('pubcomp', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends pubcomp. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages && client._messages.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });
                if (pos !== null) {
                    client._messages.splice(pos, 1);
                } else {
                    adapter.log.warn(`Client [${client.id}] Received pubcomp for unknown message ID: ${packet.messageId}`);
                }
            });

            // response for QoS2
            client.on('pubrel', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends pubrel. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                const frame = client._messages && client._messages.find(e => e.messageId === packet.messageId);
                if (frame) {
                    client.pubcomp({
                        messageId: packet.messageId
                    });
                    receivedTopic(frame, client);
                } else {
                    adapter.log.warn(`Client [${client.id}] Received pubrel on ${client.id} for unknown messageId ${packet.messageId}`);
                }
            });

            // response for QoS1
            client.on('puback', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends puback. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                let pos = null;
                // remove this message from queue
                client._messages && client._messages.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });
                if (pos !== null) {
                    adapter.log.debug(`Client [${client.id}] Received puback for ${client.id} message ID: ${packet.messageId}`);
                    client._messages.splice(pos, 1);
                } else {
                    adapter.log.warn(`Client [${client.id}] Received puback for unknown message ID: ${packet.messageId}`);
                }
            });

            client.on('subscribe', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends subscribe. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                const granted = [];
                client._subsID = client._subsID || {};
                client._subs   = client._subs || {};

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
                        adapter.log.error(`Client [${client.id}] Invalid topic: ${topic}`);
                        continue;
                    }

                    // if pattern without wildcards
                    if (id.indexOf('*') === -1 && id.indexOf('#') === -1 && id.indexOf('+') === -1) {
                        // If state is unknown => create mqtt.X.topic
                        if (!topic2id[topic]) {
                            checkObject(id, topic, (err, id) => {
                                adapter.log.info(`Client [${client.id}] subscribes on topic "${topic}"`);
                                client._subsID[id] = {id, qos: packet.subscriptions[i].qos};
                            });
                        } else {
                            client._subsID[topic2id[topic].id] = {id: topic2id[topic].id, qos: packet.subscriptions[i].qos};
                            adapter.log.info(`Client [${client.id}] subscribes on "${topic2id[topic].id}"`);
                            if (adapter.config.publishOnSubscribe) {
                                setTimeout(() => {
                                    adapter.log.info(`Client [${client.id}] publishOnSubscribe`);
                                    sendState2Client(client, topic2id[topic].id, states[topic2id[topic].id]);
                                }, 200);
                            }
                        }
                    } else {
                        let pattern = topic;
                        // remove prefix
                        if (pattern.startsWith(adapter.config.prefix)) {
                            pattern = pattern.substring(adapter.config.prefix.length);
                        }
                        pattern = pattern.replace(/\//g, '.');
                        if (pattern[0] === '.') pattern = pattern.substring(1);

                        // add simple pattern
                        let regText = pattern2RegEx(pattern);
                        client._subs[topic] = {
                            regex:   new RegExp(regText),
                            qos:     packet.subscriptions[i].qos,
                            pattern: pattern
                        };
                        adapter.log.info(`Client [${client.id}] subscribes on "${topic}" with regex /${regText}/`);

                        // add simple mqtt.0.pattern
                        pattern = adapter.namespace + '/' + pattern;
                        regText = pattern2RegEx(pattern);
                        client._subs[adapter.namespace + '/' + topic] = {
                            regex:   new RegExp(regText),
                            qos:     packet.subscriptions[i].qos,
                            pattern: pattern
                        };
                        adapter.log.info(`Client [${client.id}] subscribes on "${topic}"  with regex /${regText}/`);

                        if (adapter.config.publishOnSubscribe) {
                            setTimeout(() => {
                                adapter.log.info(`Client [${client.id}] publishOnSubscribe send all known states`);
                                for (const savedId in states) {
                                    if (Object.prototype.hasOwnProperty.call(states, savedId) && checkPattern(client._subs, savedId)) {
                                        sendState2Client(client, savedId, states[savedId]);
                                    }
                                }
                            }, 200);
                        }
                    }
                }

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('unsubscribe', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends unsubscribe. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                for (let i = 0; i < packet.unsubscriptions.length; i++) {
                    const topic  = packet.unsubscriptions[i];
                    let id;

                    if (topic2id[topic]) {
                        id = topic2id[topic].id || convertTopic2id(topic, false, config.prefix, adapter.namespace);
                    } else {
                        id = convertTopic2id(topic, false, config.prefix, adapter.namespace);
                    }

                    if (!id) {
                        adapter.log.error(`Client [${client.id}] unsubscribes from invalid topic: ${topic}`);
                        continue;
                    }

                    // if pattern without wildcards
                    if (id.indexOf('*') === -1 && id.indexOf('#') === -1 && id.indexOf('+') === -1) {
                        // If state is known
                        if (topic2id[topic]) {
                            const _id = topic2id[topic].id;
                            if (client._subsID && client._subsID[_id]) {
                                delete client._subsID[_id];
                                adapter.log.info(`Client [${client.id}] unsubscribes on "${_id}"`);
                            } else {
                                adapter.log.info(`Client [${client.id}] unsubscribes on unknown "${_id}"`);
                            }
                        } else {
                            adapter.log.info(`Client [${client.id}] unsubscribes on unknown topic "${topic}"`);
                        }
                    } else {
                        let pattern = topic.replace(/\//g, '.');
                        if (pattern[0] === '.') pattern = pattern.substring(1);

                        // add simple pattern
                        if (client._subs && client._subs[topic]) {
                            adapter.log.info(`Client [${client.id}] unsubscribes on "${topic}"`);
                            delete client._subs[topic];
                            if (client._subs[adapter.namespace + '/' + topic]) {// add simple mqtt.0.pattern
                                delete client._subs[adapter.namespace + '/' + topic];
                                adapter.log.info(`Client [${client.id}] unsubscribes on "${adapter.namespace}/${topic}"`);
                            }
                        } else {
                            adapter.log.warn(`Client [${client.id}] unsubscribes on unknown "${topic}"`);
                        }
                    }
                }
                client.unsuback({messageId: packet.messageId});
            });

            client.on('pingreq', (/*packet*/) => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    return adapter.log.debug(`Old client ${client.id} with secret ${client.__secret} sends pingreq. Ignore! Actual secret is ${clients[client.id].__secret}`);
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                adapter.log.debug(`Client [${client.id}]  pingreq`);
                client.pingresp();
            });

            // connection error handling
            client.on('close',      had_error => clientClose(client, had_error ? 'closed because of error' : 'closed'));
            client.on('error',      e  => clientClose(client, e));
            client.on('disconnect', () => clientClose(client, 'disconnected'));

            // client lost without close
            stream.on('timeout', () => clientClose(client, 'timeout'));

        });
        (server || socket).listen(port, bind, () =>
            adapter.log.info(`Starting MQTT${ws ? '-WebSocket' : ''}${ssl ? ' (Secure)' : ''}${config.user ? ' authenticated' : ''} server on ${bind || '0.0.0.0'}:${port}`)).on('error', err => adapter.log.error(`Error starting MQTT${ws ? '-WebSocket' : ''}${ssl ? ' (Secure)' : ''}${config.user ? ' authenticated' : ''} server on ${bind || '0.0.0.0'}:${port}: ${err}`));
    }

    function checkResends() {
        const now = Date.now();
        resending = true;
        for (const clientId in clients) {
            if (Object.prototype.hasOwnProperty.call(clients, clientId) && clients[clientId] && clients[clientId]._messages) {
                for (let m = clients[clientId]._messages.length - 1; m >= 0; m--) {
                    const message = clients[clientId]._messages[m];
                    if (now - message.ts >= adapter.config.retransmitInterval) {
                        if (message.count > adapter.config.retransmitCount) {
                            adapter.log.warn(`Client [${clientId}] Message ${message.messageId} deleted after ${message.count} retries`);
                            clients[clientId]._messages.splice(m, 1);
                            continue;
                        }

                        // resend this message
                        message.count++;
                        message.ts = now;
                        try {
                            adapter.log.debug(`Client [${clientId}] Resend message topic: ${message.topic}, payload: ${message.payload}`);
                            if (message.cmd === 'publish') {
                                clients[clientId].publish(message);
                            }
                        } catch (e) {
                            adapter.log.warn(`Client [${clientId}] Cannot publish message: ${e}`);
                        }

                        if (adapter.config.sendInterval) {
                            setTimeout(checkResends, adapter.config.sendInterval);
                        } else {
                            setImmediate(checkResends);
                        }
                        return;
                    }
                }
            }
        }

        // delete old sessions
        if (adapter.config.storeClientsTime !== -1) {
            Object.keys(persistentSessions).forEach(id => {
                if (now - persistentSessions[id].lastSeen > adapter.config.storeClientsTime * 60000) {
                    delete persistentSessions[id];
                }
            });
        }

        resending = false;
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
        if (config.port < 0 || config.port > 65535) {
            adapter.log.error(`Port ${config.port} is invalid, using 1883.`);
            config.port = 1883;
        }
        config.retransmitInterval = config.retransmitInterval || 2000;
        config.retransmitCount = config.retransmitCount || 10;
        if (config.storeClientsTime === undefined) {
            config.storeClientsTime = 1440;
        } else {
            config.storeClientsTime = parseInt(config.storeClientsTime, 10) || 0;
        }

        config.defaultQoS = parseInt(config.defaultQoS, 10) || 0;

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

        try {
            server = new net.Server(config.certificates);
        } catch (err) {
            adapter.log.error(`Cannot create server: ${err}`);
            adapter.terminate ? adapter.terminate(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        server.on('error', err => {
            adapter.log.error(`Cannot create server: ${err}`);
            adapter.terminate ? adapter.terminate(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
        });

        try {
            startServer(config, server, null, config.port, config.bind, config.ssl, false);
        } catch (err) {
            adapter.log.error(`Cannot create server: ${err}`);
            adapter.terminate ? adapter.terminate(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        if (config.webSocket) {
            http        = http     || require('https');
            ws          = ws       || require('ws');
            wsStream    = wsStream || require('websocket-stream');
            serverForWs = http.createServer(config.certificates);
            serverWs    = new ws.Server({server: serverForWs});

            try {
                startServer(config, serverWs, serverForWs, config.port + 1, config.bind, config.ssl, true);
            } catch (err) {
                adapter.log.error(`Cannot create server: ${err}`);
                adapter.terminate ? adapter.terminate(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(adapter.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                return;
            }
        }

        resendTimer = setInterval(() =>
            !resending && checkResends(), adapter.config.retransmitInterval || 2000);

    })(adapter.config);

    return this;
}

module.exports = MQTTServer;
