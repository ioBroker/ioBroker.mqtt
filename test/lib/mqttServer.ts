// @ts-expect-error no types
import mqtt from 'mqtt-connection';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as http from 'node:http';
import * as https from 'node:https';
import { Server as WsServer } from 'ws';
import wsStream from 'websocket-stream';

interface MqttServerConfig {
    port?: number;
    user?: string;
    pass?: string;
    dontSend?: boolean;
    webSocket?: boolean;
}

interface ConnectPacket {
    clientId: string;
    username?: string;
    password?: Buffer;
}

interface PublishPacket {
    topic: string;
    payload: Buffer | string;
}

interface SubscribePacket {
    subscriptions: { topic: string; qos: number }[];
    messageId: number;
}

/** Minimal shape of a `mqtt-connection` connection (the package ships no types). */
interface MqttConnection {
    id: string;
    stream: { end: () => void };
    connack(packet: { returnCode: number }): void;
    publish(packet: { topic: string; payload: string | Buffer }): void;
    suback(packet: { granted: number[]; messageId: number }): void;
    pingresp(): void;
    destroy(): void;
    on(event: 'connect', listener: (packet: ConnectPacket) => void): void;
    on(event: 'publish', listener: (packet: PublishPacket) => void): void;
    on(event: 'subscribe', listener: (packet: SubscribePacket) => void): void;
    on(event: 'pingreq' | 'disconnect' | 'close', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
}

/**
 * A server that emits `connection`. The payload is a `net.Socket` for a plain/TLS server but a
 * `ws.WebSocket` for the WebSocket server, so it stays untyped (as in the adapter itself).
 */
interface ConnectionSocket {
    on(event: 'connection', listener: (stream: any) => void): void;
}

/** A server that can be told to listen on a port (net/tls/http/https — the ws server delegates to http). */
interface Listenable {
    listen(port: number, hostname: string, listeningListener?: () => void): void;
}

const sslOptions = {
    key: '-----BEGIN PRIVATE KEY-----\r\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCmC3XEYAxHplhL\r\n5rTn429sy6od7/XfylFeHhz+PPIMz801pIT5zDq+23qjDBhzFoCswI9PGOh7sa3k\r\n3C7gHrvQQieIoUkCcEcv3wKNZy1rs8zqQDMfcsIefRO/0lWHkBHCyYlww7a7byVh\r\n+L9Bfd6gI6zFOXFKprr8NCax0qh/eVHthhHC+9Nx71Uxf0wOSoOKry0mh18twV+K\r\n9l6M5uyo8rVqu20H2KzHdsRqYYd882mZIn99WN+aH9kfLZ8MtUoGwwXUa/q7FqkW\r\nQtlLAX05+huQnajqUeQfKABsjuxMtQMfnc60lM6icrS/DyBDZHmZ8NqSZYEJuKWr\r\nlZ/HC/CbAgMBAAECggEAUT0dJvG5QFsGK0iarTPNAeVZe6E6Yn5Jtis0kz09TgBj\r\njgHK367I9TVL+LcDxVc2qI7j7taodFB33JfPxW60BE5BqmsC3hMR+T16sbVP9zh2\r\nowu7F4FdsW4PuhPOLe/SiMNzH71Zy7WzDA6YgJH1WNNrhek3YUdXB+r6HZmMQCVR\r\nK92eRgrDYTSlA3bhnBirzCwWXqpW7mob5muk0uivwXrjeLDIEzj2XJEkzHIZbhMm\r\n39kjh5fnm69MAjvXTgPegWwY0pxrvKG86ITBE0U7zKWCeLhZSUGRNO5gERA2Qerv\r\nPFsQp2KU2KFmjBk6RXulOGEfjj/g2F1IoSw9N4+mgQKBgQDP2qGqQAOWzCvKbec9\r\n4sqsiDyAFIG7cZxhRcvuuKW0eYPgRMRhbJdR90kj1qcZfpSN0atpLs7l4EtOfkXi\r\nPyZIrKlDMNaY3uwUTQL2ZHjB1uz02Wcv95eMzDBqFOlTKi+91vr8Owl8UivB3jFq\r\nDUgrAPeBvZRi6ZX9vNbP1mkDGwKBgQDMgZ1dzUiZfBFT14TGDCb954f4A2jpJR7e\r\n/jRWw2J6p2r+JBtTekHrwb5H4AkGNJe0T4r0wKhQDyWj+B5e/0fvtY0tfnPRsrvq\r\nerbs9st8IJxenwPWpX4kit6rZXwYY6nrZw9vZyKss6KI41W7G5nFwtvc6gK7oEm8\r\nvS+xkRoggQKBgB5v+K6SszPY8CyzjWJNnLpJNPrYherqByljbCqoFXPpO3uS9mMB\r\n4OLa4HYED/I2zBA8fOppNVkKUFzNNvSbpMKNrjetpi86rb2HTYDBU8Gm9Ioib+7h\r\nResTV5+hMk3AZr9ZBOX8yzXOXqQEIp5SFZheiuAP3/PgGtvOVHKZBkWzAoGAUvUt\r\nOfThQ2nBuaoOcSxS0OKQFHqFnzXwrPKflqaRl0G8tDU/ZICOpy0jnBJ0drD07S7r\r\nJlfUrw1F7pri7xRNQR77kv3dy63ebsKy27NNXh/4bqXAr9zYK8ithQeY7GfZcOWQ\r\nrFdBCJ+iCjd1+n26xi9Ccv32d9gQsWBpLXW4DIECgYAU1O5Briof/By/SWUgJxYW\r\nCQ0ZhtYYUL5ccPSNsTt/QChSx4gO/fdiPZ7dPFPfp704piJ6j5c7syLMx+DNzaU7\r\n/ux+K1/F72za0hbHyrHKd882FQF+r6sx8LwAsVaeUhOyGdVtCRe0KZWCfWcNo/jd\r\n93WCEG5QIrmHo0+aBFlApg==\r\n-----END PRIVATE KEY-----\r\n',
    cert: '-----BEGIN CERTIFICATE-----\r\nMIID6zCCAtOgAwIBAgIUfT1evl7ceg8g0/SJvhmSSw1KmEEwDQYJKoZIhvcNAQEL\r\nBQAwgYQxCzAJBgNVBAYTAkRFMRowGAYDVQQIDBFCYWRlbld1ZXJ0dGVtYmVyZzES\r\nMBAGA1UEBwwJS2FybHNydWhlMREwDwYDVQQKDAhpb0Jyb2tlcjEQMA4GA1UEAwwH\r\nQmx1ZWZveDEgMB4GCSqGSIb3DQEJARYRZG9nYWZveEBnbWFpbC5jb20wHhcNMjUw\r\nOTEyMTkwMzQwWhcNMzUwOTEwMTkwMzQwWjCBhDELMAkGA1UEBhMCREUxGjAYBgNV\r\nBAgMEUJhZGVuV3VlcnR0ZW1iZXJnMRIwEAYDVQQHDAlLYXJsc3J1aGUxETAPBgNV\r\nBAoMCGlvQnJva2VyMRAwDgYDVQQDDAdCbHVlZm94MSAwHgYJKoZIhvcNAQkBFhFk\r\nb2dhZm94QGdtYWlsLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB\r\nAKYLdcRgDEemWEvmtOfjb2zLqh3v9d/KUV4eHP488gzPzTWkhPnMOr7beqMMGHMW\r\ngKzAj08Y6HuxreTcLuAeu9BCJ4ihSQJwRy/fAo1nLWuzzOpAMx9ywh59E7/SVYeQ\r\nEcLJiXDDtrtvJWH4v0F93qAjrMU5cUqmuvw0JrHSqH95Ue2GEcL703HvVTF/TA5K\r\ng4qvLSaHXy3BX4r2Xozm7KjytWq7bQfYrMd2xGphh3zzaZkif31Y35of2R8tnwy1\r\nSgbDBdRr+rsWqRZC2UsBfTn6G5CdqOpR5B8oAGyO7Ey1Ax+dzrSUzqJytL8PIENk\r\neZnw2pJlgQm4pauVn8cL8JsCAwEAAaNTMFEwHQYDVR0OBBYEFMl8HBb5yhG4aMPp\r\nK0ACsOXb5ryKMB8GA1UdIwQYMBaAFMl8HBb5yhG4aMPpK0ACsOXb5ryKMA8GA1Ud\r\nEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAFSIeVmsLM6be7c0XU6M7NlM\r\nx6Pil1alp+7jaB6GjVB4zTuxBdF3E2QpZbG0fn9Q8U9AKl9KPyfqoL5GyvZnIb43\r\nKXXn8CzHAQ4bJuUvn8x8kdYAtGRnwouPoC36Wvp4R3fUSogOx/31XDcqYfuDQjBn\r\nm7ZPV23WWjvdU2U+Ua6P1zQtSwmziL/qjrGDJFXjHWs4XtHxYXlLoG8Hzf8mqE5e\r\n9apeWwGfONfDBQPpfzHYz9+nkOVqgN/QY6KxTJy/USrMtHOeupdpkmH94Fdf8yfq\r\nr4+IRndloFtKdsXQkYaStBGvryYsdMOF2S7PM7ekP/YRTU/y8f1uPmH68y5L4HU=\r\n-----END CERTIFICATE-----\r\n',
};

export default class MqttServerEmulator {
    #clients: Record<string, MqttConnection> = {};
    #config: MqttServerConfig;
    #server: net.Server | tls.Server | null = null;
    #serverForWs: http.Server | https.Server | null = null;

    constructor(config?: MqttServerConfig) {
        this.#config = config || {};
        this.start();
    }

    #startServer(
        socket: ConnectionSocket,
        listenTarget: Listenable,
        port: number,
        bind: string,
        ssl: boolean,
        ws: boolean,
    ): void {
        const config = this.#config;
        const clients = this.#clients;

        socket.on('connection', stream => {
            const client: MqttConnection = ws ? mqtt(wsStream(stream)) : mqtt(stream);

            client.on('connect', packet => {
                client.id = packet.clientId;
                clients[client.id] = client;
                if (config.user) {
                    if (config.user !== packet.username || config.pass !== packet.password?.toString()) {
                        console.error(
                            `Client [${packet.clientId}] has invalid password(${(packet.password || '').length} chars) or username(${packet.username})`,
                        );
                        client.connack({ returnCode: 4 });
                        if (clients[client.id]) {
                            delete clients[client.id];
                        }
                        client.stream.end();
                        return;
                    }
                }
                console.log(
                    `Client [${packet.clientId}] connected: user - ${packet.username}, pass - ${(packet.password || '').length} chars`,
                );
                client.connack({ returnCode: 0 });

                if (!config.dontSend) {
                    client.publish({ topic: 'testServer/connected', payload: 'true' });
                    client.publish({ topic: 'testServer/long/test/path/into/ioBroker/connected', payload: 'true' });
                }
            });

            client.on('publish', packet => {
                console.log(`Client [${client.id}] publishes "${packet.topic}": ${packet.payload.toString()}`);
                for (const k in clients) {
                    clients[k].publish({ topic: packet.topic, payload: packet.payload });
                }
            });

            client.on('subscribe', packet => {
                const granted: number[] = [];
                console.log(`Client [${client.id}] subscribes on "${JSON.stringify(packet.subscriptions)}"`);
                for (let i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);
                }
                client.suback({ granted, messageId: packet.messageId });
            });

            client.on('pingreq', () => {
                console.log(`Client [${client.id}] pingreq`);
                client.pingresp();
            });

            client.on('disconnect', () => {
                if (clients[client.id]) {
                    delete clients[client.id];
                }
                console.log(`Client [${client.id}] disconnected`);
                client.stream.end();
            });

            client.on('close', () => {
                if (clients[client.id]) {
                    delete clients[client.id];
                }
                console.log(`Client [${client.id}] closed`);
            });

            client.on('error', err => {
                if (clients[client.id]) {
                    delete clients[client.id];
                }
                console.log(`[${client.id}] ${err}`);
                client.stream.end();
            });
        });

        listenTarget.listen(port, bind, () =>
            console.log(`Starting MQTT${!ws ? '' : '-WebSocket'}${ssl ? ' (Secure)' : ''} server on port ${port}`),
        );
    }

    start(): void {
        const config = this.#config;
        const port = config.port || 1883;
        const ssl = process.argv[2] === 'ssl';

        // for non-ssl a plain net server, for ssl a tls server (net/http ignore the key/cert options)
        const server = ssl ? new tls.Server(sslOptions) : new net.Server();
        this.#server = server;
        this.#startServer(server, server, port, '127.0.0.1', ssl, false);

        // ssl always uses https; plain WebSocket only when explicitly enabled, otherwise https
        const httpServer = ssl || !config.webSocket ? https.createServer(sslOptions) : http.createServer();
        this.#serverForWs = httpServer;
        const serverWs = new WsServer({ server: httpServer });

        this.#startServer(serverWs, httpServer, port + 1, '127.0.0.1', ssl, true);
    }

    stop(cb?: () => void): void {
        // destroy all clients (this will emit the 'close' event above)
        for (const i in this.#clients) {
            this.#clients[i].destroy();
        }

        if (this.#server) {
            this.#server.close(() => {
                console.log('Server closed.');
                this.#server?.unref();
                this.#server = null;
                cb?.();
            });
        }

        if (this.#serverForWs) {
            this.#serverForWs.close(() => {
                console.log('WS-Server closed.');
                this.#serverForWs?.unref();
                this.#serverForWs = null;
            });
        }
    }
}
