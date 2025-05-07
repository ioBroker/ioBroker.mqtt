import { connect, type MqttClient, type IClientOptions } from 'mqtt';
import { readFileSync } from 'node:fs'; // Load the built-in Node.js file system module
import {
    state2string,
    convertTopic2id,
    convertID2topic,
    ensureObjectStructure,
    isIgnoredTopic,
    pattern2RegEx,
    convertMessage,
} from './common';
import type { MqttAdapterConfig, MqttTopic } from './types';

const messageboxRegex = new RegExp('\\.messagebox$');

const invalidChars =
    // eslint-disable-next-line no-control-regex, no-misleading-character-class
    /[\x00-\x1F\x7F-\x9F\xAD\u0378\u0379\u037F-\u0383\u038B\u038D\u03A2\u0528-\u0530\u0557\u0558\u0560\u0588\u058B-\u058E\u0590\u05C8-\u05CF\u05EB-\u05EF\u05F5-\u0605\u061C\u061D\u06DD\u070E\u070F\u074B\u074C\u07B2-\u07BF\u07FB-\u07FF\u082E\u082F\u083F\u085C\u085D\u085F-\u089F\u08A1\u08AD-\u08E3\u08FF\u0978\u0980\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09FC-\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF2-\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B55\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B78-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BFB-\u0C00\u0C04\u0C0D\u0C11\u0C29\u0C34\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5A-\u0C5F\u0C64\u0C65\u0C70-\u0C77\u0C80\u0C81\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0D01\u0D04\u0D0D\u0D11\u0D3B\u0D3C\u0D45\u0D49\u0D4F-\u0D56\u0D58-\u0D5F\u0D64\u0D65\u0D76-\u0D78\u0D80\u0D81\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DF1\u0DF5-\u0E00\u0E3B-\u0E3E\u0E5C-\u0E80\u0E83\u0E85\u0E86\u0E89\u0E8B\u0E8C\u0E8E-\u0E93\u0E98\u0EA0\u0EA4\u0EA6\u0EA8\u0EA9\u0EAC\u0EBA\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F48\u0F6D-\u0F70\u0F98\u0FBD\u0FCD\u0FDB-\u0FFF\u10C6\u10C8-\u10CC\u10CE\u10CF\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u137D-\u137F\u139A-\u139F\u13F5-\u13FF\u169D-\u169F\u16F1-\u16FF\u170D\u1715-\u171F\u1737-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17DE\u17DF\u17EA-\u17EF\u17FA-\u17FF\u180F\u181A-\u181F\u1878-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191D-\u191F\u192C-\u192F\u193C-\u193F\u1941-\u1943\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DB-\u19DD\u1A1C\u1A1D\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1A9F\u1AAE-\u1AFF\u1B4C-\u1B4F\u1B7D-\u1B7F\u1BF4-\u1BFB\u1C38-\u1C3A\u1C4A-\u1C4C\u1C80-\u1CBF\u1CC8-\u1CCF\u1CF7-\u1CFF\u1DE7-\u1DFB\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FC5\u1FD4\u1FD5\u1FDC\u1FF0\u1FF1\u1FF5\u1FFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2072\u2073\u208F\u209D-\u209F\u20BB-\u20CF\u20F1-\u20FF\u218A-\u218F\u23F4-\u23FF\u2427-\u243F\u244B-\u245F\u2700\u2B4D-\u2B4F\u2B5A-\u2BFF\u2C2F\u2C5F\u2CF4-\u2CF8\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D71-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E3C-\u2E7F\u2E9A\u2EF4-\u2EFF\u2FD6-\u2FEF\u2FFC-\u2FFF\u3040\u3097\u3098\u3100-\u3104\u312E-\u3130\u318F\u31BB-\u31BF\u31E4-\u31EF\u321F\u32FF\u4DB6-\u4DBF\u9FCD-\u9FFF\uA48D-\uA48F\uA4C7-\uA4CF\uA62C-\uA63F\uA698-\uA69E\uA6F8-\uA6FF\uA78F\uA794-\uA79F\uA7AB-\uA7F7\uA82C-\uA82F\uA83A-\uA83F\uA878-\uA87F\uA8C5-\uA8CD\uA8DA-\uA8DF\uA8FC-\uA8FF\uA954-\uA95E\uA97D-\uA97F\uA9CE\uA9DA-\uA9DD\uA9E0-\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A\uAA5B\uAA7C-\uAA7F\uAAC3-\uAADA\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F-\uABBF\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBC2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFE\uFDFF\uFE1A-\uFE1F\uFE27-\uFE2F\uFE53\uFE67\uFE6C-\uFE6F\uFE75\uFEFD-\uFF00\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFDF\uFFE7\uFFEF-\uFFFB\uFFFE\uFFFF]/g;

export default class MQTTClient {
    private client: MqttClient | null = null;
    private readonly topic2id: Record<
        MqttTopic,
        {
            processing?: boolean;
            obj: ioBroker.StateObject | null;
            id: string;
            isAck?: boolean;
            message?: number | string | boolean | Record<string, any>;
        }
    > = {};
    private readonly id2topic: Record<string, MqttTopic> = {};
    private readonly namespaceRegEx: RegExp;
    private connected = false;
    private readonly verifiedObjects = {};

    private readonly ignoredTopicsRegexes: RegExp[] = [];
    private readonly ignoredTopics: string[];
    private readonly adapter: ioBroker.Adapter;
    private readonly config: MqttAdapterConfig;
    private patterns: string[] = [];
    private readonly states: Record<string, ioBroker.State>;

    constructor(adapter: ioBroker.Adapter, states: Record<string, ioBroker.State>) {
        this.adapter = adapter;
        this.states = states;
        this.namespaceRegEx = new RegExp(`^${this.adapter.namespace.replace('.', '\\.')}\\.`);
        this.config = this.adapter.config as MqttAdapterConfig;
        this.ignoredTopics = this.config.ignoredTopics?.split(',') ?? [];

        for (const ignoredTopicPattern of this.ignoredTopics) {
            if (!ignoredTopicPattern) {
                // Empty strings would filter out all topics, which is probably not what the user wants
                if (this.ignoredTopics.length > 1) {
                    this.adapter.log.warn('Ignored topics should not end with an ",".');
                }
                continue;
            }
            const ignoredTopicRegexWithNameSpace = pattern2RegEx(
                `${this.adapter.namespace}.${ignoredTopicPattern}`,
                this.adapter,
            );
            const ignoredTopicRegex = pattern2RegEx(ignoredTopicPattern, this.adapter);
            this.adapter.log.info(
                `Ignoring topic with pattern: ${ignoredTopicPattern} (RegExp: ${ignoredTopicRegex} und ${ignoredTopicRegexWithNameSpace})`,
            );
            this.ignoredTopicsRegexes.push(new RegExp(ignoredTopicRegex), new RegExp(ignoredTopicRegexWithNameSpace));
        }
        process.on('uncaughtException', err => this.adapter.log.error(`uncaughtException: ${err}`));
        this.init();
    }

    public destroy(): void {
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }

    public onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        this.send2Server(id, state);
    }
    public onMessage(topic: MqttTopic, message: any, retain: boolean, binary: boolean): void {
        this.publishMessage(topic, message, retain, binary);
    }

    private send2Server(id: string, state: ioBroker.State | null | undefined, cb?: (id: string) => void): void {
        if (!this.client) {
            return;
        }
        const topic = this.id2topic[id];

        if (!topic) {
            void this.adapter.getForeignObject(id, (err, obj) => {
                if (!this.client) {
                    return;
                }
                if (!obj) {
                    this.adapter.log.warn(`Cannot resolve topic name for ID: ${id} (object not found)`);
                    cb?.(id);
                    return;
                }
                let _topic;
                if (!obj.native?.topic) {
                    _topic = convertID2topic(
                        obj._id,
                        null,
                        this.config.prefix,
                        this.adapter.namespace,
                        this.config.removePrefix,
                    );
                } else {
                    _topic = obj.native.topic;
                }

                this.id2topic[obj._id] = _topic;
                this.topic2id[_topic] ||= { obj: obj as ioBroker.StateObject, id: obj._id };

                this.send2Server(obj._id, state, cb);
            });
            return;
        }
        this.adapter.log.info(`send2Server ${id}[${topic}]`);

        this.publishMessage(this.config.extraSet && state && !state.ack ? `${topic}/set` : topic, state || null);

        cb?.(id);
    }

    private publishMessage(topic: MqttTopic, message: any, retain?: boolean, binary?: boolean): void {
        if (message === null || message === undefined) {
            message = null;
            this.adapter.log.debug(`Send to server "${topic}": deleted`);
        } else {
            this.adapter.log.debug(`Send to server "${this.config.prefix}${topic}": ${JSON.stringify(message)}`);
        }

        if (!this.topic2id[topic]) {
            // it is from messageBox, so try to detect binary state
            if (!binary) {
                message = state2string(message, this.config.sendStateObject);
            }
        } else {
            message =
                // @ts-expect-error binary states are deprecated, but could happen
                this.topic2id[topic].obj?.common && this.topic2id[topic].obj.common.type === 'file'
                    ? message
                    : state2string(message, this.config.sendStateObject);
        }

        this.client?.publish(
            topic,
            message,
            { qos: this.config.defaultQoS, retain: retain ?? this.config.retain },
            err => err && this.adapter.log.error(`client publishMessage: ${err as Error}`),
        );
    }

    private publishAllStates(toPublish: string[]): void {
        if (!toPublish?.length) {
            this.adapter.log.info('All states published');
            return;
        }

        if (!this.client) {
            return;
        }

        const id = toPublish[0];
        if (!this.id2topic[id]) {
            void this.adapter.getForeignObject(id, (err, obj) => {
                if (!this.client) {
                    return;
                }

                let _topic;
                if (!obj) {
                    this.adapter.log.warn(`Cannot resolve topic name for ID: "${id}" (object not found)`);
                    return;
                } else if (!obj.native || !obj.native.topic) {
                    _topic = convertID2topic(
                        obj._id,
                        null,
                        this.config.prefix,
                        this.adapter.namespace,
                        this.config.removePrefix,
                    );
                } else {
                    _topic = obj.native.topic;
                }

                this.id2topic[obj._id] = _topic;
                this.topic2id[_topic] = this.topic2id[_topic] || { obj, id: obj._id };

                setImmediate(() => this.publishAllStates(toPublish));
            });
            return;
        }
        toPublish.shift();

        if (this.config.extraSet && this.states[id] && !this.states[id].ack) {
            this.client.publish(
                `${this.id2topic[id]}/set`,
                state2string(this.states[id], this.config.sendStateObject),
                { qos: this.config.defaultQoS, retain: this.config.retain },
                err => {
                    if (err) {
                        this.adapter.log.error(`client.publish /set: ${err as Error}`);
                    }
                    setImmediate(() => this.publishAllStates(toPublish));
                },
            );
        } else {
            if (this.states[id]) {
                this.client.publish(
                    this.id2topic[id],
                    state2string(this.states[id], this.config.sendStateObject),
                    { qos: this.config.defaultQoS, retain: this.config.retain },
                    err => {
                        err && this.adapter.log.error(`client.publish AllStates: ${err as Error}`);
                        setImmediate(() => this.publishAllStates(toPublish));
                    },
                );
            } else {
                setImmediate(() => this.publishAllStates(toPublish));
            }
        }
    }

    private init(): void {
        const clientId = this.config.clientId;
        const _url = `${this.config.ssl ? 'mqtts' : 'mqtt'}://${this.config.url}${this.config.port ? `:${this.config.port}` : ''}`;
        const __url = `${this.config.ssl ? 'mqtts' : 'mqtt'}://${this.config.url}${this.config.port ? `:${this.config.port}` : ''} with clientId=${encodeURIComponent(clientId)}${this.config.user ? `and credentials ${encodeURIComponent(this.config.user)}:*******************` : ''}`;
        this.adapter.log.info(`Try to connect to ${__url}`);

        // This variable will hold the root certificate path provided in the this.adapter UI.
        let rootCertPath = null;

        // Load certificate only if SSL and self-signed certificate are enabled
        if (this.config.ssl && this.config.selfSigned) {
            if (this.config.rootCertificatePath) {
                rootCertPath = this.config.rootCertificatePath;
                this.adapter.log.debug(
                    `SSL and self-signed certificates are enabled. Using root certificate at: ${rootCertPath}`,
                );
            } else {
                this.adapter.log.warn(
                    `SSL and self-signed certificates are enabled, but the root certificate path was not set in the UI.`,
                );
            }
        } else {
            this.adapter.log.debug(
                `SSL and/or self-signed certificates not enabled. Root certificate will not be used.`,
            );
        }

        try {
            const opts: IClientOptions = {
                clientId: clientId,
                keepalive: this.config.keepalive || 10 /* in seconds */,
                protocolId: 'MQTT',
                protocolVersion: 4,
                reconnectPeriod: (this.config.reconnectPeriod || 10) * 1000 /* in milliseconds */,
                connectTimeout: (this.config.connectTimeout || 30) * 1000 /* in milliseconds */,
                clean: !this.config.persistent,
                rejectUnauthorized:
                    this.config.rejectUnauthorized /* added option to disable certification validation */,
            };

            // If SSL and self-signed are used, try to load the certificate!
            if (rootCertPath) {
                try {
                    opts.ca = readFileSync(rootCertPath);
                } catch (err) {
                    this.adapter.log.error(
                        `Could not read root certificate from: ${rootCertPath}. Error: ${(err as Error).message}`,
                    );
                }
            }

            if (this.config.user) {
                opts.username = this.config.user;
                opts.password = this.config.pass;
            }

            this.adapter.log.debug(`The connection is now being established to URL: ${__url}`);

            this.client = connect(_url, opts);
        } catch (err) {
            this.adapter.log.error(`Can not connect to mqtt server: ${err as Error}`);
            typeof this.adapter.terminate === 'function' ? this.adapter.terminate(11) : process.exit(11);
            return;
        }

        // By default, subscribe on all topics
        this.patterns = (this.config.patterns || '#')
            .split(',')
            .map(pattern => pattern.trim())
            .filter(pattern => pattern);

        // delete all server connection information
        void this.adapter.getStatesAsync('info.clients.*').then(async states => {
            for (const id in states) {
                await this.adapter.delForeignObjectAsync(id);
            }
        });

        // create a connected object and state
        this.adapter.getObject('info.connection', (err, obj) => {
            if (!obj || !obj.common || obj.common.type !== 'boolean') {
                obj = {
                    _id: 'info.connection',
                    type: 'state',
                    common: {
                        role: 'indicator.connected',
                        name: {
                            en: 'If connected to MQTT broker',
                            de: 'Ob mit MQTT Broker verbunden',
                            ru: 'Подключен ли к MQTT брокеру',
                            pt: 'Se conectado ao corretor MQTT',
                            nl: 'Indien verbonden met MQTT broker',
                            fr: 'Si connecté au courtier MQTT',
                            it: 'Se connesso al broker MQTT',
                            es: 'Si está conectado al broker MQTT',
                            pl: 'Jeśli połączony z brokerem MQTT',
                            uk: 'Якщо підключений до MQTT брокера',
                            'zh-cn': '是否连接到MQTT代理',
                        },
                        type: 'boolean',
                        read: true,
                        write: false,
                        def: false,
                    },
                    native: {},
                };

                this.adapter.setObject('info.connection', obj, () =>
                    this.adapter.setState('info.connection', this.connected, true),
                );
            }
        });

        // create last Session object and state to store previous
        // topics in case of persisted sessions
        if (this.config.persistent) {
            this.adapter.getObject('info.lastSession', (err, obj) => {
                if (!obj || !obj.common || obj.common.type !== 'string') {
                    obj = {
                        _id: 'info.lastSession',
                        type: 'state',
                        common: {
                            role: 'variable',
                            name: {
                                en: "Last session's topics",
                                de: 'Topics der letzten Session',
                                ru: 'Топики предыдущей сессии',
                                pt: 'Tópicos da última sessão',
                                nl: 'Onderwerpen van de laatste sessie',
                                fr: 'Sujets de la dernière session',
                                it: "Argomenti dell'ultima sessione",
                                es: 'Temas de la última sesión',
                                pl: 'Tematy poprzedniej sesji',
                                uk: 'Топіки попередньої сесії',
                                'zh-cn': '上一个会话的主题',
                            },
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        },
                        native: {},
                    };

                    this.adapter.setObject('info.lastSession', obj, () =>
                        this.adapter.setState('info.lastSession', '', true),
                    );
                }
            });
        }

        // topic from MQTT broker received
        this.client.on('message', async (topic: MqttTopic, message: Buffer): Promise<void> => {
            if (!topic) {
                return;
            }

            let isAck = true;

            if (this.config.extraSet) {
                if (topic.match(/\/set$/)) {
                    isAck = false;
                    topic = topic.substring(0, topic.length - 4);
                }
            }

            // try to convert a topic to ID
            let id =
                this.topic2id[topic]?.id || convertTopic2id(topic, false, this.config.prefix, this.adapter.namespace);

            if (id.length > this.config.maxTopicLength) {
                this.adapter.log.warn(
                    `[${this.client ? this.config.clientId : 'disconnected'}] Topic name is too long: ${id.substring(0, 100)}...`,
                );
                return;
            }
            if (id.match(invalidChars)) {
                this.adapter.log.warn(
                    `[${this.client ? this.config.clientId : 'disconnected'}] Topic name contains invalid characters: ${id} ... ignoring`,
                );
                return;
            }

            if (isIgnoredTopic(id, this.ignoredTopicsRegexes)) {
                return;
            }

            // if no cache for this topic found
            if (!this.topic2id[topic]) {
                // null indicates that it is processing now
                this.topic2id[topic] = { id: '', isAck, obj: null, processing: true };

                // Create an object if not exists
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
                let typeWasUndefined = false;

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
                            this.adapter.log.info(`Object ${id} ignored and not created`);
                            return;
                        }

                        // create state
                        obj = {
                            _id: id,
                            common: {
                                name: topic,
                                write: true,
                                read: true,
                                role: 'variable',
                                desc: 'mqtt client variable',
                                type: 'mixed',
                            },
                            native: {
                                topic: topic,
                            },
                            type: 'state',
                        };
                        typeWasUndefined = true;
                    }
                }
                const stateObj: ioBroker.StateObject = obj as ioBroker.StateObject;

                if (stateObj._id === `${this.adapter.namespace}.info.connection`) {
                    this.adapter.log.debug(
                        `Ignore State update for ${stateObj._id} because this.adapter internal state.`,
                    );
                    return;
                }

                // expand an old version of objects
                if (stateObj.common?.type && this.namespaceRegEx.test(stateObj._id) && !stateObj.native?.topic) {
                    stateObj.native ||= {};
                    stateObj.native.topic = topic;
                    await this.adapter.setForeignObject(stateObj._id, stateObj);
                }

                stateObj.common ||= {} as ioBroker.StateCommon;

                // @ts-expect-error file is deprecated but could happen
                if (stateObj.common.type === 'file') {
                    this.adapter.log.warn('"file" type is deprecated. Please use "mixed" or "string" instead.');
                    return;
                }
                const parsedMessage = convertMessage(topic, message, this.adapter);

                this.topic2id[topic].message = parsedMessage;

                const messageType = typeof parsedMessage;
                const stateType = Array.isArray(parsedMessage)
                    ? 'array'
                    : messageType === 'string' ||
                        messageType === 'number' ||
                        messageType === 'boolean' ||
                        messageType === 'object'
                      ? messageType
                      : 'mixed';

                if (typeWasUndefined) {
                    stateObj.common.type = stateType;
                    // New object which is not "file", we create it now that we know the type
                    if (typeof parsedMessage === 'object' && parsedMessage.val !== undefined) {
                        const messageType = typeof parsedMessage.val;
                        stateObj.common.type = Array.isArray(parsedMessage.val)
                            ? 'array'
                            : messageType === 'string' ||
                                messageType === 'number' ||
                                messageType === 'boolean' ||
                                messageType === 'object'
                              ? messageType
                              : 'mixed';
                    }
                    this.adapter.log.debug(`Create object for topic: ${topic}[ID: ${stateObj._id}]`);
                    await this.adapter.setForeignObject(stateObj._id, stateObj);
                } else {
                    // expand an old version of objects
                    if (
                        this.namespaceRegEx.test(stateObj._id) &&
                        (!stateObj.native?.topic ||
                            (stateObj.common &&
                                stateObj.common.type !== 'mixed' &&
                                stateObj.common.type !== messageType))
                    ) {
                        if (stateObj.common && stateObj.common.type !== 'mixed' && stateObj.common.type !== stateType) {
                            // mqtt topics could change types, but log it to communicate to the user if a type is frequently fluctuating
                            this.adapter.log.info(
                                `Client: Changed type of "${stateObj._id}" from "${stateObj.common.type}"(${message.toString()}) to "${stateType}"(${JSON.stringify(parsedMessage)})`,
                            );
                            stateObj.common.type = stateType;
                        }
                        stateObj.native ||= {};
                        stateObj.native.topic = topic;
                        try {
                            await this.adapter.setForeignObject(stateObj._id, stateObj);
                        } catch (err) {
                            this.adapter.log.error(`Could not update object "${id}": ${(err as Error).message}`);
                        }
                    }
                }

                // this is a topic from this adapter
                // Overwrite null with the real ID
                this.topic2id[topic].id = stateObj._id;
                this.topic2id[topic].obj = stateObj;
                this.id2topic[stateObj._id] = topic;

                if (this.config.debug) {
                    this.adapter.log.debug(
                        `Client received "${topic}" (${typeof this.topic2id[topic].message}): ${JSON.stringify(this.topic2id[topic].message)}`,
                    );
                }

                try {
                    if (typeof parsedMessage === 'object') {
                        const validProperties = ['val', 'ack', 'ts', 'q', 'from', 'c', 'expire', 'lc', 'user'];

                        // Are there any forbidden properties?
                        const forbiddenProperties = Object.keys(parsedMessage).filter(
                            k => !validProperties.includes(k),
                        );

                        // If there are forbidden properties, we save the message as JSON
                        if (forbiddenProperties.length) {
                            if (this.config.debug) {
                                this.adapter.log.debug(
                                    `The message object contains forbidden state properties ${forbiddenProperties.join(', ')}: Saving as JSON`,
                                );
                            }

                            await this.adapter.setForeignStateAsync(stateObj._id, {
                                val: JSON.stringify(parsedMessage),
                                ack: this.topic2id[topic].isAck,
                            });
                        } else {
                            await this.adapter.setForeignStateAsync(stateObj._id, JSON.stringify(parsedMessage));
                        }
                    } else {
                        await this.adapter.setForeignStateAsync(stateObj._id, {
                            val: parsedMessage,
                            ack: this.topic2id[topic].isAck,
                        });
                    }
                } catch (err) {
                    this.adapter.log.warn(
                        `Error while setting state "${this.topic2id[topic].id}" for Client: ${err as Error}`,
                    );
                }

                // we do not need these values anymore
                if (!this.config.onchange) {
                    delete this.topic2id[topic].message;
                    delete this.topic2id[topic].isAck;
                }

                delete this.topic2id[topic].processing;

                // do not wait the end of this function
                ensureObjectStructure(this.adapter, stateObj._id, this.verifiedObjects).catch(e =>
                    this.adapter.log.error(`Cannot ensure object structure: ${e}`),
                );
            } else if (this.topic2id[topic].processing) {
                if (this.config.debug) {
                    this.adapter.log.debug(
                        `Client received (but in process) "${topic}" (${typeof this.topic2id[topic].message}): ${JSON.stringify(this.topic2id[topic].message)}`,
                    );
                }
                this.topic2id[topic].message = convertMessage(topic, message, this.adapter);
            } else {
                if (!this.config.onchange) {
                    if (this.topic2id[topic].message !== undefined) {
                        delete this.topic2id[topic].message;
                    }
                    if (this.topic2id[topic].isAck !== undefined) {
                        delete this.topic2id[topic].isAck;
                    }
                }

                let value: undefined | string | number | boolean | Record<string, any>;
                const parsedMessage = convertMessage(topic, message, this.adapter);
                if (typeof parsedMessage === 'object') {
                    if (
                        !this.config.onchange ||
                        JSON.stringify(this.topic2id[topic].message) !== JSON.stringify(parsedMessage)
                    ) {
                        if (this.config.debug) {
                            this.adapter.log.debug(
                                `Client received "${topic}" (${typeof parsedMessage}): ${JSON.stringify(parsedMessage)}`,
                            );
                        }
                        value = parsedMessage;
                    } else if (this.config.debug) {
                        this.adapter.log.debug(
                            `Client received (but ignored) "${topic}" (${typeof parsedMessage}): ${JSON.stringify(parsedMessage)}`,
                        );
                    }
                } else {
                    if (
                        !this.config.onchange ||
                        this.topic2id[topic].message !== parsedMessage ||
                        this.topic2id[topic].isAck !== isAck
                    ) {
                        if (this.config.onchange) {
                            this.topic2id[topic].message = parsedMessage;
                            this.topic2id[topic].isAck = isAck;
                        }
                        if (this.config.debug) {
                            this.adapter.log.debug(
                                `Client received "${topic}" (${typeof parsedMessage}): ${parsedMessage}`,
                            );
                        }
                        value = { val: parsedMessage, ack: isAck };
                    } else if (this.config.debug) {
                        this.adapter.log.debug(
                            `Client received (but ignored) "${topic}" (${typeof this.topic2id[topic].message}): ${this.topic2id[topic].message as string | boolean | number}`,
                        );
                    }
                }
                const stateObj = this.topic2id[topic].obj!;
                const messageType = typeof value;
                const stateType = Array.isArray(value)
                    ? 'array'
                    : messageType === 'string' ||
                        messageType === 'number' ||
                        messageType === 'boolean' ||
                        messageType === 'object'
                      ? messageType
                      : 'mixed';

                if (
                    value !== undefined &&
                    typeof value === 'object' &&
                    value.val !== undefined &&
                    value.val !== null &&
                    this.namespaceRegEx.test(this.topic2id[topic].id) &&
                    stateObj.common &&
                    stateObj.common.type !== 'mixed' &&
                    stateObj.common.type !== stateType
                ) {
                    this.adapter.log.info(
                        `Client: Changed type of "${this.topic2id[topic].id}" from "${stateObj.common.type}" to "mixed"`,
                    );
                    try {
                        await this.adapter.extendForeignObjectAsync(this.topic2id[topic].id, {
                            common: { type: 'mixed' },
                        });
                    } catch (err) {
                        this.adapter.log.warn(
                            `Error while updating object "${this.topic2id[topic].id}" for Client: ${err as Error}`,
                        );
                    }
                    stateObj.common.type = 'mixed';
                }

                if (this.topic2id[topic].id === `${this.adapter.namespace}.info.connection`) {
                    this.adapter.log.debug(
                        `Ignore State update for ${this.topic2id[topic].id} because this.adapter internal state.`,
                    );
                } else if (value !== undefined && typeof value === 'object' && value.val !== undefined) {
                    try {
                        await this.adapter.setForeignStateAsync(
                            this.topic2id[topic].id,
                            value as ioBroker.SettableState,
                        );
                    } catch (err) {
                        this.adapter.log.warn(
                            `Error while setting state "${this.topic2id[topic].id}" for Client: ${err as Error}`,
                        );
                    }
                }
            }
        });

        this.client.on('connect', () => {
            if (!this.client) {
                return;
            }
            this.adapter.log.info(`Connected to ${this.config.url}`);
            this.connected = true;
            void this.adapter.setState('info.connection', this.connected, true);

            // unsubscribe old topics in persisted session
            if (this.config.persistent) {
                this.adapter.getState('info.lastSession', (err, state) => {
                    const patternsPrevious: string[] = state?.val ? JSON.parse(state.val as string) || [] : [];

                    const patternsDiff = patternsPrevious.filter(x => !this.patterns.includes(x));

                    for (let i = 0; i < patternsDiff.length; i++) {
                        patternsDiff[i] = patternsDiff[i].trim();
                        this.adapter.log.debug(`Unsubscribed Topic: "${patternsDiff[i]}"`);
                        this.client?.unsubscribe(patternsDiff[i]);
                    }

                    void this.adapter.setState('info.lastSession', JSON.stringify(this.patterns), true);
                });
            }

            // subscribe current topics
            for (let i = 0; i < this.patterns.length; i++) {
                this.adapter.log.info(`Subscribe on "${this.patterns[i]}"`);
                this.client.subscribe(this.patterns[i]);
            }

            if (this.config.publishAllOnStart) {
                const toPublish: string[] = [];
                Object.keys(this.states).forEach(id => {
                    if (!messageboxRegex.test(id) && !isIgnoredTopic(id, this.ignoredTopicsRegexes)) {
                        this.adapter.log.info(`Publishing state ${id}`);
                        toPublish.push(id);
                    }
                });
                this.publishAllStates(toPublish);
            }
        });

        this.client.on('reconnect', () => {
            if (!this.client) {
                return;
            }
            this.adapter.log.info(`Reconnected to ${this.config.url}`);
            this.connected = true;
            void this.adapter.setState('info.connection', this.connected, true);
        });

        this.client.on('error', err => {
            this.adapter.log.error(`Client error: ${err as Error}`);

            if (this.connected) {
                this.adapter.log.info(`Disconnected from ${this.config.url}`);
                this.connected = false;
                void this.adapter.setState('info.connection', this.connected, true);
            }
        });

        this.client.on('close', (): void => {
            if (this.connected) {
                this.adapter.log.info(`Disconnected from ${this.config.url}`);
                this.connected = false;
                void this.adapter.setState('info.connection', this.connected, true);
            }
        });
    }
}
