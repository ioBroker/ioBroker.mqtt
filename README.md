![Logo](admin/mqtt.png)
ioBroker MQTT Adapter
==============

# MQ Telemetry Transport for ioBroker (MQTT).

MQTT (formerly Message Queue Telemetry Transport) is a publish-subscribe based "light weight" messaging protocol for use on top of the TCP/IP protocol.
It is designed for connections with remote locations where a "small code footprint" is required and/or network bandwidth is limited.
The Publish-Subscribe messaging pattern requires a message broker. The broker is responsible for distributing messages to interested clients based on the topic of a message.
Historically, the 'MQ' in 'MQTT' came from IBM's MQ message queuing product line.

This adapter uses the MQTT.js library from https://github.com/adamvr/MQTT.js/

## Configuration
- **Type** - Select "Client" (If you want to receive and send messages to other broker) or "Server" if you want create own MQTT broker.

### Server settings
- **WebSockets** - if parallely to TCP Server, the WebSocket MQTT Server should run.
- **Port** - Port where the server will run (Default 1883). WebSockets will always run on port+1 (Default 1884)
- **SSL** - If TCP and WebSockets should run as secure server.
- **Authentication/User name** - If authentication required, you can specify username. It is suggested to always use SSL with authentication to not send passwords over unsequre connection.  
- **Authentication/Password** - Password for user.
- **Mask to publish own states** - Pattern to filter ioBroker states, which will be sent to clients. You can use wildcards to specify group of messages, e.g "*.memRss, mqtt.0.*" to get all memory states of all adapters and all states of adapter mqtt.0
- **Publish only on change** - New messages will be sent to client only if the state value changes. Every message sent by client will be accepted, even if the value does not changed.
- **Publish own states on connect** - by every client connection the all known states will be sent to client (defined by state mask), to say him which states has the ioBroker.
- **Prefix for all topics** - if set, every sent topic will be prepended with this prefix, e.g if prefix "iobroker/" all states will have names like "**iobroker**/mqtt/0/connected"
- **Trace output for every message** - Debug outputs.
- **Send states (ack=true) too** - Normally only the states/commands with ack=false will be sent to partner. If this flag is set every state independent from ack will be sent to partner. 

### Client settings
- **URL** - name or ip address of the broker/server. Like "localhost".
- **Port** - Port of the MQTT broker. By default 1883
- **Secure** - If secure (SSL) connection must be used.
- **User** - if broker required authentication, define here the user name.
- **Password** - if user name is not empty the password must be set. It can be empty.
- **Password confirmation** - repeat here the password.
- **Subscribe Patterns** - Subscribe pattern. See chapter "Examples of using wildcards" to define the pattern. '#' to subscribe for all topics. 'mqtt/0/#,javascript/#' to subscribe for states of mqtt.0 and javascript
- **Publish only on change** - Store incoming messages only if payload is differ from actual stored.
- **Mask to publish own states** - Mask for states, that must be published to broker. '*' - to publish all states. 'io.yr.*,io.hm-rpc.0.*' to publish states of "yr" and "hm-rpc" adapter.  
- **Publish all states at start** - Publish all states (defined by state mask) every time by connection establishment to announce own available states and their values.
- **Prefix for topics** - The prefix can be defined for own states. Like "/var/ioBroker/". Name of topics will be for example published with the name "/var/ioBroker/ping/192-168-1-5".
- **Test connection** - Press the button to check the connection to broker. Adapter must be enabled before.
- **Send states (ack=true) too** - Normally only the states/commands with ack=false will be sent to partner. If this flag is set every state independent from ack will be sent to partner. 
 
## Install

```node iobroker.js add mqtt```

## Usage

### How to test mqtt client:
- Set type to "Client".
- Leave port on 1883.
- Set URL as "broker.mqttdashboard.com"
- To get absolutely all topics(messages) set pattern to "#".
- To receive all topics for "/4MS" set pattern to "/4MS/#"
- To receive all topics for "/MS and "/floorish" set pattern to "/4MS/#, /floorish/#"

### Examples of using wildcards
The following examples on the use of wildcards, builds on the example provided in topic strings.

- "Sport"
- "Sport/Tennis"
- "Sport/Basketball"
- "Sport/Swimming"
- "Sport/Tennis/Finals"
- "Sport/Basketball/Finals"
- "Sport/Swimming/Finals"

If you want to subscribe to all Tennis topics, you can use the number sign '#', or the plus sign '+'.

- "Sport/Tennis/#" (this will receive "Sport/Tennis" and "Sport/Tennis/Finals")
- "Sport/Tennis/+" (this will receive "Sport/Tennis/Finals" but not "Sport/Tennis")

For JMS topics, if you want to subscribe to all Finals topics, you can use the number sign '#', or the plus sign '+'.

- "Sport/#/Finals"
- "Sport/+/Finals"

For MQTT topics, if you want to subscribe to all Finals topics, you can use the plus sign '+' .

"Sport/+/Finals"


## Changelog
### 0.2.8 (2015-05-17)
* (bluefox) do not ty to parse JSON objects

### 0.2.7 (2015-05-16)
* (bluefox) fix test button

### 0.2.6 (2015-05-16)
* (bluefox) fix names if from mqtt adapter

### 0.2.5 (2015-05-15)
* (bluefox) subscribe to all states if no mask defined

### 0.2.4 (2015-05-14)
* (bluefox) add state "clients" to server with the list of clients

### 0.2.3 (2015-05-14)
* (bluefox) fix some errors

### 0.2.2 (2015-05-13)
* (bluefox) fix some errors with sendOnStart and fix flag sendAckToo

### 0.2.0 (2015-05-13)
* (bluefox) translations and rename config sendNoAck=>sendAckToo
* (bluefox) lets create server not only on localhost

### 0.1.8 (2015-05-13)
* (bluefox) fix topic names in server mode
* (bluefox) implement subscribe
* (bluefox) update mqtt package

### 0.1.7 (2015-03-24)
* (bluefox) create objects if new state received
* (bluefox) update mqtt library

### 0.1.6 (2015-03-04)
* (bluefox) just update index.html

### 0.1.5 (2015-01-02)
* (bluefox) fix error if state deleted

### 0.1.4 (2015-01-02)
* (bluefox) support of npm install


### 0.1.2 (2014-11-28)
* (bluefox) support of npm install

### 0.1.1 (2014-11-22)
* (bluefox) support of new naming concept

### 0.1.0 (2014-10-23)
* (bluefox) Update readme
* (bluefox) Support of authentication for server and client
* (bluefox) Support of prefix for own topics

### 0.0.2 (2014-10-19)
* (bluefox) support of server (actual no authentication)


## License

The MIT License (MIT)

Copyright (c) 2014, bluefox

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
