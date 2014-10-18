![Logo](admin/mqtt.png)
ioBroker mqtt Adapter
==============

Send emails from ioBroker. 

## Changelog
### 0.0.2 (2014-10-19)
* (bluefox) support of server (actual no authentication)

## Install

```node iobroker.js add mqtt```

## Configuration


## Usage




## How to test mqtt client:
- Set type to "Client".
- Leave port on 1883.
- Set URL as "broker.mqttdashboard.com"
- To get absolutely all topics(messages) set pattern to "#".
- To receive all topics for "/4MS" set pattern to "/4MS/#"
- To receive all topics for "/MS and "/floorish" set pattern to "/4MS/#, /floorish/#"

##Examples of using wildcards
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

## License

The MIT License (MIT)

Copyright (c) 2014 bluefox

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
