"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_events_1 = require("node:events");
const mqtt_packet_1 = require("mqtt-packet");
/**
 * MQTT 3.1.1 CONNACK return codes mapped to their MQTT 5.0 CONNACK reason codes.
 * The adapter keeps using the 3.1.1 codes internally; this table translates them
 * when the peer speaks MQTT 5 (see MQTT-5.0 3.2.2.2).
 */
const CONNACK_RETURN_CODE_TO_REASON_CODE = {
    0: 0x00, // accepted / success
    1: 0x84, // unacceptable protocol version → unsupported protocol version
    2: 0x85, // identifier rejected → client identifier not valid
    3: 0x88, // server unavailable
    4: 0x86, // bad user name or password
    5: 0x87, // not authorized
};
/**
 * A single MQTT connection on top of a TCP/TLS socket or a WebSocket duplex.
 *
 * This replaces the unmaintained `mqtt-connection` package, which pinned an old `mqtt-packet@6`
 * next to the `mqtt-packet@9` that `mqtt` (client mode) uses. It is API-compatible with the parts
 * of `mqtt-connection` the adapter used — incoming packets are emitted as events named after their
 * `cmd`, and every outgoing packet has a method of the same name — with two additions:
 *
 * - `protocolVersion` is taken from the CONNECT packet, so every connection can speak its own
 *   protocol level. A MQTT 5 client and a MQTT 3.1.1 client can be served at the same time.
 * - The MQTT 5 spelling of the acknowledgements is applied here, so the callers can keep passing
 *   the MQTT 3.1.1 shape (`returnCode`, no reason codes). Getting this wrong does not produce a
 *   nice error but a desynchronised byte stream, so it belongs in exactly one place.
 */
class MqttConnection extends node_events_1.EventEmitter {
    /** The underlying socket. `remoteAddress` / `remotePort` are read from it for the client objects. */
    stream;
    /** Protocol level of this connection, taken from its CONNECT packet. Defaults to MQTT 3.1.1. */
    protocolVersion = 4;
    parser;
    destroyed = false;
    closeEmitted = false;
    constructor(stream) {
        super();
        this.stream = stream;
        // The parser adopts the CONNECT packet as its settings, so everything that follows is
        // parsed with the protocol level the client announced.
        this.parser = (0, mqtt_packet_1.parser)({ protocolVersion: 4 });
        this.parser.on('packet', (packet) => {
            if (packet.cmd === 'connect') {
                const version = packet.protocolVersion;
                if (version === 3 || version === 4 || version === 5) {
                    this.protocolVersion = version;
                }
            }
            this.emit(packet.cmd, packet);
        });
        this.parser.on('error', (error) => {
            this.emit('error', error);
        });
        stream.on('error', (error) => {
            this.emit('error', error);
        });
        stream.on('close', (hadError) => this.onClose(hadError));
        stream.on('end', () => this.onClose(false));
        // A stream without a "data" listener stays paused, so nothing is lost by deferring:
        // the caller gets the chance to attach its listeners before the first packet is emitted.
        process.nextTick(() => {
            if (!this.destroyed) {
                stream.on('data', (chunk) => {
                    this.parser.parse(chunk);
                });
            }
        });
    }
    onClose(hadError) {
        this.destroyed = true;
        if (!this.closeEmitted) {
            this.closeEmitted = true;
            this.emit('close', hadError);
        }
    }
    /**
     * Serializes one packet onto the socket.
     *
     * `cmd` is written into the passed object instead of a copy, because the adapter stores the
     * message objects it hands over here and later reads `cmd` back from them to decide whether a
     * pending message has to be retransmitted as PUBLISH or as PUBREL.
     *
     * @param cmd The packet type
     * @param packet The packet to send
     */
    send(cmd, packet) {
        if (this.destroyed || this.stream.writable === false) {
            return;
        }
        packet.cmd = cmd;
        try {
            (0, mqtt_packet_1.writeToStream)(packet, this.stream, { protocolVersion: this.protocolVersion });
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    // --- broker → client -------------------------------------------------------------------
    /**
     * Sends a CONNACK. Callers pass the MQTT 3.1.1 `returnCode`; for a MQTT 5 peer it is
     * translated into the corresponding reason code.
     *
     * @param packet The CONNACK to send
     */
    connack(packet) {
        const code = packet.reasonCode ?? packet.returnCode ?? 0;
        if (this.protocolVersion === 5) {
            const { returnCode, ...rest } = packet;
            this.send('connack', {
                ...rest,
                reasonCode: packet.reasonCode ?? CONNACK_RETURN_CODE_TO_REASON_CODE[code] ?? 0x80,
            });
        }
        else {
            const { reasonCode, properties, ...rest } = packet;
            this.send('connack', { ...rest, returnCode: code });
        }
    }
    publish(packet) {
        this.send('publish', packet);
    }
    puback(packet) {
        this.send('puback', this.withReasonCode(packet));
    }
    pubrec(packet) {
        this.send('pubrec', this.withReasonCode(packet));
    }
    pubrel(packet) {
        this.send('pubrel', this.withReasonCode(packet));
    }
    pubcomp(packet) {
        this.send('pubcomp', this.withReasonCode(packet));
    }
    suback(packet) {
        this.send('suback', packet);
    }
    /**
     * Sends an UNSUBACK. MQTT 5 requires one reason code per unsubscribed topic, MQTT 3.1.1 has
     * no payload at all, so the codes are filled in here when the caller did not provide them.
     *
     * @param packet The UNSUBACK to send; `count` is the number of unsubscribed topics
     */
    unsuback(packet) {
        const { count, ...rest } = packet;
        if (this.protocolVersion === 5) {
            this.send('unsuback', {
                ...rest,
                granted: packet.granted ?? new Array(Math.max(count ?? 1, 1)).fill(0x00),
            });
        }
        else {
            this.send('unsuback', { messageId: packet.messageId });
        }
    }
    pingresp() {
        this.send('pingresp', {});
    }
    /**
     * Sends a DISCONNECT. Only MQTT 5 allows a broker to send one; for older peers the caller
     * has to fall back to simply closing the socket.
     *
     * @param packet The reason the connection is closed
     */
    disconnect(packet = {}) {
        if (this.protocolVersion !== 5) {
            return;
        }
        this.send('disconnect', { reasonCode: packet.reasonCode ?? 0x00, ...packet });
    }
    auth(packet) {
        this.send('auth', packet);
    }
    // --- client → broker (used by the test broker emulator and the connection tests) ---------
    connect(packet) {
        this.send('connect', packet);
    }
    subscribe(packet) {
        this.send('subscribe', packet);
    }
    unsubscribe(packet) {
        this.send('unsubscribe', packet);
    }
    pingreq() {
        this.send('pingreq', {});
    }
    /** Closes the connection. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        if (typeof this.stream.destroy === 'function') {
            this.stream.destroy();
        }
        else {
            this.stream.end();
        }
    }
    /**
     * MQTT 5 acknowledgements carry a reason code. `mqtt-packet` writes a wrong packet length when
     * it is missing, which desynchronises the stream, so a successful (0x00) code is filled in.
     *
     * @param packet The acknowledgement to send
     * @returns The acknowledgement, with a reason code when the peer speaks MQTT 5
     */
    withReasonCode(packet) {
        if (this.protocolVersion === 5 && typeof packet.reasonCode !== 'number') {
            packet.reasonCode = 0x00;
        }
        return packet;
    }
}
exports.default = MqttConnection;
//# sourceMappingURL=MqttConnection.js.map