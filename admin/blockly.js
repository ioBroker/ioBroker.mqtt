'use strict';

if (typeof goog !== 'undefined') {
    goog.provide('Blockly.JavaScript.Sendto');
    goog.require('Blockly.JavaScript');
}

Blockly.Translate =
    Blockly.Translate ||
    function (word, lang) {
        lang = lang || systemLang;
        if (Blockly.Words && Blockly.Words[word]) {
            return Blockly.Words[word][lang] || Blockly.Words[word].en;
        } else {
            return word;
        }
    };

/// --- SendTo MQTT --------------------------------------------------
Blockly.Words['mqtt_sendmessage'] = {
    en: 'MQTT Message',
    de: 'MQTT-Nachricht',
    ru: 'MQTT сообщение',
    pt: 'MQTT mensagem',
    nl: 'MQT',
    fr: 'Message MQTT',
    it: 'Messaggio MQTT',
    es: 'MQTT message',
    pl: 'MQTT',
    uk: 'MQTT повідомлення',
    'zh-cn': 'MQTT信息',
};
Blockly.Words['mqtt_topic'] = {
    en: 'Topic',
    de: 'Thema',
    ru: 'Тема',
    pt: 'Assunto',
    nl: 'Ondertiteling:',
    fr: 'Thème',
    it: 'Argomento',
    es: 'Tema',
    pl: 'Topi',
    uk: 'Головна',
    'zh-cn': '议题',
};
Blockly.Words['mqtt_message'] = {
    en: 'Message',
    de: 'Nachricht',
    ru: 'Сообщение',
    pt: 'Mensagem',
    nl: 'Bericht',
    fr: 'Message',
    it: 'Messaggio',
    es: 'Mensaje',
    pl: 'Message',
    uk: 'Новини',
    'zh-cn': '导 言',
};
Blockly.Words['mqtt_retain'] = {
    en: 'Retain',
    de: 'Retain',
    ru: 'Retain',
    pt: 'Retain',
    nl: 'Retain',
    fr: 'Retain',
    it: 'Retain',
    es: 'Retain',
    pl: 'Retain',
    uk: 'Retain',
    'zh-cn': 'Retain',
};
Blockly.Words['mqtt_anyInstance'] = {
    en: 'All instances',
    de: 'Alle Instanzen',
    ru: 'Все экземпляры',
    pt: 'Todas as instâncias',
    nl: 'Alle instanties',
    fr: 'Toutes les instances',
    it: 'Tutte le istanze',
    es: 'Todas las instancias',
    pl: 'Wszystkie instancje',
    uk: 'Всі екземпляри',
    'zh-cn': '所有案件',
};
Blockly.Words['mqtt_tooltip'] = {
    en: 'Send a message on a user defined topic',
    de: 'Senden Sie eine Nachricht an ein benutzerdefiniertes Thema',
    ru: 'Отправить сообщение на определенную тему пользователя',
    pt: 'Enviar uma mensagem sobre um tópico definido pelo usuário',
    nl: 'Stuur een bericht naar een gebruiker',
    fr: 'Envoyer un message sur un sujet défini',
    it: 'Invia un messaggio su un argomento definito dall\'utente',
    es: 'Enviar un mensaje sobre un tema definido por el usuario',
    pl: 'Wysyłanie wiadomości na temat użytkownika określonego tematu',
    uk: 'Надіслати повідомлення на певну тему користувача',
    'zh-cn': '关于用户界定专题的信息',
};
Blockly.Words['mqtt_help'] = { en: 'https://github.com/ioBroker/ioBroker.mqtt/blob/master/docs/en/README.md', de: 'https://github.com/ioBroker/ioBroker.mqtt/blob/master/docs/de/README.md' };

Blockly.Sendto.blocks['mqtt_sendmessage'] =
    '<block type="mqtt_sendmessage">' +
    '     <value name="INSTANCE">' +
    '     </value>' +
    '     <value name="TOPIC">' +
    '         <shadow type="text">' +
    '             <field name="TEXT">your/topic/here</field>' +
    '         </shadow>' +
    '     </value>' +
    '     <value name="MESSAGE">' +
    '         <shadow type="text">' +
    '             <field name="TEXT">your message</field>' +
    '         </shadow>' +
    '     </value>' +
    '     <value name="RETAIN">' +
    '     </value>' +
    '</block>';

Blockly.Blocks['mqtt_sendmessage'] = {
    init: function () {
        const options = [];

        if (typeof main !== 'undefined' && main.instances) {
            for (let i = 0; i < main.instances.length; i++) {
                const m = main.instances[i].match(/^system.adapter.mqtt.(\d+)$/);
                if (m) {
                    const n = parseInt(m[1], 10);
                    options.push(['mqtt.' + n, '.' + n]);
                }
            }
        }

        if (!options.length) {
            for (let k = 0; k <= 4; k++) {
                options.push(['mqtt.' + k, '.' + k]);
            }
        }

        options.unshift([Blockly.Translate('mqtt_anyInstance'), '']);

        this.appendDummyInput('INSTANCE').appendField(Blockly.Translate('mqtt_sendmessage')).appendField(new Blockly.FieldDropdown(options), 'INSTANCE');
        this.appendValueInput('TOPIC').appendField(Blockly.Translate('mqtt_topic'));
        this.appendValueInput('MESSAGE').appendField(Blockly.Translate('mqtt_message'));
        this.appendDummyInput('RETAIN').appendField(Blockly.Translate('mqtt_retain')).appendField(new Blockly.FieldCheckbox('FALSE'), 'RETAIN');

        this.setInputsInline(false);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);

        this.setColour(Blockly.Sendto.HUE);
        this.setTooltip(Blockly.Translate('mqtt_tooltip'));
        this.setHelpUrl(Blockly.Translate('mqtt_help'));
    },
};

Blockly.JavaScript['mqtt_sendmessage'] = function (block) {
    const topic = Blockly.JavaScript.valueToCode(block, 'TOPIC', Blockly.JavaScript.ORDER_ATOMIC);
    const message = Blockly.JavaScript.valueToCode(block, 'MESSAGE', Blockly.JavaScript.ORDER_ATOMIC);

    let retain = block.getFieldValue('RETAIN');
    retain = retain === 'TRUE' || retain === 'true' || retain === true;

    return `sendTo('mqtt${block.getFieldValue('INSTANCE')}', 'sendMessage2Client', { topic: ${topic}, message: ${message}, retain: ${retain} }, (res) => { if (res && res.error) { console.error(res.error); } });`;
};
