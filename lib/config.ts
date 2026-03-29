import { flow } from 'fp-ts/function';

import { mapValueClampedCurried } from './util';

export const DEVICE_NAME = 'MIDI Mapper Output';

const START_THRESHOLD = 40;

enum EXPRESSION_PEDAL {
  LEFT = 4,
  RIGHT = 5,
}

export const RULES = {
  [EXPRESSION_PEDAL.LEFT]: flow(
    mapValueClampedCurried([START_THRESHOLD, 127], [0, 127]),
    Math.round
  ),
  [EXPRESSION_PEDAL.RIGHT]: flow(
    mapValueClampedCurried([START_THRESHOLD, 120], [0, 64]),
    Math.round
  ),
};
