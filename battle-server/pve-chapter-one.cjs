"use strict";

// Authored Promzona HP protocol v1, inside existing Expedition event 157.
// Unity owns hit detection and NavMesh. This module owns HP, rolls and kill dedupe.
const { randomInt } = require("node:crypto");
const COMMAND = Object.freeze({ HELLO: 50, REGISTER: 51, HIT: 52, MELEE: 53, STATE: 150 });

function handleChapterOne(run, context, command, sequence, payload, now = Date.now(), roll = (min = 5, max = 10) => randomInt(min, max + 1)) {
  const sceneId = payload?.SceneId;
  const reject = Error => ({ Protocol: 1, Error, Sequence: sequence, SceneId: sceneId });
  if (!context.solo || !context.authority) return reject("chapter_one_requires_solo_authority");
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return reject("invalid_sequence");
  if (typeof sceneId !== "string" || !/^[a-f0-9]{32}$/.test(sceneId)) return reject("invalid_scene_id");
  if (!run.chapterOne && command !== COMMAND.HELLO) return reject("handshake_required");
  if (!run.chapterOne) run.chapterOne = { sceneId, sequence: new Map(), mobs: new Map(), lastHit: new Map(), kills: { 1: 0, 2: 0 } };
  const state = run.chapterOne;
  if (state.sceneId !== sceneId) return reject("fresh_room_required");
  if (sequence <= (state.sequence.get(context.actorId) || 0)) return reject("stale_sequence");
  state.sequence.set(context.actorId, sequence);
  if (command === COMMAND.HELLO) return { Protocol: 1, Kind: "ready", Sequence: sequence, SceneId: sceneId, MeleeSupported: true };
  if (!payload || typeof payload !== "object") return reject("invalid_payload");
  const id = payload.MobId;
  // Stable identities bound to authored waves, not caller-supplied max HP/counts.
  const match = typeof id === "string" && /^([12]):(acid|berserk):([1-9][0-9]?)$/.exec(id);
  if (!match) return reject("invalid_mob_id");
  const quest = Number(match[1]), kind = match[2], index = Number(match[3]);
  if ((quest === 1 && (kind !== "acid" || index > 10)) || (quest === 2 && index > 6)) return reject("outside_authored_wave");
  let mob = state.mobs.get(id);
  if (command === COMMAND.REGISTER) {
    if (!mob) {
      const hp = kind === "berserk" ? 125 : 100;
      mob = { MobId: id, Health: hp, MaxHealth: hp, Quest: quest };
      state.mobs.set(id, mob);
    }
  } else if (command === COMMAND.HIT) {
    if (!context.alive) return reject("player_not_alive");
    if (!mob) return reject("mob_not_registered");
    if (now - (state.lastHit.get(context.actorId) ?? -Infinity) < 35) return reject("hit_rate_limited");
    state.lastHit.set(context.actorId, now);
    if (mob.Health > 0) {
      const damage = roll();
      if (!Number.isInteger(damage) || damage < 5 || damage > 10) throw new Error("invalid_damage_roll");
      mob.Health = Math.max(0, mob.Health - damage);
      if (mob.Health === 0) state.kills[quest]++;
    }
  } else if (command === COMMAND.MELEE) {
    if (!context.alive) return reject("player_not_alive");
    if (!mob) return reject("mob_not_registered");
    if (mob.Health <= 0) return reject("mob_dead");
    if (now - (mob.lastMeleeAt ?? -Infinity) < 1800) return reject("melee_cooldown");
    const min = kind === "berserk" ? 8 : 5, max = kind === "berserk" ? 12 : 10;
    const damage = roll(min, max);
    if (!Number.isInteger(damage) || damage < min || damage > max) throw new Error("invalid_melee_roll");
    mob.lastMeleeAt = now;
    return { Protocol: 1, Kind: "player_damage", Sequence: sequence, SceneId: sceneId, MobId: id, Damage: damage };
  } else return reject("unsupported_command");
  return { Protocol: 1, Kind: "health", Sequence: sequence, SceneId: sceneId, ...mob, Kills: state.kills[quest] };
}

module.exports = { COMMAND, handleChapterOne };
