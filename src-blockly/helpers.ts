/**
 * Pieces the mqtt blocks share.
 */
import type { Block } from 'blockly/core';

const Blockly = window.Blockly;

/**
 * The instance dropdown: every `mqtt.x` the admin knows about, or `mqtt.0` .. `mqtt.4` while the
 * editor has not reported any instances yet. "All instances" always comes first.
 *
 * @returns The dropdown entries as [label, value] pairs; the value is the instance suffix
 */
export function instanceOptions(): [string, string][] {
    const options: [string, string][] = [];

    const instances = window.main?.instances;
    if (instances) {
        for (let i = 0; i < instances.length; i++) {
            const m = /^system\.adapter\.mqtt\.(\d+)$/.exec(instances[i]);
            if (m) {
                options.push([`mqtt.${parseInt(m[1], 10)}`, `.${parseInt(m[1], 10)}`]);
            }
        }
    }

    // The editor does not know any mqtt instance (yet), so offer the usual ones
    if (!options.length) {
        for (let n = 0; n <= 4; n++) {
            options.push([`mqtt.${n}`, `.${n}`]);
        }
    }

    options.unshift([Blockly.Translate('mqtt_anyInstance'), '']);

    return options;
}

/**
 * Registers a generator. Blockly >= 10 looks it up in `forBlock`; registering on the plain slot is
 * not enough, because the editor migrates that slot to `forBlock` before it loads any adapter's
 * `blockly.js`, so an adapter registering the old way is never migrated.
 *
 * @param type block type
 * @param generator turns a block of that type into JavaScript
 */
export function registerGenerator(type: string, generator: (block: Block) => string): void {
    if (Blockly.JavaScript.forBlock) {
        Blockly.JavaScript.forBlock[type] = generator;
    } else {
        Blockly.JavaScript[type] = generator;
    }
}
