import {
    connect,
    type MqttClient,
    type IClientOptions,
    type IClientPublishOptions,
    type IClientSubscribeOptions,
    type OnMessageCallback,
    type PacketCallback,
    type ClientSubscribeCallback,
} from 'mqtt';

type ConnectedCallback = (connected: boolean) => void;

interface TestClientConfig extends IClientOptions {
    url?: string;
    name?: string;
    user?: string;
    pass?: string;
    subscribe?: string | false;
}

export default class MqttClientEmulator {
    client: MqttClient | null;
    #config: TestClientConfig;

    constructor(
        cbConnected?: ConnectedCallback | null,
        cbChanged?: OnMessageCallback | null,
        config?: string | TestClientConfig,
    ) {
        if (typeof config === 'string') {
            config = { name: config };
        }
        config ||= {};
        config.url ||= '127.0.0.1';
        if (config.user) {
            config.username = config.user;
            config.password = config.pass;
        }
        if (config.name) {
            config.clientId = config.name;
        }
        this.#config = config;

        this.client = connect(`mqtt://${config.url}`, config);

        this.client.on('connect', () => {
            if (!this.client) {
                return;
            }
            console.log(`${new Date().toISOString()} Test MQTT Client ${config.clientId} connected to ${config.url}`);

            if (config.subscribe !== false) {
                this.client.subscribe(config.subscribe || '#');
            }

            cbConnected?.(true);
        });

        this.client.on('message', (topic, message, packet) => {
            // message is Buffer
            if (cbChanged) {
                cbChanged(topic, message, packet);
            } else {
                console.log(`Test MQTT Client ${config.clientId} received "${topic}": ${message.toString()}`);
            }
        });

        this.client.on('close', () => {
            if (cbConnected) {
                cbConnected(false);
            } else {
                console.log(`Test MQTT Client ${config.clientId} closed`);
            }
        });

        this.client.on('error', error => {
            console.error(`Test MQTT Client ${config.clientId} error: ${error}`);
        });
    }

    publish(
        topic: string,
        message: string | Buffer,
        qos?: number | PacketCallback,
        retain?: boolean | PacketCallback,
        cb?: PacketCallback,
    ): void {
        if (typeof qos === 'function') {
            cb = qos;
            qos = undefined;
        }
        if (typeof retain === 'function') {
            cb = retain;
            retain = undefined;
        }
        const opts: IClientPublishOptions = {
            retain: retain || false,
            qos: (qos || 0) as 0 | 1 | 2,
        };
        console.log(
            `Test MQTT Client ${this.#config.clientId} publish "${topic}" -> "${message.toString()}" : ${JSON.stringify(opts)}`,
        );
        this.client?.publish(topic, message, opts, cb);
    }

    subscribe(
        topic: string,
        opts?: IClientSubscribeOptions | ClientSubscribeCallback,
        cb?: ClientSubscribeCallback,
    ): void {
        if (typeof opts === 'function') {
            cb = opts;
            opts = undefined;
        }
        this.client?.subscribe(topic, opts, cb);
    }

    unsubscribe(topic: string, cb?: PacketCallback): void {
        this.client?.unsubscribe(topic, cb);
    }

    destroy(): void {
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }

    stop(): void {
        this.destroy();
    }
}
