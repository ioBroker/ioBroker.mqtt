export interface AdapterConfig {
    prefix?: string;
    sendInterval?: number;
    publishOnSubscribe?: boolean;
    sendOnStartInterval?: boolean;
    defaultQoS?: 0 | 1 | 2;
    extraSet?: boolean;
    debug?: boolean;
    onchange?: boolean;
    port?: number;
    ssl?: boolean;
    webSocket?: boolean;
    certificates?: null;
    // Additional fields consumed by the adapter-under-test (MQTTClient / MQTTServer)
    url?: string;
    clientId?: string;
    retransmitInterval?: number;
    retransmitCount?: number;
    ignoreNewObjects?: boolean;
}

export default class AdapterSimulator {
    namespace: string;
    config: AdapterConfig;
    log: {
        debug: (text: string) => void;
        info: (text: string) => void;
        warn: (text: string) => void;
        error: (text: string) => void;
    };

    #objects: Record<string, ioBroker.Object> = {};
    #states: Record<string, ioBroker.State> = {};

    constructor(config?: AdapterConfig) {
        this.namespace = 'mqtt.0';

        this.config = {
            prefix: '',
            sendInterval: 100,
            publishOnSubscribe: false,
            sendOnStartInterval: false,
            defaultQoS: 1,
            extraSet: false,
            debug: true,
            onchange: false,
            port: 1883,
            ssl: false,
            webSocket: false,
            certificates: null,
            ...(config || {}),
        };

        this.log = {
            debug: (text: string) => console.log(`[${new Date().toISOString()} ${text}`),
            info: (text: string) => console.log(`[${new Date().toISOString()} ${text}`),
            warn: (text: string) => console.warn(`[${new Date().toISOString()} ${text}`),
            error: (text: string) => console.error(`[${new Date().toISOString()} ${text}`),
        };
    }

    setState(
        id: string,
        state: ioBroker.State | ioBroker.StateValue,
        ack?: boolean | ioBroker.SetStateCallback,
        cb?: ioBroker.SetStateCallback,
    ): void {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.setForeignState(id, state, ack, cb);
    }

    setForeignState(
        id: string,
        state: ioBroker.State | ioBroker.StateValue,
        ack?: boolean | ioBroker.SetStateCallback,
        cb?: ioBroker.SetStateCallback,
    ): void {
        if (typeof ack === 'function') {
            cb = ack;
            ack = undefined;
        }

        let stateObj: ioBroker.State;
        if (typeof state !== 'object') {
            stateObj = { val: state, ack: ack || false } as ioBroker.State;
        } else {
            stateObj = state as ioBroker.State;
        }
        stateObj.ts = Date.now();
        stateObj.ack = !!stateObj.ack;

        this.#states[id] = stateObj;
        cb?.(null);
    }

    getState(id: string, cb?: ioBroker.GetStateCallback): void {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.getForeignState(id, cb);
    }

    getForeignState(id: string, cb?: ioBroker.GetStateCallback): void {
        cb?.(null, this.#states[id]);
    }

    getStatesAsync(pattern: string): Promise<Record<string, ioBroker.State>> {
        if (!pattern.startsWith(`${this.namespace}.`)) {
            pattern = `${this.namespace}.${pattern}`;
        }

        if (pattern.endsWith('*')) {
            pattern = pattern.substring(0, pattern.length - 1);
        }

        return new Promise(resolve => {
            const result: Record<string, ioBroker.State> = {};
            for (const id in this.#states) {
                if (id.startsWith(pattern)) {
                    result[id] = this.#states[id];
                }
            }
            resolve(result);
        });
    }

    getStateAsync(id: string): Promise<ioBroker.State | null | undefined> {
        return new Promise((resolve, reject) =>
            this.getState(id, (err, state) => (err ? reject(err) : resolve(state))),
        );
    }

    setStateAsync(id: string, val: ioBroker.State | ioBroker.StateValue, ack?: boolean): Promise<string | undefined> {
        return new Promise((resolve, reject) =>
            this.setState(id, val, ack, (err, stateId) => (err ? reject(err) : resolve(stateId))),
        );
    }

    getForeignStateAsync(id: string): Promise<ioBroker.State | null | undefined> {
        return new Promise((resolve, reject) =>
            this.getForeignState(id, (err, state) => (err ? reject(err) : resolve(state))),
        );
    }

    setForeignStateAsync(id: string, state: ioBroker.State | ioBroker.StateValue, ack?: boolean): Promise<void> {
        return new Promise((resolve, reject) =>
            this.setForeignState(id, state, ack, err => (err ? reject(err) : resolve())),
        );
    }

    getObject(id: string, cb?: ioBroker.GetObjectCallback): void {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.getForeignObject(id, cb);
    }

    delForeignObjectAsync(id: string): Promise<void> {
        return new Promise(resolve => this.getForeignObject(id, () => resolve()));
    }

    setObject(id: string, obj: ioBroker.SettableObject, cb?: ioBroker.SetObjectCallback): void {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.setForeignObject(id, obj, cb);
    }

    setObjectAsync(id: string, obj: ioBroker.SettableObject): Promise<{ id: string } | undefined> {
        return new Promise(resolve => this.setObject(id, obj, (err, resObj) => resolve(resObj)));
    }

    getForeignObject(id: string, cb?: ioBroker.GetObjectCallback): void {
        cb?.(null, this.#objects[id]);
    }

    getForeignObjectAsync(id: string): Promise<ioBroker.Object | null | undefined> {
        return new Promise(resolve => this.getForeignObject(id, (err, obj) => resolve(obj)));
    }

    getObjectAsync(id: string): Promise<ioBroker.Object | null | undefined> {
        return new Promise(resolve => this.getObject(id, (err, obj) => resolve(obj)));
    }

    setForeignObject(id: string, obj: ioBroker.SettableObject, cb?: ioBroker.SetObjectCallback): void {
        const stored = JSON.parse(JSON.stringify(obj)) as ioBroker.Object;
        stored._id = id;
        this.#objects[id] = stored;
        cb?.();
    }

    setForeignObjectAsync(id: string, obj: ioBroker.SettableObject): Promise<void> {
        return new Promise(resolve => this.setForeignObject(id, obj, () => resolve()));
    }

    clearAll(): void {
        this.#objects = {};
        this.#states = {};
    }

    setTimeout(func: (...args: unknown[]) => void, time: number): NodeJS.Timeout {
        return setTimeout(func, time);
    }

    clearTimeout(timer: NodeJS.Timeout): void {
        clearTimeout(timer);
    }
}
