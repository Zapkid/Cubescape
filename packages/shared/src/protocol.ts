import { z } from "zod";

/** Client → server messages. Every one is zod-validated server-side. */

export const InputStepMsg = z.object({
  seq: z.number().int().min(0),
  mx: z.number().min(-1.01).max(1.01),
  mz: z.number().min(-1.01).max(1.01),
  yaw: z.number().finite(),
  jump: z.boolean(),
  /** interact key held this step (channels, revives) */
  hold: z.boolean(),
});
export type InputStepMsg = z.infer<typeof InputStepMsg>;

export const InputBatchMsg = z.object({
  steps: z.array(InputStepMsg).min(1).max(8),
});
export type InputBatchMsg = z.infer<typeof InputBatchMsg>;

export const InteractMsg = z.object({
  /** optional lever/prop id the client believes it is using */
  propId: z.string().max(40).optional(),
});
export type InteractMsg = z.infer<typeof InteractMsg>;

export const AbilityMsg = z.object({
  /** 0..2 = character abilities, 3 = universal strike */
  slot: z.number().int().min(0).max(3),
  /** aim yaw at the moment of the click — beats waiting for the next input packet */
  yaw: z.number().finite().optional(),
});
export type AbilityMsg = z.infer<typeof AbilityMsg>;

export const SelectCharMsg = z.object({
  charId: z.enum(["brute", "scout", "tinker"]),
});
export type SelectCharMsg = z.infer<typeof SelectCharMsg>;

export const ReadyMsg = z.object({ ready: z.boolean() });
export type ReadyMsg = z.infer<typeof ReadyMsg>;

export const PingMsg = z.object({
  kind: z.enum(["look", "danger", "key", "go"]),
  x: z.number().min(0).max(9),
  z: z.number().min(0).max(9),
});
export type PingMsg = z.infer<typeof PingMsg>;

export const EmoteMsg = z.object({
  kind: z.enum(["point", "taunt"]),
});
export type EmoteMsg = z.infer<typeof EmoteMsg>;

/** Server → client transient events (sound/vfx cues; state itself flows via schema).
 * Known kinds: hit, mobDie, doorOpen, keyPickup, objective, downed, revived,
 * ping, emote, message, matchComplete, breach, transition, ability. */
export interface ServerEvent {
  t: string;
  [key: string]: unknown;
}
