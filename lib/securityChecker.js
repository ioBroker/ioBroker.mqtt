const https = require('https');
const mqtt = require('mqtt');

function _getPublicIP() {
    return new Promise((resolve, reject) => {
        https
            .get('https://ip.iobroker.in', res => {
                const data = [];

                res.on('data', chunk => data.push(chunk));

                res.on('end', () => resolve(Buffer.concat(data).toString()));
            })
            .on('error', err => reject(err.message));
    });
}

function _checkMqttServer(url) {
    return new Promise((resolve, reject) => {
        const opts = {
            clientId: 'ioBrokerChecker',
            keepalive: 1, /* in seconds */
            protocolId: 'MQTT',
            protocolVersion: 4,
            reconnectPeriod: 30 * 1000, /* in milliseconds */
            connectTimeout: 2 * 1000, /* in milliseconds */
            clean: true,
            rejectUnauthorized: false /* added option to disable certification validation */
        };

        let client = mqtt.connect(url, opts);
        client.on('connect', () => {
            if (client) {
                try {
                    client.end();
                } catch (e) {
                    // ignore error
                }
                client = null;
                reject(`Your MQTT server is reachable from internet without protection under "${url}"`);
            }
        });
        client.on('error', () => {
            if (client) {
                try {
                    client.end();
                } catch (e) {
                    // ignore error
                }
                client = null;
                resolve();
            }
        });

        client.on('close', () => {
            if (client) {
                client = null;
                resolve();
            }
        });
    });
}

/**
 * Checks public IP address of the server and tries to connect to it.
 * Throws error if connection is possible.
 */
async function checkPublicIP(port, secure) {
    if (typeof port === 'string') {
        port = parseInt(port, 10);
    }
    let publicIP;
    // we check the public ip address of the server
    try {
        publicIP = await _getPublicIP();
    } catch (e) {
        // Ignore. We just don't know the public IP
    }

    if (publicIP) {
        // check http://publicIP:port
        await _checkMqttServer(`${secure ? 'mqtts' : 'mqtt'}://${publicIP}${port ? `:${port}` : ''}`);

        // check http://publicIP:80
        if (!secure && port !== 1883) {
            await _checkMqttServer(`mqtt://${publicIP}:1883`);
        }
        if (port !== 8883) {
            await _checkMqttServer(`mqtts://${publicIP}:8883`);
        }
    }
}

module.exports = {
    checkPublicIP,
};