"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const mqtt_1 = require("mqtt");
const MQTTClient_1 = __importDefault(require("./lib/MQTTClient"));
const MQTTServer_1 = __importDefault(require("./lib/MQTTServer"));
const securityChecker_1 = require("./lib/securityChecker");
class MQTT extends adapter_core_1.Adapter {
    checkTimeout = null;
    messageboxRegex = new RegExp('\\.messagebox$');
    states = {};
    server = null;
    client = null;
    constructor(options) {
        super({
            ...options,
            name: 'mqtt',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    async onReady() {
        this.config.maxTopicLength = this.config.maxTopicLength || 100;
        if (this.config.doNotCreateClientObjects) {
            // delete all server connection information
            const states = await this.getStatesAsync('info.clients.*');
            for (const id in states) {
                await this.delForeignObjectAsync(id);
            }
        }
        // update connected clients
        if (this.config.type === 'server') {
            const channel = await this.getObjectAsync('info.clients');
            if (!channel) {
                await this.setObjectAsync('info.clients', {
                    type: 'channel',
                    common: {
                        name: 'Clients',
                        role: 'info',
                    },
                    native: {},
                });
            }
        }
        if (this.config.ssl && this.config.type === 'server') {
            // Load certificates
            this.config.certificates = (await this.getCertificatesAsync())[0];
        }
        // Start
        await this.main();
    }
    async main() {
        this.config.forceCleanSession = this.config.forceCleanSession || 'no'; // default
        // Subscribe on own variables to publish it
        if (this.config.type === 'client') {
            await this.subscribeForeignStatesAsync(`${this.namespace}.*`);
            await this.readStatesForPattern(`${this.namespace}.*`);
        }
        if (this.config.publish) {
            // change default publish setting to real instance
            if (this.config.publish === 'mqtt.0.*' && this.instance !== 0) {
                this.log.warn(`Default "publish" setting changed to "${this.namespace}.*". Restarting...`);
                await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                    native: {
                        publish: `${this.namespace}.*`,
                    },
                });
                return; // Adapter will be restarted soon, no need to initialize now
            }
            const parts = this.config.publish
                .split(',')
                .map(p => p.trim())
                .filter(p => p);
            for (let t = 0; t < parts.length; t++) {
                let part = parts[t];
                if (this.config.type === 'client' && part === `${this.namespace}.*`) {
                    // it was subscribed earlier
                    continue;
                }
                if (part.includes('#')) {
                    this.config.type !== 'client' &&
                        this.log.warn(`Used MQTT notation for ioBroker in pattern "${part}": use "${part.replace(/#/g, '*')} notation`);
                    part = part.replace(/#/g, '*');
                }
                await this.subscribeForeignStatesAsync(part);
                await this.readStatesForPattern(part);
            }
        }
        else if (this.config.type !== 'client') {
            this.log.warn(`No ioBroker changes will be published to the clients. Set the "publish" option in the adapter settings to subscribe for relevant changes.`);
        }
        this.config.defaultQoS = (parseInt(this.config.defaultQoS, 10) || 0);
        this.config.retain = this.config.retain === 'true' || this.config.retain === true;
        this.config.persistent =
            this.config.persistent === 'true' || this.config.persistent === true;
        this.config.retransmitInterval = parseInt(this.config.retransmitInterval, 10) || 2000;
        this.config.retransmitCount = parseInt(this.config.retransmitCount, 10) || 10;
        if (this.config.retransmitInterval < this.config.sendInterval) {
            this.config.retransmitInterval = this.config.sendInterval * 5;
        }
        // If no subscription, start client or server
        if (this.config.type === 'client') {
            this.config.clientId = this.config.clientId || `${this.host || 'mqtt'}.${this.namespace}`;
            this.client = new MQTTClient_1.default(this, this.states);
        }
        else {
            this.server = new MQTTServer_1.default(this, this.states);
            if (!this.config.doNotCheckPublicIP && (!this.config.user || !this.config.pass)) {
                this.checkTimeout = setTimeout(async () => {
                    this.checkTimeout = null;
                    try {
                        await (0, securityChecker_1.checkPublicIP)(this.config.port, this.config.ssl);
                    }
                    catch (e) {
                        // this supported first from js-controller 5.0.
                        this.sendToHost(`system.host.${this.host}`, 'addNotification', {
                            scope: 'system',
                            category: 'securityIssues',
                            message: 'Your mqtt instance is accessible from the internet without any protection. ' +
                                'Please enable authentication or disable the access from the internet.',
                            instance: `system.adapter.${this.namespace}`,
                        }, ( /* result */) => {
                            /* ignore */
                        });
                        this.log.error(e.toString());
                    }
                }, 1000);
            }
        }
    }
    async readStatesForPattern(pattern) {
        try {
            const res = await this.getForeignStatesAsync(pattern);
            if (res) {
                this.states ||= {};
                Object.keys(res)
                    .filter(id => !this.messageboxRegex.test(id))
                    .forEach(id => {
                    if (!this.states[id]) {
                        this.states[id] = res[id];
                    }
                });
            }
        }
        catch (error) {
            this.log.error(`Cannot read states "${pattern}": ${error}`);
        }
    }
    onMessage(obj) {
        if (!obj?.command) {
            return;
        }
        switch (obj.command) {
            case 'sendMessage2Client':
                if (this.server) {
                    this.log.debug(`Sending message from server to clients via topic ${obj.message.topic}: ${obj.message.message} ...`);
                    this.server.onMessage(obj.message.topic, obj.message.message, obj.message?.retain, obj.message?.binary);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { result: true }, obj.callback);
                    }
                }
                else if (this.client) {
                    this.log.debug(`Sending message from client to server via topic ${obj.message.topic}: ${obj.message.message} ...`);
                    this.client.onMessage(obj.message.topic, obj.message.message, obj.message?.retain, obj.message?.binary);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { result: true }, obj.callback);
                    }
                }
                else {
                    this.log.debug(`Neither MQTT server nor client not started, thus not sending message via topic ${obj.message.topic} (${obj.message.message}).`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: 'Neither MQTT server nor client not started' }, obj.callback);
                    }
                }
                break;
            case 'sendState2Client':
                if (this.server) {
                    this.log.debug(`Sending message from server to clients ${obj.message.id}: ${obj.message.state} ...`);
                    this.server.onStateChange(obj.message.id, obj.message.state);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { result: true }, obj.callback);
                    }
                }
                else if (this.client) {
                    this.log.debug(`Sending message from client to server ${obj.message.id}: ${obj.message.state} ...`);
                    this.client.onStateChange(obj.message.id, obj.message.state);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { result: 'Sending message from client to server.' }, obj.callback);
                    }
                }
                else {
                    this.log.debug(`Neither MQTT server nor client not started, thus not sending message to client ${obj.message.id} (${obj.message.state}).`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: 'Neither MQTT server nor client not started' }, obj.callback);
                    }
                }
                break;
            case 'test': {
                // Try to connect to mqtt broker
                if (obj.callback && obj.message) {
                    const _url = `mqtt${obj.message.ssl ? 's' : ''}://${obj.message.user ? `${obj.message.user}:${obj.message.pass}@` : ''}${obj.message.url}${obj.message.port ? `:${obj.message.port}` : ''}?clientId=ioBroker.${this.namespace}`;
                    const _client = (0, mqtt_1.connect)(_url);
                    // Set timeout for connection
                    const timeout = setTimeout(() => {
                        _client.end();
                        this.sendTo(obj.from, obj.command, 'timeout', obj.callback);
                    }, 2000);
                    // If connected, return success
                    _client.on('connect', () => {
                        _client.end();
                        clearTimeout(timeout);
                        this.sendTo(obj.from, obj.command, 'connected', obj.callback);
                    });
                    // If connected, return success
                    _client.on('error', (err) => {
                        _client.end();
                        clearTimeout(timeout);
                        this.log.warn(`Error on mqtt test: ${err}`);
                        this.sendTo(obj.from, obj.command, 'error', obj.callback);
                    });
                }
            }
        }
    }
    onStateChange(id, state) {
        this.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
        // State deleted
        if (!state) {
            delete this.states[id];
            // If SERVER
            this.server?.onStateChange(id, undefined);
            // if CLIENT
            this.client?.onStateChange(id, undefined);
        }
        else if ((this.config.sendAckToo || !state.ack) && !this.messageboxRegex.test(id)) {
            // you can use the ack flag to detect if state is desired or acknowledged
            const oldVal = this.states[id] ? this.states[id].val : null;
            const oldAck = this.states[id] ? this.states[id].ack : null;
            this.states[id] = state;
            // If value really changed
            if (!this.config.onchange || oldVal !== state.val || oldAck !== state.ack) {
                // If SERVER
                this.server?.onStateChange(id, state);
                // if CLIENT
                this.client?.onStateChange(id, state);
            }
        }
    }
    onUnload(callback) {
        if (this.checkTimeout) {
            clearTimeout(this.checkTimeout);
            this.checkTimeout = null;
        }
        try {
            this.client?.destroy();
            this.server?.destroy();
            callback();
        }
        catch {
            callback();
        }
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new MQTT(options);
}
else {
    // otherwise start the instance directly
    (() => new MQTT())();
}
//# sourceMappingURL=main.js.map