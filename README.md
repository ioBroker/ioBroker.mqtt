<img src="admin/mqtt.svg" width="100" height="100">

# ioBroker MQTT

![Number of Installations](https://iobroker.live/badges/mqtt-installed.svg)
![Number of Installations](https://iobroker.live/badges/mqtt-stable.svg)
[![NPM version](https://img.shields.io/npm/v/iobroker.mqtt.svg)](https://www.npmjs.com/package/iobroker.mqtt)

![Test and Release](https://github.com/ioBroker/ioBroker.mqtt/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/mqtt/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.mqtt.svg)](https://www.npmjs.com/package/iobroker.mqtt)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting, see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## MQ Telemetry Transport for ioBroker (MQTT).

MQTT (formerly Message Queue Telemetry Transport) is a publish-subscribe based "light weight" messaging protocol for use on top of the TCP/IP protocol.
It is designed for connections with remote locations where a "small code footprint" is required and/or network bandwidth is limited.
The Publish-Subscribe messaging pattern requires a message broker. The broker is responsible for distributing messages to interested clients based on the topic of a message.
Historically, the 'MQ' in 'MQTT' came from IBM's MQ message queuing product line.

This adapter uses the MQTT.js library from [https://github.com/adamvr/MQTT.js/](https://github.com/adamvr/MQTT.js/)

## Configuration
- **Type** - Select "Client" (If you want to receive and send messages to another broker) or "Server" if you want to create own MQTT broker.

### Server settings
- **WebSockets** - if parallel to TCP Server, the WebSocket MQTT Server should run.
- **Port** - Port where the server will run (Default 1883). **WebSockets** will always run on port+1 (Default 1884)
- **SSL** - If TCP and WebSockets should run as secure server.
- **Authentication/Username** - If authentication required, you can specify the username. It is suggested to always use SSL with authentication to not send passwords over unsecure connection.  
- **Authentication/Password** - Password for user.
- **Mask to publish own states** - Pattern to filter ioBroker states, which will be sent to clients. You can use wildcards to specify a group of messages, e.g., `*.memRss, mqtt.0.*` to get all memory states of all adapters and all states of adapter `mqtt.0`
- **Publish only on change** - New messages will be sent to a client only if the state value changes. Every message sent by the client will be accepted, even if the value does not change.
- **Publish own states on connect** - by every client connection the all known states will be sent to a client (defined by the state mask), to tell him which states the ioBroker has.
- **Prefix for all topics** - if set, every sent topic will be prepended with this prefix, e.g., if prefix `iobroker/` all states will have names like `**iobroker**/mqtt/0/connected`
- **Trace output for every message** - Debug outputs.
- **Send states (ack=true) too** - Normally only the states/commands with `ack=false` will be sent to partner. If this flag is set, every state independent of ack will be sent to partner. 
- **Use different topic names for set and get** - if active, so every state will have two topics: `adapter/instance/stateName` and `adapter/instance/stateName/set`. In this case, a topic with `/set` will be used to send non acknowledged commands (ack: false) and topic without `/set` to receive state updates (with ack: true). The client will receive sent messages back in this mode.
- **Interval before send topics by connection** - Pause between connection and when all topics will be sent to a client (if activated).
- **Send interval** - Interval between packets by sending all topics (if activated). Used only by once after the connection establishment.
- **Force clean session** - Overwrite the client settings and clear or keep session.
- **Publish messages without "retain" flag** - Send messages to other clients without a retain flag (read more in next paragraph)
- **Ignored Topics** - You can provide certain topics that will be ignored by the broker. This is useful if you want to reduce some chatty clients. You can use wildcards to specify multiple topics, e.g. `test.*`.

The ioBroker MQTT-Broker in server mode only simulates the behavior of real MQTT-Broker (like Mosquitto), but it is not the same.
Real MQTT-Broker normally does not save the values of the topics and just forwards the message to other subscribed clients.

To force real MQTT-Broker to behave like ioBroker MQTT-Broker, all messages must be sent with "retain" flag. 
In this case, the values will be stored too.

ioBroker MQTT-Broker always saves the values into the States-DB, so it can be processed by other adapters. 
Because of that, the messages are always published with a retain flag.

If your client has problems with retained messages, you can force ioBroker MQTT-Broker to send messages without a retain flag with `Publish messages without "retain" flag` option.
In this case, the messages will be stored in States-DB anyway. 

If the option `Send states (ack=true) too` is not activated, so you can clear the value of the topic (state) with `ack=true` and the update will not be sent to subscribed clients.
And when the client connects next time, it will not get the last command again.

The JS-Code should look like this: 
```
await setStateAsync('mqtt.0.valetudo.vale.BasicControlCapability.operation.set', 'cleanStart'); // ack=false
await setStateAsync('mqtt.0.valetudo.vale.BasicControlCapability.operation.set', '', true); // ack=true to clear the command
```

### Client settings
- **URL** - name or ip address of the broker/server. Like `localhost`.
- **Port** - Port of the MQTT broker. By default, 1883
- **Secure** - If secure (SSL) connection must be used.
- **User** - if broker required authentication, define here the username.
- **Password** - if the username is not empty, the password must be set. It can be empty.
- **Password confirmation** - repeat here the password.
- **Subscribe Patterns** - Subscribe by the pattern. See chapter "Examples of using wildcards" to define the pattern. '#' to subscribe for all topics. `mqtt/0/#,javascript/#` to subscribe for states of `mqtt.0` and `javascript`
- **Publish only on change** - Store incoming messages only if payload differs from actual stored.
- **Mask to publish own states** - Mask for states, that must be published to broker. '*' - to publish all states. 'io.yr.*,io.hm-rpc.0.*' to publish states of `yr` and `hm-rpc` adapter.  
- **Publish all states at start** - Publish all states (defined by the state mask) every time by connection establishment to announce own available states and their values.
- **Prefix for topics** - The prefix can be defined for own states. Like `/var/ioBroker/`. Name of topics will be for example published with the name `/var/ioBroker/ping/192-168-1-5`.
- **Test connection** - Press the button to check the connection to broker. Adapter must be enabled before.
- **Send states (ack=true) too** - Normally only the states/commands with `ack=false` will be sent to partner. If this flag is set, every state independent of ack will be sent to a partner. 
- **Use different topic names for set and get** - if active, so every state will have two topics: `adapter/instance/stateName` and `adapter/instance/stateName/set`. In this case, a topic with `/set` will be used to send non acknowledged commands (ack: false) and topic without `/set` to receive state updates (with ack: true).
- **Send state object as mqtt message** - The client sends the states as parsed string JSON objects to the broker (example parsed string JSON object: `{"val":true,"ack":true,"ts":1584690242021,"q":0,"from":"system.adapter.deconz.0","user":"system.user.admin","lc":1584624242021,"expire":true}`); if not the values `states.val` is sent as a single value (example state.val as single value: `true`)
- **Persistent Session** - When checked, the broker saves the session information of the adapter. This means it tracks which messages have been sent/received by the adapter (only QoS Level 1 and 2) and to which topics the adapter has subscribed. This information survives a disconnect and reconnect of the adapter.

## Usage

### How to test mqtt client:
- Set type to `Client`.
- Leave port on 1883.
- Set URL as `broker.mqttdashboard.com`
- To get absolutely all topics(messages) set pattern to `#`.
- To receive all topics for `/4MS` set pattern to `/4MS/#`
- To receive all topics for `/MS` and `/floorish` set pattern to `/4MS/#, /floorish/#`

### Sending messages
You may send / publish messages on topics using `sendTo` method from your adapter via MQTT adapter, e.g.:

```javascript
/*
 * @param {string}  MQTT instance     Specify MQTT instance to send message through (may be either server or client)
 * @param {string}  action            Action to use (always 'sendMessage2Client' for sending plain messages)
 * @param {object}  payload         
 * @param {string}  payload.topic     Topic to publish message on
 * @param {string}  payload.message   Message to be published on specified topic
 *
 */
adapter.sendTo('mqtt.0', 'sendMessage2Client', { topic: 'your/topic/here', message: 'your message', retain: true });
```

### Examples of using wildcards
The following examples on the use of wildcards, builds on the example provided in topic strings.

- `Sport`
- `Sport/Tennis`
- `Sport/Basketball`
- `Sport/Swimming`
- `Sport/Tennis/Finals`
- `Sport/Basketball/Finals`
- `Sport/Swimming/Finals`

If you want to subscribe to all Tennis topics, you can use the number sign `#`, or the plus sign `+`.

- `Sport/Tennis/#` (this will receive `Sport/Tennis` and `Sport/Tennis/Finals`)
- `Sport/Tennis/+` (this will receive `Sport/Tennis/Finals` but not `Sport/Tennis`)

For JMS topics, if you want to subscribe to all Finals topics, you can use the number sign `#`, or the plus sign `+`.

- `Sport/#/Finals`
- `Sport/+/Finals`

For MQTT topics, if you want to subscribe to all Finals topics, you can use the plus sign `+`.

`Sport/+/Finals`

### Binary messages
With version 4.x, there is a possibility to send and receive binary messages.
**Send works only with js-controller@4.2 or newer.**

You can change manually the `common.type` of existing objects to `file` and they will be processed as binary states.

Or you can set the options *All new topics will be processed as binary** in the instance settings to force all new topics will have automatically `common.type="file"`.

### Tests
The broker was tested with the following clients:

- http://mitsuruog.github.io/what-mqtt/
- http://mqttfx.jfx4ee.org/
- http://www.eclipse.org/paho/clients/tool/

### Client objects
In server mode, the mqtt broker creates for every connected client the corresponding object in the ioBroker. The object will be created with the name `mqtt.0.info.clients.<clientId>`. The clientId is the unique identifier of the client.

You can disable the creation of the client objects in the instance settings. (**Do not create client objects**)

Note: If you have some client that connects and disconnects very often, the list of client objects will not be updated at all.

## Todo
* Implement resend of `QoS 2` messages after a while.
  Whenever a packet gets lost on the way, the sender is responsible for resending the last message after a reasonable amount of time. This is true when the sender is a MQTT client and also when a MQTT broker sends a message.

* queue packets with `QoS 1/2` for the offline clients with the persistent session.
  [Read here](https://www.hivemq.com/blog/mqtt-essentials-part-7-persistent-session-queuing-messages)

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

## Changelog
### **WORK IN PROGRESS**
* (bluefox) Allowed disabling the client objects creation
* (bluefox) Create client objects with timeout (1s) to prevent memory leaks

### 6.1.3 (2025-05-04)
* (Code-X77) Corrected TLS communication
* (bluefox) Packages updated

### 6.1.2 (2024-09-04)
* (bluefox) Corrected error if the client has no ID

### 6.1.1 (2024-08-29)
* (bluefox) Added information about connected clients in the server mode

### 6.0.2 (2024-08-13)
* (bluefox) Added a space to the connection string for better readability

### 6.0.1 (2024-08-06)
* (foxriver76) remove binary state handling as these are no longer existing
* (klein0r) handle the messages as a state object if properties are valid

## License

The MIT License (MIT)

Copyright (c) 2014-2025, bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
