import { EXIT_CODES } from '@iobroker/adapter-core';
import type { MqttAdapterConfig, MqttPattern, MqttTopic } from './types';
// @ts-expect-error no types
import mqtt from 'mqtt-connection';
import {
    state2string,
    convertTopic2id,
    convertID2topic,
    ensureObjectStructure,
    isIgnoredTopic,
    pattern2RegEx,
    convertMessage,
} from './common';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { createServer as createTlsServer, type Server as TlsServer } from 'tls';
import { createServer as createNetServer, type Server as NetServer } from 'net';
import { Server as WsServer } from 'ws';
import wsStream from 'websocket-stream';

// todo delete from persistentSessions the sessions and messages after some time
type HttpHttpsServer = HttpsServer | HttpServer;
type Server = TlsServer | NetServer;
type MqttMessage = {
    topic: string;
    payload: string | null;
    qos: 0 | 1 | 2;
    retain: boolean;
    messageId: number;
    ts?: number;
    count?: number;
    cmd?: 'pubreq' | 'publish' | 'pubrel';
    dup?: boolean;
    binary?: boolean;
};

interface PersistentSession {
    id: string;
    _subsID?: {
        [id: string]: {
            regex: RegExp;
            qos: 0 | 1 | 2;
            pattern: MqttPattern;
        };
    };
    _subs?: {
        [topic: string]: {
            regex: RegExp;
            qos: 0 | 1 | 2;
            pattern: MqttPattern;
        };
    };
    _messages: MqttMessage[];
    connected?: boolean;
    lastSeen: number;
}

interface MqttConnection {
    id: string;
    stream: any;
    _messages: MqttMessage[];
    _sendOnStart?: NodeJS.Timeout | null;
    _resendonStart?: NodeJS.Timeout | null;
    __secret?: string;
    _will: {
        topic: string;
        payload: string;
        qos: 0 | 1 | 2;
        retain: boolean;
    };
    destroy: () => void;
    _subsID?: {
        [id: string]: {
            regex: RegExp;
            qos: 0 | 1 | 2;
            pattern: MqttPattern;
        };
    };
    _subs?: {
        [topic: string]: {
            regex: RegExp;
            qos: 0 | 1 | 2;
            pattern: MqttPattern;
        };
    };
    cleanSession?: boolean;
    _keepalive: number;
    authenticated?: boolean;

    publish: (message: MqttMessage) => void;
    pubrec: (message: { messageId: number }) => void;
    connack: (message: { returnCode: number; sessionPresent?: boolean }) => void;
    puback: (message: { messageId: number }) => void;
    unsuback: (message: { messageId: number }) => void;
    pingresp: () => void;
    suback: (message: { messageId: number; granted: number[] }) => void;
    pubrel: (message: { messageId: number }) => void;
    pubcomp: (message: { messageId: number }) => void;
    on(
        event:
            | 'publish'
            | 'connect'
            | 'pubrec'
            | 'pubcomp'
            | 'pubrel'
            | 'puback'
            | 'subscribe'
            | 'unsubscribe'
            | 'close'
            | 'disconnect'
            | 'error'
            | 'pingreq',
        callback: (message: any) => void,
    ): void;
}

const messageboxRegex = new RegExp('\\.messagebox$');

export default class MQTTServer {
    private readonly adapter: ioBroker.Adapter;
    private readonly config: MqttAdapterConfig;
    private readonly namespaceRegEx: RegExp;
    private server: Server | null = null;
    private serverWs: WsServer | null = null;
    private serverForWs: HttpHttpsServer | null = null;
    private readonly clients: { [clientID: string]: MqttConnection } = {};
    private readonly topic2id: Record<
        MqttTopic,
        {
            processing?: boolean;
            obj: ioBroker.StateObject | null;
            id: string;
            isAck?: boolean;
            message?: ioBroker.StateValue | ioBroker.State;
        }
    > = {};
    private readonly id2topic: Record<string, MqttTopic> = {};
    private messageId = 1;
    private persistentSessions: {
        [clientId: string]: PersistentSession;
    } = {};
    private resending = false;
    private resendTimer: NodeJS.Timeout | null = null;
    private readonly verifiedObjects = {};
    private channelChecked = false;
    private updateClientsTimeout: NodeJS.Timeout | null = null;
    private updateClientsRunning = false;
    private updateClientsRestart = false;

    private readonly ignoredTopicsRegexes: RegExp[] = [];
    private readonly ignoredTopics: string[] = [];
    private readonly states: Record<string, ioBroker.State>;

    constructor(adapter: ioBroker.Adapter, states: Record<string, ioBroker.State>) {
        this.adapter = adapter;
        this.config = adapter.config as MqttAdapterConfig;
        this.namespaceRegEx = new RegExp(`^${this.adapter.namespace.replace('.', '\\.')}\\.`);
        this.ignoredTopics = this.config.ignoredTopics?.split(',') ?? [];
        this.states = states;

        for (const ignoredTopicPattern of this.ignoredTopics) {
            if (!ignoredTopicPattern) {
                // Empty strings would filter out all topics, which is probably not what the user wants
                this.ignoredTopics.length > 1 && this.adapter.log.warn(`Ignored topics should not end with an ",".`);
                continue;
            }
            const ignoredTopicRegexWithNameSpace = pattern2RegEx(
                `${this.adapter.namespace}.${ignoredTopicPattern}`,
                adapter,
            );
            const ignoredTopicRegex = pattern2RegEx(ignoredTopicPattern, adapter);
            this.adapter.log.info(
                `Ignoring topic with pattern: ${ignoredTopicPattern} (RegExp: ${ignoredTopicRegex} und ${ignoredTopicRegexWithNameSpace})`,
            );
            this.ignoredTopicsRegexes.push(new RegExp(ignoredTopicRegex), new RegExp(ignoredTopicRegexWithNameSpace));
        }
        this.config.sendOnStartInterval = parseInt(this.config.sendOnStartInterval as unknown as string, 10) || 2000;
        this.config.sendInterval = parseInt(this.config.sendInterval as unknown as string, 10) || 0;
        this.init();
    }

    destroy(cb?: () => void): void {
        if (this.resendTimer) {
            clearInterval(this.resendTimer);
            this.resendTimer = null;
        }
        this.persistentSessions = {};

        let tasks = 0;
        let timeout: NodeJS.Timeout | null = null;
        if (cb) {
            timeout = setTimeout(() => {
                timeout = null;
                if (cb) {
                    cb();
                    cb = undefined;
                }
            }, 2000);
        }
        if (this.server) {
            tasks++;
            // to release all resources
            this.server.close(() => {
                console.log('all gone!');
                if (!--tasks && cb) {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = null;
                    }
                    cb();
                    cb = undefined;
                }
            });
            this.server = null;
        }

        if (this.serverForWs) {
            tasks++;
            // to release all resources
            this.serverForWs.close(() => {
                console.log('all ws gone!');
                if (!--tasks && cb) {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = null;
                    }
                    cb();
                    cb = undefined;
                }
            });
            this.serverForWs = null;
        }
        if (!tasks && cb) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            cb();
            cb = undefined;
        }
    }

    onMessage(topic: MqttTopic, message: any, retain: boolean, binary?: boolean): void {
        if (this.server) {
            setImmediate(() => {
                for (const k in this.clients) {
                    if (Object.prototype.hasOwnProperty.call(this.clients, k)) {
                        this.sendMessage2Client(this.clients[k], topic, message, retain ?? this.config.retain, binary);
                    }
                }

                /*
                for (let clientId in persistentSessions) {
                    if (persistentSessions.hasOwnProperty(clientId) && !this.clients[clientId]) {
                        (function (_clientId) {
                            getMqttMessage(persistentSessions[_clientId], id, state, this.config.defaultQoS, true, (err, message) => {
                                message && persistentSessions[_clientId]._messages.push(message);
                            });
                        })(clientId);
                    }
                }
                */
            });
        }
    }

    onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        this.adapter.log.debug(`onStateChange ${id}: ${JSON.stringify(state)}`);

        if (!this.server) {
            return;
        }

        setImmediate(() => {
            Object.keys(this.clients).forEach(k =>
                this.sendState2Client(this.clients[k], id, state, this.config.defaultQoS, !this.config.noRetain),
            );

            Object.keys(this.persistentSessions).forEach(clientId => {
                if (!this.clients[clientId]) {
                    this.getMqttMessage<PersistentSession>(
                        this.persistentSessions[clientId],
                        id,
                        state,
                        this.config.defaultQoS,
                        !this.config.noRetain,
                        (err, message, persistentClient) =>
                            message &&
                            persistentClient &&
                            this.addMessageWithTopicCheck(persistentClient._messages, message),
                    );
                }
            });
        });
    }

    private async updateClientObjects(): Promise<void> {
        if (this.config.doNotCreateClientObjects) {
            return;
        }
        if (this.updateClientsRunning) {
            this.updateClientsRestart = true;
            return;
        }
        this.updateClientsRunning = true;
        const clientIds = [];

        if (this.clients) {
            for (const id in this.clients) {
                const _id = id || this.clients[id].id || this.clients[id].stream.remoteAddress;
                const oid = `info.clients.${_id.replace(/[.\s]+/g, '_')}`;
                clientIds.push(oid);
                const clientObj = await this.adapter.getObjectAsync(oid);
                if (!clientObj?.native) {
                    await this.adapter.setObject(oid, {
                        type: 'state',
                        common: {
                            name: _id,
                            role: 'indicator.reachable',
                            type: 'boolean',
                            read: true,
                            write: false,
                        },
                        native: {
                            ip: this.clients[id].stream.remoteAddress,
                            port: this.clients[id].stream.remotePort,
                        },
                    });
                } else if (
                    clientObj.native.port !== this.clients[id].stream.remotePort ||
                    clientObj.native.ip !== this.clients[id].stream.remoteAddress
                ) {
                    clientObj.native.port = this.clients[id].stream.remotePort;
                    clientObj.native.ip = this.clients[id].stream.remoteAddress;
                    await this.adapter.setObjectAsync(clientObj._id, clientObj);
                }
                await this.adapter.setStateAsync(oid, true, true);
            }
        }

        // read all other states and set alive to false
        const allStates = await this.adapter.getStatesAsync('info.clients.*');
        for (const id in allStates) {
            if (!clientIds.includes(id.replace(`${this.adapter.namespace}.`, ''))) {
                await this.adapter.setState(id, false, true);
            }
        }

        this.updateClientsRunning = false;
        if (this.updateClientsRestart) {
            this.updateClientsRestart = false;
            this.startUpdateClientObjects();
        }
    }

    private startUpdateClientObjects(): void {
        if (this.updateClientsTimeout) {
            clearTimeout(this.updateClientsTimeout);
            this.updateClientsTimeout = null;
        }
        this.updateClientsTimeout = setTimeout(() => {
            this.updateClientObjects().catch(e => this.adapter.log.error(`Cannot update client objects: ${e}`));
        }, 1000);
    }

    private updateClients(): void {
        this.startUpdateClientObjects();

        void this.adapter.setState('info.connection', {
            val: this.clients ? Object.keys(this.clients).join(', ') : '',
            ack: true,
        });
    }

    private getMqttMessage<
        T extends {
            id: string;
            _subsID?: {
                [id: string]: {
                    regex: RegExp;
                    qos: 0 | 1 | 2;
                    pattern: MqttPattern;
                };
            };
            _subs?: {
                [topic: string]: {
                    regex: RegExp;
                    qos: 0 | 1 | 2;
                    pattern: MqttPattern;
                };
            };
        },
    >(
        client: T,
        id: string,
        state: ioBroker.State | undefined | null,
        qos: 0 | 1 | 2 | undefined,
        retain: boolean | undefined,
        cb: (err: string | null, message?: MqttMessage, client?: T) => void,
    ): void {
        if (!this.id2topic[id]) {
            void this.adapter.getForeignObject(id, (err, obj) => {
                if (err) {
                    cb(`Client [${client.id}] Cannot resolve topic name for ID: ${id} (err: ${err})`);
                    return;
                }
                if (!obj) {
                    cb(`Client [${client.id}] Cannot resolve topic name for ID: ${id} (object not found)`);
                    return;
                }
                if (!obj._id) {
                    cb(
                        `Client [${client.id}] Cannot resolve topic name for ID: ${id} (object has no id): ${JSON.stringify(obj)}`,
                    );
                    return;
                }
                if (!obj.native?.topic) {
                    this.id2topic[obj._id] = convertID2topic(
                        obj._id,
                        null,
                        this.config.prefix,
                        this.adapter.namespace,
                        this.config.removePrefix,
                    );
                } else {
                    this.id2topic[obj._id] = obj.native.topic;
                }

                const topic = this.id2topic[obj._id];
                obj.common ||= {} as ioBroker.StateCommon;

                this.topic2id[topic] ||= { obj: obj as ioBroker.StateObject, id: obj._id };

                void this.getMqttMessage<T>(client, obj._id, state, qos, retain, cb);
            });
            return;
        }

        // client has subscription for this ID
        let message: MqttMessage | undefined;
        let topic;
        let pattern;

        if (client._subsID?.[id]) {
            topic = this.id2topic[id];

            let payload: null | string;
            if (!state) {
                payload = null;
            } else {
                payload = state2string(state.val);
            }

            message = {
                topic: this.config.extraSet && state && !state.ack ? `${topic}/set` : topic,
                payload,
                qos: client._subsID[id].qos,
                retain: false,
                ts: Date.now(),
                count: 0,
                messageId: 0,
            };
        } else {
            //  Check patterns
            if (client._subs && (pattern = this.checkPattern(client._subs, id)) !== null) {
                topic = this.id2topic[id];
                // Cache the value
                client._subsID ||= {};
                client._subsID[id] = pattern;

                let payload;
                if (!state) {
                    payload = null;
                } else {
                    payload = state2string(state.val);
                }

                message = {
                    topic: this.config.extraSet && state && !state.ack ? `${topic}/set` : topic,
                    payload,
                    qos: pattern.qos,
                    retain: false,
                    ts: Date.now(),
                    count: 0,
                    messageId: 0,
                };
            }
        }

        if (message) {
            message = this.addMessageAttributes(message, {
                qos: qos ?? this.config.defaultQoS,
                retain: retain ?? false,
            });
        }

        cb(null, message, client);
    }

    private getNextMessageId(): number {
        const id = this.messageId;

        this.messageId++;
        if (this.messageId > 65535) {
            this.messageId = 1;
        }

        return id;
    }

    private addMessageAttributes(
        message: MqttMessage,
        attributes: {
            qos: 0 | 1 | 2;
            retain: boolean;
            binary?: boolean;
        },
    ): MqttMessage {
        return {
            ...message,
            qos: message.qos ?? attributes.qos,
            retain: attributes.retain,
            messageId: this.messageId,
            ts: Date.now(),
            count: 0,
            binary: attributes.binary,
            cmd: 'publish',
        };
    }

    private sendMessage2Client(
        client: MqttConnection,
        topic: MqttTopic,
        payload: ioBroker.State | ioBroker.StateValue,
        retain: boolean,
        binary?: boolean,
    ): void {
        const message = this.addMessageAttributes(
            {
                topic,
                payload: state2string(payload),
                binary,
                retain,
                ts: Date.now(),
                count: 0,
                qos: client._subsID?.[topic]?.qos ?? 0,
                messageId: 0,
            },
            { qos: client._subsID?.[topic]?.qos ?? 0, retain },
        );

        if (this.config.debug) {
            this.adapter.log.debug(
                `Client [${client.id}] send to this client "${message.topic}" (retain: ${message.retain}): ${message.payload !== 'null' ? message.payload : 'deleted'}`,
            );
        }

        client.publish(message);

        if (message.qos > 0) {
            client._messages ||= [];
            client._messages.push(message);
        }
    }

    private sendState2Client(
        client: MqttConnection,
        id: string,
        state: ioBroker.State | null | undefined,
        qos?: 0 | 1 | 2,
        retain?: boolean,
        cb?: (id: string) => void,
    ): void {
        if (messageboxRegex.test(id)) {
            return;
        }

        this.getMqttMessage<MqttConnection>(client, id, state, qos, retain, (err, message, client) => {
            if (message) {
                if (this.config.debug) {
                    this.adapter.log.debug(
                        `Client [${client!.id}] send to this client "${message.topic}": ${message.payload !== null ? message.payload : 'deleted'}`,
                    );
                }

                client!.publish(message);

                if (message.qos > 0) {
                    client!._messages ||= [];
                    client!._messages.push(message);
                }
            }

            cb?.(id);
        });
    }

    private sendStates2Client(client: MqttConnection, list: string[]): void {
        if (list?.length) {
            const id = list.shift() || '';
            this.sendState2Client(client, id, this.states[id], 0, !this.config.noRetain, () =>
                setTimeout(() => this.sendStates2Client(client, list), this.config.sendInterval),
            );
        } else {
            //return;
        }
    }

    private resendMessages2Client(client: MqttConnection, messages: MqttMessage[], i?: number): void {
        i ||= 0;
        if (messages && i < messages.length) {
            try {
                messages[i].ts = Date.now();
                messages[i].count ||= 0;
                messages[i].count!++;
                this.adapter.log.debug(
                    `Client [${client.id}] Resend messages on connect: ${messages[i].topic} and id ${messages[i].messageId} (${messages[i].cmd}) = ${messages[i].payload}`,
                );
                if (messages[i].cmd === 'publish') {
                    messages[i].messageId = this.getNextMessageId();
                    client.publish(messages[i]);
                }
            } catch (e) {
                this.adapter.log.warn(`Client [${client.id}] Cannot resend message: ${e as Error}`);
            }

            if (this.config.sendInterval) {
                setTimeout(() => this.resendMessages2Client(client, messages, i + 1), this.config.sendInterval);
            } else {
                setImmediate(() => this.resendMessages2Client(client, messages, i + 1));
            }
        } else {
            // return;
        }
    }

    /*
     4.7.1.2 Multi-level wildcard

     The number sign (‘#’ U+0023) is a wildcard character that matches any number of levels within a topic. The multi-level wildcard represents the parent and any number of child levels. The multi-level wildcard character MUST be specified either on its own or following a topic level separator. In either case it MUST be the last character specified in the Topic Filter [MQTT-4.7.1-2].

     Non-normative comment,
     For example, if a Client subscribes to “sport/tennis/player1/#”, it would receive messages published using these topic names:
     ·         “sport/tennis/player1”
     ·         “sport/tennis/player1/ranking”
     ·         “sport/tennis/player1/score/wimbledon”

     Non-normative comment
     ·         “sport/#” also matches the singular “sport”, since # includes the parent level.
     ·         “#” is valid and will receive every Application Message
     ·         “sport/tennis/#” is valid
     ·         “sport/tennis#” is not valid
     ·         “sport/tennis/#/ranking” is not valid

     */
    private checkPattern(
        patterns: {
            [topic: string]: {
                regex: RegExp;
                qos: 0 | 1 | 2;
                pattern: MqttPattern;
            };
        },
        id: string,
    ): {
        regex: RegExp;
        qos: 0 | 1 | 2;
        pattern: MqttPattern;
    } | null {
        const pattern = Object.keys(patterns).find(p => patterns[p].regex.test(id));

        return pattern ? patterns[pattern] : null;
    }

    private async processTopic(
        id: string,
        topic: MqttTopic,
        message: ioBroker.State | ioBroker.StateValue | null | undefined,
        qos: 0 | 1 | 2,
        retain: boolean,
        isAck: boolean,
        ignoreClient: MqttConnection,
    ): Promise<void> {
        if (id === `${this.adapter.namespace}.info.connection`) {
            this.adapter.log.debug(`Ignore State update for ${id} because adapter internal state.`);
            return;
        }

        // expand an old version of objects
        let messageType = typeof message;
        let stateType: ioBroker.CommonType = Array.isArray(message)
            ? 'array'
            : messageType === 'string' ||
                messageType === 'number' ||
                messageType === 'boolean' ||
                messageType === 'object'
              ? messageType
              : 'mixed';

        // if it is a State
        if (typeof message === 'object' && message !== null && message.val !== undefined) {
            messageType = typeof message.val;
            stateType = Array.isArray(message.val)
                ? 'array'
                : messageType === 'string' ||
                    messageType === 'number' ||
                    messageType === 'boolean' ||
                    messageType === 'object'
                  ? messageType
                  : 'mixed';
        }

        // update a type of state if necessary
        const obj = this.topic2id[topic].obj;
        if (
            obj &&
            this.namespaceRegEx.test(id) &&
            (!obj.native?.topic || (obj.common && obj.common.type !== 'mixed' && obj.common.type !== stateType))
        ) {
            if (obj.common && obj.common.type !== 'mixed' && obj.common.type !== stateType) {
                // mqtt topics could change types, but log it to communicate to the user if a type is frequently fluctuating
                this.adapter.log.info(`Server: Changed type of "${id}" from "${obj.common.type}" to "${stateType}"`);
                obj.common.type = stateType;
            }

            obj.native ||= {};
            obj.native.topic = topic;
            try {
                await this.adapter.setForeignObject(id, obj);
            } catch (e) {
                this.adapter.log.error(`Could not update object "${id}": ${(e as Error).message}`);
            }
        }

        if (this.config.debug) {
            this.adapter.log.debug(`Server received "${topic}" (${typeof message}): ${JSON.stringify(message)}`);
        }

        if (message !== undefined && message !== null) {
            let value: ioBroker.State;
            if (typeof message === 'object') {
                value = message;
            } else {
                value = { val: message, ack: isAck } as ioBroker.State;
            }
            if (
                value.val !== undefined &&
                value.val !== null &&
                this.namespaceRegEx.test(this.topic2id[topic].id) &&
                this.topic2id[topic].obj?.common &&
                this.topic2id[topic].obj.common.type !== 'mixed' &&
                this.topic2id[topic].obj.common.type !== typeof value.val
            ) {
                this.adapter.log.info(
                    `Server: Changed type of "${this.topic2id[topic].id}" from "${this.topic2id[topic].obj.common.type}" to "mixed"`,
                );
                try {
                    await this.adapter.extendObject(this.topic2id[topic].id, { common: { type: 'mixed' } });
                } catch (err) {
                    this.adapter.log.warn(
                        `Error while updating object "${this.topic2id[topic].id}" for Server: ${err as Error}`,
                    );
                }
                this.topic2id[topic].obj.common.type = 'mixed';
            }
            try {
                await this.adapter.setForeignStateAsync(id, value);
            } catch {
                // ignore
            }

            this.states[id] = value;
        } else {
            this.states[id] = { val: null, ack: isAck } as ioBroker.State;
        }

        // send a message to all other clients
        if (this.config.onchange && this.server && message !== undefined && message !== null) {
            setImmediate(() => {
                let state: ioBroker.State;
                if (typeof message !== 'object') {
                    state = { val: message } as ioBroker.State;
                } else {
                    state = message;
                }

                Object.keys(this.clients).forEach(k => {
                    // if 'get' and 'set' have different topic names, send state to issuing a client too.
                    if (this.clients[k] !== ignoreClient || this.config.extraSet) {
                        this.sendState2Client(this.clients[k], id, state, qos, retain);
                    }
                });
            });
        }
        // ELSE
        // this will be done indirect. The message will be sent to js-controller, and if adapter is subscribed, it gets this message over stateChange
    }

    private async checkObject(id: string, topic: MqttTopic, message?: string | null): Promise<void> {
        if (isIgnoredTopic(id, this.ignoredTopicsRegexes)) {
            return;
        }
        this.topic2id[topic] ||= {
            id: '',
            obj: { _id: '', common: {} as ioBroker.StateCommon, native: {}, type: 'state' },
            processing: true,
        };

        if (this.config.debug) {
            this.adapter.log.debug(`Check object for topic "${topic}"`);
        }

        let obj: ioBroker.Object | undefined | null = null;
        try {
            obj = await this.adapter.getObjectAsync(id);
        } catch {
            // ignore
        }

        if (
            obj?._id?.startsWith(`${this.adapter.namespace}.`) &&
            obj.type === 'folder' &&
            obj.native?.autocreated === 'by automatic ensure logic'
        ) {
            // ignore a default created object because we now have a more defined one
            obj = null;
        }

        if (!obj) {
            try {
                obj = await this.adapter.getForeignObjectAsync(id);
            } catch {
                // ignore
            }
            if (
                obj?._id?.startsWith(`${this.adapter.namespace}.`) &&
                obj.type === 'folder' &&
                obj.native?.autocreated === 'by automatic ensure logic'
            ) {
                // ignore a default created object because we now have a more defined one
                obj = null;
            }

            if (!obj) {
                id = `${this.adapter.namespace}.${id}`;

                if (this.config.ignoreNewObjects) {
                    this.adapter.log.warn(`Object ${id} ignored and not created`);
                    throw new Error(`Object ${id} not exists`);
                }

                // only for type detection
                const parsedMessage = convertMessage(topic, message, this.adapter);
                const messageType = typeof parsedMessage;
                const stateType = Array.isArray(parsedMessage)
                    ? 'array'
                    : messageType === 'string' ||
                        messageType === 'number' ||
                        messageType === 'boolean' ||
                        messageType === 'object'
                      ? messageType
                      : 'mixed';

                // create state
                obj = {
                    _id: id,
                    common: {
                        name: topic,
                        write: true,
                        read: true,
                        role: 'variable',
                        desc: 'mqtt server variable',
                        type: stateType,
                    },
                    native: {
                        topic,
                    },
                    type: 'state',
                };
                if (typeof parsedMessage === 'object' && parsedMessage?.val !== undefined) {
                    const messageType = typeof parsedMessage.val;
                    obj.common.type = Array.isArray(parsedMessage.val)
                        ? 'array'
                        : messageType === 'string' ||
                            messageType === 'number' ||
                            messageType === 'boolean' ||
                            messageType === 'object'
                          ? messageType
                          : 'mixed';
                }

                this.adapter.log.debug(`Create object for topic: ${topic}[ID: ${id}]`);
                try {
                    await this.adapter.setForeignObject(id, obj);
                } catch {
                    // ignore
                }
            } else if (this.config.debug) {
                this.adapter.log.debug(`    Found object for topic "${topic}" = ${obj._id}`);
            }
        } else if (this.config.debug) {
            this.adapter.log.debug(`    Found object for topic "${topic}" = ${obj._id}`);
        }

        if (obj && !obj._id) {
            obj._id = id;
        }

        const stateObj: ioBroker.StateObject = obj as ioBroker.StateObject;

        this.topic2id[topic].id = stateObj._id;
        this.topic2id[topic].obj = stateObj;
        this.topic2id[topic].processing = false;

        // do not wait the finish of the function
        ensureObjectStructure(this.adapter, stateObj._id, this.verifiedObjects).catch(e => this.adapter.log.error(e));
    }

    private async receivedTopic(packet: MqttMessage, client: MqttConnection): Promise<void> {
        let isAck = true;
        let topic = packet.topic;
        const message = packet.payload;
        const qos = packet.qos;
        const retain = packet.retain;
        const now = Date.now();
        let id;

        if (this.config.extraSet && packet.topic.match(/\/set$/)) {
            isAck = false;
            packet.topic = packet.topic.substring(0, packet.topic.length - 4);
            topic = packet.topic;
        }

        if (this.topic2id[topic]) {
            id = this.topic2id[topic].id || convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);
        } else {
            id = convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);
        }

        if (!id) {
            this.adapter.log.error(`Client [${client.id}] Invalid topic name: ${JSON.stringify(topic)}`);
            return;
        }
        if (isIgnoredTopic(id, this.ignoredTopicsRegexes)) {
            return;
        }

        // If state is unknown => create mqtt.X.topic
        if (`${this.adapter.namespace}.${id}`.length > this.config.maxTopicLength) {
            this.adapter.log.warn(`Client [${client.id}] Topic name is too long: ${id.substring(0, 100)}...`);
            return;
        }

        if (!this.topic2id[topic]) {
            try {
                await this.checkObject(id, topic, message);
            } catch {
                return;
            }
        } else if (this.topic2id[topic].processing) {
            // still looking for id
            this.topic2id[topic].message = convertMessage(topic, message, this.adapter) as
                | ioBroker.StateValue
                | ioBroker.State;
            if (this.config.debug) {
                this.adapter.log.debug(
                    `Client [${client.id}] Server received (but in process) "${topic}" (${typeof message}): ${message}`,
                );
            }
            return;
        }

        let parsedMessage: ioBroker.StateValue | ioBroker.State;

        if (this.topic2id[topic].message) {
            // get last received message
            parsedMessage = this.topic2id[topic].message!;
            delete this.topic2id[topic].message;
        } else if (this.topic2id[topic].obj) {
            parsedMessage = convertMessage(topic, message, this.adapter, client.id) as
                | ioBroker.StateValue
                | ioBroker.State;
        }

        if (qos) {
            Object.keys(this.persistentSessions).forEach(clientId => {
                if (clientId !== client.id && !this.persistentSessions[clientId].connected) {
                    const state =
                        parsedMessage !== null && typeof parsedMessage === 'object'
                            ? parsedMessage
                            : ({ val: parsedMessage, ack: isAck } as ioBroker.State);

                    // try to collect this message if a client subscribed
                    this.getMqttMessage<PersistentSession>(
                        this.persistentSessions[clientId],
                        id,
                        state,
                        this.config.defaultQoS,
                        true,
                        (err, sendMessage, persistentClient) =>
                            // if sendMessage is defined, then the message should be delivered because subscribed, but we deliver the original message
                            sendMessage &&
                            persistentClient &&
                            this.addMessageWithTopicCheck(persistentClient._messages, {
                                topic,
                                qos,
                                retain,
                                messageId: packet.messageId || sendMessage.messageId,
                                ts: now,
                                payload: message,
                                count: 0,
                                cmd: 'publish',
                            }),
                    );
                }
            });
        }

        await this.processTopic(this.topic2id[topic].id, topic, message, qos, retain, isAck, client);
    }

    private addMessageWithTopicCheck(arr: MqttMessage[], message: MqttMessage): void {
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].topic === message.topic) {
                // if same topic we do not add a new entry, but pot. update existing of newer
                if (message.ts! > arr[i].ts!) {
                    arr[i] = message;
                }
                return;
            }
        }
        arr.push(message);
    }

    private clientClose(client: MqttConnection, reason?: string): void {
        if (!client) {
            return;
        }

        if (this.persistentSessions[client.id]) {
            this.persistentSessions[client.id].connected = false;
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
            if (this.clients[client.id] && client.__secret === this.clients[client.id].__secret) {
                this.adapter.log.info(`Client [${client.id}] connection closed: ${reason}`);
                delete this.clients[client.id];
                this.updateClients();
                if (client._will && reason !== 'disconnected') {
                    void this.receivedTopic({ ...client._will, messageId: 0 }, client)
                        .catch(() => null) // ignore
                        .then(() => client.destroy());
                } else {
                    client.destroy();
                }
            } else {
                client.destroy();
            }
        } catch (e) {
            this.adapter.log.warn(`Client [${client.id}] Cannot close client: ${e as Error}`);
        }
    }

    private validateRequest(
        type: 'publish' | 'pubrec' | 'pubcomp' | 'pubrel' | 'subscribe' | 'unsubscribe' | 'pingreq' | 'puback',
        client: MqttConnection,
    ): boolean {
        if (this.config.user && !client.authenticated) {
            this.adapter.log.warn(`Client [${client.id}] sends ${type} after unsuccessful authentication. Ignore!`);
            return false;
        }

        if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
            this.adapter.log.debug(
                `Old client ${client.id} with secret ${client.__secret} sends ${type}. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
            );
            return false;
        }

        return true;
    }

    private startServer(
        socket: Server | WsServer,
        server: HttpHttpsServer | null,
        port: number,
        bind: string,
        ssl: boolean,
        ws: boolean,
    ): void {
        // Event variable to hold a connection event type
        let connectionEvent: 'secureConnection' | 'connection';

        // Check if SSL/TLS connection is required
        if (this.config.ssl) {
            // Set event variable to SSL/TLS connection
            connectionEvent = 'secureConnection';
        } else {
            // Set event variable to plain TCP connection
            connectionEvent = 'connection';
        }

        // Use event variable to start the connection
        socket.on(connectionEvent, (stream: any) => {
            let client: MqttConnection;
            if (ws) {
                client = mqtt(wsStream(stream));
            } else {
                client = mqtt(stream);
            }

            // Store unique connection identifier
            client.__secret = `${Date.now()}_${Math.round(Math.random() * 10000)}`;

            client.on(
                'connect',
                (options: {
                    clientId: string;
                    cleanSession?: boolean;
                    clean?: boolean;
                    keepalive: number;
                    username?: string;
                    password?: string;
                    will?: {
                        topic: string;
                        payload: string;
                        qos: 0 | 1 | 2;
                        retain: boolean;
                    };
                }): void => {
                    // set client id
                    client.id = options.clientId;
                    if (this.config.forceCleanSession === 'clean') {
                        client.cleanSession = true;
                    } else if (this.config.forceCleanSession === 'keep') {
                        client.cleanSession = false;
                    } else {
                        // The old logic always resulted in 'undefined' when cleanSession was not active,
                        // because options.cleanSession was undefined. This led to client.cleanSession being set to undefined.
                        // client.cleanSession = options.cleanSession === undefined ? options.cleanSession : options.clean;

                        // The improved logic below should be better:
                        client.cleanSession = options.cleanSession !== undefined ? options.cleanSession : options.clean;
                    }

                    client._keepalive = options.keepalive;

                    // get possible an old client
                    const oldClient = this.clients[client.id];

                    if (this.config.user) {
                        if (
                            this.config.user !== options.username ||
                            this.config.pass !== (options.password || '').toString()
                        ) {
                            this.adapter.log.warn(
                                `Client [${client.id}] has invalid password(${options.password}) or username(${options.username})`,
                            );
                            client.authenticated = false;
                            client.connack({ returnCode: 4 });
                            if (oldClient) {
                                // delete existing client
                                delete this.clients[client.id];
                                this.updateClients();
                                oldClient.destroy();
                            }
                            client.destroy();
                            return;
                        }
                        client.authenticated = true;
                    }

                    if (oldClient) {
                        this.adapter.log.info(
                            `Client [${client.id}] reconnected. Old secret ${this.clients[client.id].__secret}. New secret ${client.__secret}`,
                        );
                        // need to destroy the old client

                        if (client.__secret !== this.clients[client.id].__secret) {
                            // it is another socket!!
                            // It was following situation:
                            // - old connection was active
                            // - new connection is on the same TCP
                            // Just forget him
                            // oldClient.destroy();
                        }
                    } else {
                        this.adapter.log.info(`Client [${client.id}] connected with secret ${client.__secret}`);
                    }

                    let sessionPresent = false;

                    if (!client.cleanSession && this.config.storeClientsTime !== 0) {
                        if (this.persistentSessions[client.id]) {
                            sessionPresent = true;
                            this.persistentSessions[client.id].lastSeen = Date.now();
                        } else {
                            this.persistentSessions[client.id] = {
                                id: client.id,
                                _subsID: {},
                                _subs: {},
                                _messages: [],
                                lastSeen: Date.now(),
                            };
                        }
                        client._messages = this.persistentSessions[client.id]._messages || [];
                        this.persistentSessions[client.id].connected = true;
                    } else if (client.cleanSession && this.persistentSessions[client.id]) {
                        delete this.persistentSessions[client.id];
                    }
                    client._messages ||= [];

                    client.connack({ returnCode: 0, sessionPresent });
                    this.clients[client.id] = client;
                    this.updateClients();

                    if (options.will) {
                        // the client's will message options. object that supports the following properties:
                        // topic:   the will topic. string
                        // payload: the will payload. string
                        // qos:     will qos level. number
                        // retain:  will retain flag. boolean
                        client._will = JSON.parse(JSON.stringify(options.will));
                        let id;
                        if (this.topic2id[client._will.topic]) {
                            id =
                                this.topic2id[client._will.topic].id ||
                                convertTopic2id(client._will.topic, false, this.config.prefix, this.adapter.namespace);
                        } else {
                            id = convertTopic2id(client._will.topic, false, this.config.prefix, this.adapter.namespace);
                        }
                        this.checkObject(id, client._will.topic, options.will.payload)
                            .then(() => {
                                // something went wrong while JSON.parse, so the payload of last will not be handled correct as buffer
                                client._will.payload = options.will!.payload;
                                this.adapter.log.debug(
                                    `Client [${client.id}] with last will ${JSON.stringify(client._will)}`,
                                );
                            })
                            .catch(err => this.adapter.log.info(err.message));
                    }

                    // Send all subscribed variables to a client
                    if (this.config.publishAllOnStart) {
                        // Give to client 2 seconds to send the `subscribe` message
                        client._sendOnStart = setTimeout(() => {
                            client._sendOnStart = null;
                            this.sendStates2Client(client, Object.keys(this.states));
                        }, this.config.sendOnStartInterval);
                    }

                    if (this.persistentSessions[client.id]) {
                        client._subsID = this.persistentSessions[client.id]._subsID;
                        client._subs = this.persistentSessions[client.id]._subs;
                        if (this.persistentSessions[client.id]._messages.length) {
                            // give to the client a little bit time
                            client._resendonStart = setTimeout(
                                (clientId: string): void => {
                                    client._resendonStart = null;
                                    if (this.persistentSessions[clientId]) {
                                        this.resendMessages2Client(client, this.persistentSessions[clientId]._messages);
                                    }
                                },
                                100,
                                client.id,
                            );
                        }
                    }

                    // set timeout for stream to 1,5 times keepalive [MQTT-3.1.2-24].
                    if (!ws && client._keepalive !== 0) {
                        const streamTimeoutSec = 1.5 * client._keepalive;
                        stream.setTimeout(streamTimeoutSec * 1000);

                        this.adapter.log.debug(
                            `Client [${client.id}] with keepalive ${client._keepalive} set timeout to ${streamTimeoutSec} seconds`,
                        );
                    }
                },
            );

            // only when we are the RECEIVER of the message
            client.on(
                'publish',
                async (packet: {
                    messageId: number;
                    qos: 0 | 1 | 2;
                    ts: number;
                    cmd: 'pubrel';
                    count: number;
                    topic: string;
                    payload: string;
                    retain: boolean;
                }): Promise<void> => {
                    if (!this.validateRequest('publish', client)) {
                        return;
                    }

                    if (this.config.debug) {
                        this.adapter.log.debug(
                            `Client [${client.id}] received publish package ${JSON.stringify(packet)}`,
                        );
                    }

                    if (this.persistentSessions[client.id]) {
                        this.persistentSessions[client.id].lastSeen = Date.now();
                    }

                    if (packet.qos === 1) {
                        // send PUBACK to a client
                        client.puback({ messageId: packet.messageId });
                    } else if (packet.qos === 2) {
                        const pack = client._messages?.find(e => e.messageId === packet.messageId);
                        if (pack) {
                            // duplicate message => ignore
                            this.adapter.log.info(
                                `Client [${client.id}] Ignored duplicate message with ID: ${packet.messageId}`,
                            );
                            return;
                        }
                        packet.ts = Date.now();
                        packet.cmd = 'pubrel';
                        packet.count = 0;
                        client._messages ||= [];
                        client._messages.push(packet);

                        client.pubrec({ messageId: packet.messageId });
                        return;
                    }

                    await this.receivedTopic(packet, client);
                },
            );

            // response for QoS2
            // only when we are the SENDER of the message
            client.on(
                'pubrec',
                (packet: {
                    messageId: number;
                    topic: MqttTopic;
                    payload: string | Buffer;
                    qos: 0 | 1 | 2;
                    retain: boolean;
                }) => {
                    if (!this.validateRequest('pubrec', client)) {
                        return;
                    }

                    if (this.config.debug) {
                        this.adapter.log.debug(
                            `Client [${client.id}] received pubrec package ${JSON.stringify(packet)}`,
                        );
                    }

                    if (this.persistentSessions[client.id]) {
                        this.persistentSessions[client.id].lastSeen = Date.now();
                    }

                    // remove this message from queue
                    const frame = client._messages?.find(e => e.messageId === packet.messageId);
                    if (frame) {
                        client.pubrel({ messageId: packet.messageId });
                    } else {
                        this.adapter.log.info(
                            `Client [${client.id}] Received pubrec on ${client.id} for unknown messageId ${packet.messageId}`,
                        );
                    }
                },
            );

            // response for QoS2
            // only when we are the SENDER of the message
            client.on('pubcomp', (packet: { messageId: number }): void => {
                if (!this.validateRequest('pubcomp', client)) {
                    return;
                }

                if (this.config.debug) {
                    this.adapter.log.debug(`Client [${client.id}] received pubcomp package ${JSON.stringify(packet)}`);
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = -1;
                // remove this message from queue
                if (client._messages) {
                    pos = client._messages.findIndex(e => e.messageId === packet.messageId);
                }
                if (pos !== -1) {
                    client._messages.splice(pos, 1);
                } else {
                    this.adapter.log.info(
                        `Client [${client.id}] Received pubcomp for unknown message ID: ${packet.messageId}`,
                    );
                }
            });

            // response for QoS2
            // only when we are the RECEIVER of the message
            client.on('pubrel', async (packet: { messageId: number }): Promise<void> => {
                if (!this.validateRequest('pubrel', client)) {
                    return;
                }

                if (this.config.debug) {
                    this.adapter.log.debug(`Client [${client.id}] received pubrel package ${JSON.stringify(packet)}`);
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                let pos = -1;
                // remove this message from queue
                if (client._messages) {
                    pos = client._messages.findIndex(e => e.messageId === packet.messageId);
                }
                if (pos !== -1) {
                    client.pubcomp({ messageId: packet.messageId });
                    await this.receivedTopic(client._messages[pos], client);
                    client._messages.splice(pos, 1);
                } else {
                    this.adapter.log.info(
                        `Client [${client.id}] Received pubrel for unknown message ID: ${packet.messageId}`,
                    );
                }
            });

            // response for QoS1
            client.on('puback', (packet: { messageId: number }): void => {
                if (!this.validateRequest('puback', client)) {
                    return;
                }

                if (this.config.debug) {
                    this.adapter.log.debug(`Client [${client.id}] received puback package ${JSON.stringify(packet)}`);
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                let pos = -1;
                // remove this message from queue
                if (client._messages) {
                    pos = client._messages.findIndex(e => e.messageId === packet.messageId);
                }
                if (pos !== -1) {
                    this.adapter.log.debug(
                        `Client [${client.id}] Received puback for ${client.id} message ID: ${packet.messageId}`,
                    );
                    client._messages.splice(pos, 1);
                } else {
                    this.adapter.log.info(
                        `Client [${client.id}] Received puback for unknown message ID: ${packet.messageId}`,
                    );
                }
            });

            client.on(
                'subscribe',
                async (packet: {
                    messageId: number;
                    subscriptions: { qos: 0 | 1 | 2; topic: MqttTopic }[];
                }): Promise<void> => {
                    if (!this.validateRequest('subscribe', client)) {
                        return;
                    }

                    if (this.config.debug) {
                        this.adapter.log.debug(
                            `Client [${client.id}] received subscribe package ${JSON.stringify(packet)}`,
                        );
                    }

                    if (this.persistentSessions[client.id]) {
                        this.persistentSessions[client.id].lastSeen = Date.now();
                    }

                    const granted = [];
                    client._subsID ||= {};
                    client._subs ||= {};

                    for (let i = 0; i < packet.subscriptions.length; i++) {
                        this.adapter.log.debug(
                            `Client [${client.id}] Handle subscribe: ${JSON.stringify(packet.subscriptions[i])}`,
                        );
                        granted.push(packet.subscriptions[i].qos);

                        const topic = packet.subscriptions[i].topic;
                        let id;

                        if (this.topic2id[topic]) {
                            id =
                                this.topic2id[topic].id ||
                                convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);
                        } else {
                            id = convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);
                        }

                        if (!id) {
                            this.adapter.log.error(`Client [${client.id}] Invalid topic: ${topic}`);
                            continue;
                        }

                        // if pattern without wildcards
                        if (!id.includes('*') && !id.includes('#') && !id.includes('+')) {
                            // If state is unknown => create mqtt.X.topic
                            if (!this.topic2id[topic]) {
                                try {
                                    await this.checkObject(id, topic);
                                } catch {
                                    return;
                                }
                            }

                            client._subsID[this.topic2id[topic].id] = {
                                pattern: id,
                                regex: new RegExp(pattern2RegEx(id, this.adapter)),
                                qos: packet.subscriptions[i].qos,
                            };

                            this.adapter.log.info(`Client [${client.id}] subscribes on "${this.topic2id[topic].id}"`);

                            if (this.config.publishOnSubscribe) {
                                setTimeout(() => {
                                    this.adapter.log.info(`Client [${client.id}] publishOnSubscribe`);
                                    this.sendState2Client(
                                        client,
                                        this.topic2id[topic].id,
                                        this.states[this.topic2id[topic].id],
                                    );
                                }, 200);
                            }
                        } else {
                            let pattern = topic;
                            // remove prefix
                            if (pattern.startsWith(this.config.prefix)) {
                                pattern = pattern.substring(this.config.prefix.length);
                            }
                            pattern = pattern.replace(/\//g, '.');
                            if (pattern[0] === '.') {
                                pattern = pattern.substring(1);
                            }

                            // add a simple pattern
                            let regText = pattern2RegEx(pattern, this.adapter);
                            client._subs[topic] = {
                                regex: new RegExp(regText),
                                qos: packet.subscriptions[i].qos,
                                pattern: pattern,
                            };
                            this.adapter.log.info(
                                `Client [${client.id}] subscribes on "${topic}" with regex /${regText}/`,
                            );

                            // add simple mqtt.0.pattern
                            pattern = `${this.adapter.namespace}/${pattern}`;
                            regText = pattern2RegEx(pattern, this.adapter);
                            client._subs[`${this.adapter.namespace}/${topic}`] = {
                                regex: new RegExp(regText),
                                qos: packet.subscriptions[i].qos,
                                pattern,
                            };
                            this.adapter.log.info(
                                `Client [${client.id}] subscribes on "${topic}"  with regex /${regText}/`,
                            );

                            if (this.config.publishOnSubscribe) {
                                setTimeout(() => {
                                    this.adapter.log.info(
                                        `Client [${client.id}] publishOnSubscribe send all known states`,
                                    );
                                    Object.keys(this.states).forEach(savedId => {
                                        if (this.checkPattern(client._subs!, savedId)) {
                                            this.sendState2Client(client, savedId, this.states[savedId]);
                                        }
                                    });
                                }, 200);
                            }
                        }
                    }

                    client.suback({ granted, messageId: packet.messageId });
                },
            );

            client.on('unsubscribe', (packet: { messageId: number; unsubscriptions: MqttTopic[] }): void => {
                if (!this.validateRequest('unsubscribe', client)) {
                    return;
                }

                if (this.config.debug) {
                    this.adapter.log.debug(
                        `Client [${client.id}] received unsubscribe package ${JSON.stringify(packet)}`,
                    );
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                for (let i = 0; i < packet.unsubscriptions.length; i++) {
                    const topic = packet.unsubscriptions[i];
                    let id;

                    if (this.topic2id[topic]) {
                        id =
                            this.topic2id[topic].id ||
                            convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);
                    } else {
                        id = convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);
                    }

                    if (!id) {
                        this.adapter.log.error(`Client [${client.id}] unsubscribes from invalid topic: ${topic}`);
                        continue;
                    }

                    // if pattern without wildcards
                    if (!id.includes('*') && !id.includes('#') && !id.includes('+')) {
                        // If the state is known
                        if (this.topic2id[topic]) {
                            const _id = this.topic2id[topic].id;
                            if (client._subsID?.[_id]) {
                                delete client._subsID[_id];
                                this.adapter.log.info(`Client [${client.id}] unsubscribes on "${_id}"`);
                            } else {
                                this.adapter.log.info(`Client [${client.id}] unsubscribes on unknown "${_id}"`);
                            }
                        } else {
                            this.adapter.log.info(`Client [${client.id}] unsubscribes on unknown topic "${topic}"`);
                        }
                    } else {
                        let pattern = topic.replace(/\//g, '.');
                        if (pattern[0] === '.') {
                            pattern = pattern.substring(1);
                        }

                        // add a simple pattern
                        if (client._subs?.[topic]) {
                            this.adapter.log.info(`Client [${client.id}] unsubscribes on "${topic}"`);
                            delete client._subs[topic];
                            if (client._subs[`${this.adapter.namespace}/${topic}`]) {
                                // add simple mqtt.0.pattern
                                delete client._subs[`${this.adapter.namespace}/${topic}`];
                                this.adapter.log.info(
                                    `Client [${client.id}] unsubscribes on "${this.adapter.namespace}/${topic}"`,
                                );
                            }
                        } else {
                            this.adapter.log.info(`Client [${client.id}] unsubscribes on unknown "${topic}"`);
                        }
                    }
                }
                client.unsuback({ messageId: packet.messageId });
            });

            client.on('pingreq', (/*packet*/) => {
                if (!this.validateRequest('pingreq', client)) {
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                this.adapter.log.debug(`Client [${client.id}] pingreq`);
                client.pingresp();
            });

            // connection error handling
            client.on('close', (hadError?: boolean) =>
                this.clientClose(client, hadError ? 'closed because of error' : 'closed'),
            );
            client.on('error', (e: Error) => this.clientClose(client, e.toString()));
            client.on('disconnect', () => this.clientClose(client, 'disconnected'));

            // client lost without a close
            stream.on('timeout', () => this.clientClose(client, 'timeout'));
        });

        (server || (socket as Server))
            .listen(port, bind, () => {
                this.adapter.log.info(
                    `Starting MQTT${ws ? '-WebSocket' : ''}${ssl ? ' (Secure)' : ''}${this.config.user ? ' authenticated' : ''} server on ${bind || '0.0.0.0'}:${port}`,
                );
                this.adapter.log.debug(`The MQTT server${ws ? ' (WebSocket)' : ''} has successfully started!`);
            })
            .on('error', (err: Error): void =>
                this.adapter.log.error(
                    `Error starting MQTT (Setting up listener)${ws ? '-WebSocket' : ''}${ssl ? ' (Secure)' : ''}${this.config.user ? ' authenticated' : ''} server on ${bind || '0.0.0.0'}:${port}: ${err}`,
                ),
            );
    }

    private checkResends(): void {
        const now = Date.now();
        this.resending = true;
        for (const clientId in this.clients) {
            if (Object.prototype.hasOwnProperty.call(this.clients, clientId) && this.clients[clientId]?._messages) {
                for (let m = this.clients[clientId]._messages.length - 1; m >= 0; m--) {
                    const message = this.clients[clientId]._messages[m];
                    if (now - message.ts! >= this.config.retransmitInterval) {
                        if (message.count! > this.config.retransmitCount) {
                            this.adapter.log.warn(
                                `Client [${clientId}] Message ${message.messageId} deleted after ${message.count} retries`,
                            );
                            this.clients[clientId]._messages.splice(m, 1);
                            continue;
                        }

                        // resend this message
                        message.count!++;
                        message.ts = now;
                        try {
                            this.adapter.log.debug(
                                `Client [${clientId}] Resend for ${message.cmd} message topic: ${message.topic}, payload: ${message.payload}`,
                            );
                            if (message.cmd === 'publish') {
                                message.dup = true;
                                this.clients[clientId].publish(message);
                            } else if (message.cmd === 'pubrel') {
                                this.clients[clientId].pubrec({
                                    messageId: message.messageId,
                                });
                            }
                        } catch (e) {
                            this.adapter.log.warn(`Client [${clientId}] Cannot publish message: ${e as Error}`);
                        }

                        if (this.config.sendInterval) {
                            setTimeout(this.checkResends, this.config.sendInterval);
                        } else {
                            setImmediate(this.checkResends);
                        }
                        return;
                    }
                }
            }
        }

        // delete old sessions
        if (this.config.storeClientsTime !== -1) {
            Object.keys(this.persistentSessions).forEach(id => {
                if (
                    !this.persistentSessions[id] ||
                    now - this.persistentSessions[id].lastSeen > this.config.storeClientsTime * 60000
                ) {
                    delete this.persistentSessions[id];
                }
            });
        }

        this.resending = false;
    }

    private init(): void {
        // create a connected object and state
        this.adapter.getObject('info.connection', (err, obj) => {
            if (!obj?.common || obj.common.type !== 'string') {
                obj = {
                    _id: 'info.connection',
                    type: 'state',
                    common: {
                        role: 'info.clients',
                        name: {
                            en: 'List of connected clients',
                            de: 'Liste der verbundenen Clients',
                            ru: 'Список подключенных клиентов',
                            it: 'Elenco dei client connessi',
                            es: 'Lista de clientes conectados',
                            pt: 'Lista de clientes conectados',
                            nl: 'Lijst van verbonden clients',
                            fr: 'Liste des clients connectés',
                            pl: 'Lista podłączonych klientów',
                            uk: 'Список підключених клієнтів',
                            'zh-cn': '已连接客户端的列表',
                        },
                        type: 'string',
                        read: true,
                        write: false,
                        def: '',
                    },
                    native: {},
                };

                this.adapter.setObject('info.connection', obj, () => this.updateClients());
            } else {
                this.updateClients();
            }
        });

        this.config.port = parseInt(this.config.port as unknown as string, 10) || 1883;
        if (this.config.port < 0 || this.config.port > 65535) {
            this.adapter.log.error(`Port ${this.config.port} is invalid, using 1883.`);
            this.config.port = 1883;
        }
        this.config.retransmitInterval ||= 2000;
        this.config.retransmitCount ||= 10;
        if (this.config.storeClientsTime === undefined) {
            this.config.storeClientsTime = 1440;
        } else {
            this.config.storeClientsTime = parseInt(this.config.storeClientsTime as unknown as string, 10) || 0;
        }

        try {
            // If using MQTTs, then create a TLS server with tls.createServer(), it's better for the TLS handshake.
            // Otherwise, the server may not send MQTT-CONNACK, and protocol handling could fail.
            this.server = this.config.ssl ? createTlsServer(this.config.certificates!) : createNetServer();
        } catch (err) {
            this.adapter.log.error(`Cannot create server: ${err as Error}`);
            this.adapter.terminate
                ? this.adapter.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }

        this.server.on('error', (err: Error): void => {
            this.adapter.log.error(`Cannot create server: ${err}`);
            this.adapter.terminate
                ? this.adapter.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
        });

        try {
            this.adapter.log.debug(`The MQTT server is starting now...`);
            this.startServer(this.server, null, this.config.port, this.config.bind, this.config.ssl, false);
        } catch (err) {
            this.adapter.log.error(`Cannot create server: ${err as Error}`);
            this.adapter.terminate
                ? this.adapter.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        if (this.config.webSocket) {
            this.serverForWs = this.config.ssl ? createHttpsServer(this.config.certificates!) : createHttpServer();
            this.serverWs = new WsServer({ server: this.serverForWs });

            try {
                this.adapter.log.debug(`The MQTT server (Websocket) is starting now...`);
                this.startServer(
                    this.serverWs,
                    this.serverForWs,
                    this.config.port + 1,
                    this.config.bind,
                    this.config.ssl,
                    true,
                );
            } catch (err) {
                this.adapter.log.error(`Cannot create server: ${err as Error}`);
                this.adapter.terminate
                    ? this.adapter.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                    : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                return;
            }
        }

        this.resendTimer = setInterval(
            () => !this.resending && this.checkResends(),
            this.config.retransmitInterval || 2000,
        );
    }
}
