/**
 * `mqtt_sendmessage` - publish a message on a freely chosen topic.
 */
import type { Block } from 'blockly/core';

import { instanceOptions, registerGenerator } from '../helpers';

const Blockly = window.Blockly;

export function installSendMessage(): void {
    Blockly.Sendto.blocks.mqtt_sendmessage = `<block type="mqtt_sendmessage">
  <field name="INSTANCE"></field>
  <field name="RETAIN">FALSE</field>
  <value name="TOPIC">
    <shadow type="text">
      <field name="TEXT">your/topic/here</field>
    </shadow>
  </value>
  <value name="MESSAGE">
    <shadow type="text">
      <field name="TEXT">your message</field>
    </shadow>
  </value>
</block>`;

    Blockly.Blocks.mqtt_sendmessage = {
        init: function (this: Block): void {
            this.appendDummyInput('INSTANCE')
                .appendField(Blockly.Translate('mqtt_sendmessage'))
                .appendField(new Blockly.FieldDropdown(instanceOptions()), 'INSTANCE');

            this.appendValueInput('TOPIC').appendField(Blockly.Translate('mqtt_topic'));

            this.appendValueInput('MESSAGE').appendField(Blockly.Translate('mqtt_message'));

            this.appendDummyInput('RETAIN')
                .appendField(Blockly.Translate('mqtt_retain'))
                .appendField(new Blockly.FieldCheckbox('FALSE'), 'RETAIN');

            this.setInputsInline(false);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);

            this.setColour(Blockly.Sendto.HUE);
            this.setTooltip(Blockly.Translate('mqtt_tooltip'));
            this.setHelpUrl(Blockly.Translate('mqtt_help'));
        },
    };

    registerGenerator('mqtt_sendmessage', (block: Block): string => {
        const instance = block.getFieldValue('INSTANCE');
        const topic = Blockly.JavaScript.valueToCode(block, 'TOPIC', Blockly.JavaScript.ORDER_ATOMIC);
        const message = Blockly.JavaScript.valueToCode(block, 'MESSAGE', Blockly.JavaScript.ORDER_ATOMIC);

        // The checkbox yields the string "TRUE"/"FALSE"; older workspaces may hold a real boolean
        const field = block.getFieldValue('RETAIN') as string | boolean;
        const retain = field === true || field === 'TRUE' || field === 'true';

        return (
            `sendTo('mqtt${instance}', 'sendMessage2Client', ` +
            `{ topic: ${topic}, message: ${message}, retain: ${retain} });\n`
        );
    });
}
