import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { parser as createParser, writeToStream, type Packet, type Parser } from 'mqtt-packet';

/** MQTT protocol levels: 3 = MQTT 3.1, 4 = MQTT 3.1.1, 5 = MQTT 5.0 */
export type MqttProtocolVersion = 3 | 4 | 5;

/**
 * MQTT 3.1.1 CONNACK return codes mapped to their MQTT 5.0 CONNACK reason codes.
 * The adapter keeps using the 3.1.1 codes internally; this table translates them
 * when the peer speaks MQTT 5 (see MQTT-5.0 3.2.2.2).
 */
const CONNACK_RETURN_CODE_TO_REASON_CODE: Record<number, number> = {
    0: 0x00, // accepted / success
    1: 0x84, // unacceptable protocol version → unsupported protocol version
    2: 0x85, // identifier rejected → client identifier not valid
    3: 0x88, // server unavailable
    4: 0x86, // bad user name or password
    5: 0x87, // not authorized
};

/** The packets a broker (or the test broker emulator) can send. */
type OutgoingPacket = Record<string, any>;

/** A CONNACK in the MQTT 3.1.1 shape; `reasonCode` is filled in for MQTT 5 peers. */
export interface ConnackPacket {
    returnCode?: number;
    reasonCode?: number;
    sessionPresent?: boolean;
    properties?: Record<string, any>;
}

/** A SUBACK. `granted` holds the accepted QoS per topic, or 0x80 for a rejected subscription. */
export interface SubackPacket {
    messageId: number;
    granted: number[];
    properties?: Record<string, any>;
}

/** An UNSUBACK. `count` is the number of unsubscribed topics, needed for the MQTT 5 reason codes. */
export interface UnsubackPacket {
    messageId: number;
    granted?: number[];
    count?: number;
}

/** A broker side DISCONNECT, which only MQTT 5 allows. */
export interface DisconnectPacket {
    reasonCode?: number;
    properties?: Record<string, any>;
}

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
export default class MqttConnection extends EventEmitter {
    /** The underlying socket. `remoteAddress` / `remotePort` are read from it for the client objects. */
    public readonly stream: any;

    /** Protocol level of this connection, taken from its CONNECT packet. Defaults to MQTT 3.1.1. */
    public protocolVersion: MqttProtocolVersion = 4;

    /**
     * Largest packet the peer accepts (MQTT 5 "Maximum Packet Size", MQTT-5.0 3.1.2.11.4).
     * `undefined` means no limit was announced.
     */
    public maximumPacketSize: number | undefined;

    private readonly parser: Parser;
    private destroyed = false;
    private closeEmitted = false;

    constructor(stream: Duplex) {
        super();
        this.stream = stream;
        // The parser adopts the CONNECT packet as its settings, so everything that follows is
        // parsed with the protocol level the client announced.
        this.parser = createParser({ protocolVersion: 4 });

        this.parser.on('packet', (packet: Packet): void => {
            if (packet.cmd === 'connect') {
                const connect = packet as {
                    protocolVersion?: number;
                    properties?: { maximumPacketSize?: number };
                };
                this.setProtocolVersion(connect.protocolVersion);
                this.maximumPacketSize = connect.properties?.maximumPacketSize || undefined;
            }
            this.emit(packet.cmd, packet);
        });

        this.parser.on('error', (error: Error): void => {
            this.emit('error', error);
        });

        stream.on('error', (error: Error): void => {
            this.emit('error', error);
        });
        stream.on('close', (hadError?: boolean): void => this.onClose(hadError));
        stream.on('end', (): void => this.onClose(false));

        // A stream without a "data" listener stays paused, so nothing is lost by deferring:
        // the caller gets the chance to attach its listeners before the first packet is emitted.
        process.nextTick((): void => {
            if (!this.destroyed) {
                stream.on('data', (chunk: Buffer): void => {
                    this.parser.parse(chunk);
                });
            }
        });
    }

    /**
     * Applies the protocol level of this connection to the parser as well, so incoming packets are
     * read with the same version they are written with.
     *
     * @param version The protocol level from a CONNECT packet
     */
    private setProtocolVersion(version: number | undefined): void {
        if (version !== 3 && version !== 4 && version !== 5) {
            return;
        }
        this.protocolVersion = version;
        const settings = (this.parser as unknown as { settings?: { protocolVersion?: number } }).settings;
        if (settings) {
            settings.protocolVersion = version;
        }
    }

    private onClose(hadError?: boolean): void {
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
    private send(cmd: string, packet: OutgoingPacket): void {
        if (this.destroyed || this.stream.writable === false) {
            return;
        }
        packet.cmd = cmd;

        if (this.exceedsMaximumPacketSize(packet)) {
            // The peer announced a limit and told us to drop anything above it, so this is not an
            // error but the agreed behaviour (MQTT-5.0 3.1.2.11.4).
            this.emit('packetTooLarge', packet);
            return;
        }

        try {
            writeToStream(packet as Packet, this.stream, {
                protocolVersion: this.protocolVersion,
                // mqtt-packet uses this to drop optional properties that would not fit
                properties: this.maximumPacketSize ? { maximumPacketSize: this.maximumPacketSize } : undefined,
            });
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Estimates whether a packet would be larger than what the peer announced it accepts.
     *
     * `mqtt-packet` only drops optional properties to stay below the limit and ignores the payload,
     * so the payload has to be checked here. The estimate is deliberately generous: rejecting a
     * message that would have fit is worse than sending one slightly over a limit nobody enforces.
     *
     * @param packet The packet that is about to be written
     * @returns Whether it must not be sent
     */
    private exceedsMaximumPacketSize(packet: OutgoingPacket): boolean {
        if (!this.maximumPacketSize || packet.cmd !== 'publish') {
            return false;
        }

        const payload: unknown = packet.payload;
        const payloadLength =
            typeof payload === 'string' ? Buffer.byteLength(payload) : Buffer.isBuffer(payload) ? payload.length : 0;

        // fixed header + remaining length + topic length prefix + topic + message id
        const overhead = 5 + 2 + Buffer.byteLength(`${packet.topic ?? ''}`) + (packet.qos ? 2 : 0);

        return overhead + payloadLength > this.maximumPacketSize;
    }

    // --- broker → client -------------------------------------------------------------------

    /**
     * Sends a CONNACK. Callers pass the MQTT 3.1.1 `returnCode`; for a MQTT 5 peer it is
     * translated into the corresponding reason code.
     *
     * @param packet The CONNACK to send
     */
    connack(packet: ConnackPacket): void {
        const code = packet.reasonCode ?? packet.returnCode ?? 0;

        if (this.protocolVersion === 5) {
            const { returnCode, ...rest } = packet;
            this.send('connack', {
                ...rest,
                reasonCode: packet.reasonCode ?? CONNACK_RETURN_CODE_TO_REASON_CODE[code] ?? 0x80,
            });
        } else {
            const { reasonCode, properties, ...rest } = packet;
            this.send('connack', { ...rest, returnCode: code });
        }
    }

    publish(packet: OutgoingPacket): void {
        this.send('publish', packet);
    }

    puback(packet: OutgoingPacket): void {
        this.send('puback', this.withReasonCode(packet));
    }

    pubrec(packet: OutgoingPacket): void {
        this.send('pubrec', this.withReasonCode(packet));
    }

    pubrel(packet: OutgoingPacket): void {
        this.send('pubrel', this.withReasonCode(packet));
    }

    pubcomp(packet: OutgoingPacket): void {
        this.send('pubcomp', this.withReasonCode(packet));
    }

    suback(packet: SubackPacket): void {
        this.send('suback', packet);
    }

    /**
     * Sends an UNSUBACK. MQTT 5 requires one reason code per unsubscribed topic, MQTT 3.1.1 has
     * no payload at all, so the codes are filled in here when the caller did not provide them.
     *
     * @param packet The UNSUBACK to send; `count` is the number of unsubscribed topics
     */
    unsuback(packet: UnsubackPacket): void {
        const { count, ...rest } = packet;

        if (this.protocolVersion === 5) {
            this.send('unsuback', {
                ...rest,
                granted: packet.granted ?? new Array<number>(Math.max(count ?? 1, 1)).fill(0x00),
            });
        } else {
            this.send('unsuback', { messageId: packet.messageId });
        }
    }

    pingresp(): void {
        this.send('pingresp', {});
    }

    /**
     * Sends a DISCONNECT. Only MQTT 5 allows a broker to send one; for older peers the caller
     * has to fall back to simply closing the socket.
     *
     * @param packet The reason the connection is closed
     */
    disconnect(packet: DisconnectPacket = {}): void {
        if (this.protocolVersion !== 5) {
            return;
        }
        this.send('disconnect', { reasonCode: packet.reasonCode ?? 0x00, ...packet });
    }

    auth(packet: OutgoingPacket): void {
        this.send('auth', packet);
    }

    // --- client → broker (used by the test broker emulator and the connection tests) ---------

    /**
     * Sends a CONNECT. Used when this class acts as a client — the test broker emulator and the
     * protocol level tests do. The protocol level of a connection normally comes from the CONNECT
     * that is *received*, so when we send one it has to be adopted from there instead, otherwise
     * everything that follows would be parsed and written as MQTT 3.1.1.
     *
     * @param packet The CONNECT to send
     */
    connect(packet: OutgoingPacket): void {
        this.setProtocolVersion(packet.protocolVersion as number | undefined);
        this.send('connect', packet);
    }

    subscribe(packet: OutgoingPacket): void {
        this.send('subscribe', packet);
    }

    unsubscribe(packet: OutgoingPacket): void {
        this.send('unsubscribe', packet);
    }

    pingreq(): void {
        this.send('pingreq', {});
    }

    /**
     * Closes the connection after everything that was written has left the socket.
     *
     * `destroy()` tears the socket down immediately and throws away whatever is still buffered, so
     * a rejection that was just written would never reach the peer. Whenever a last packet has to
     * arrive — a CONNACK with an error, a DISCONNECT with a reason code — this is the way to close.
     */
    close(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;

        if (typeof this.stream.end === 'function') {
            this.stream.end(() => this.stream.destroy?.());
        } else {
            this.stream.destroy?.();
        }
    }

    /** Closes the connection immediately, dropping anything that is still buffered. */
    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        if (typeof this.stream.destroy === 'function') {
            this.stream.destroy();
        } else {
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
    private withReasonCode(packet: OutgoingPacket): OutgoingPacket {
        if (this.protocolVersion === 5 && typeof packet.reasonCode !== 'number') {
            packet.reasonCode = 0x00;
        }
        return packet;
    }
}
