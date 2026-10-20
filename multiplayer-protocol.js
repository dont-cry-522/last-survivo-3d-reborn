import {HERO_LOADOUTS, MAPS} from './rules.js?v=228';

export const ROOM_PROTOCOL = 1;
export const ROOM_MAX_PLAYERS = 4;
export const ROOM_MAX_MESSAGE_BYTES = 196608;
export const ROOM_INPUT_FIELDS = Object.freeze(['moveX','moveZ','aimYaw','aimPitch','attack','dodge','jump','crouch','autoAim','mobile','view','aspect','dodgeSeq','jumpSeq']);
export function validRoomSelection(heroId, weaponIndex) {
  return Object.hasOwn(HERO_LOADOUTS, heroId) && Number.isInteger(weaponIndex)
    && weaponIndex >= 0 && weaponIndex < HERO_LOADOUTS[heroId].length;
}
export function validRoomMap(mapId) { return Object.hasOwn(MAPS, mapId); }
export function roomDisplayName(name) {
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,24) : '';
}
export function normalizeRoomInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some(key => !ROOM_INPUT_FIELDS.includes(key))) return null;
  for (const key of ['moveX','moveZ','aimYaw','aimPitch']) if (!Number.isFinite(input[key])) return null;
  for (const key of ['attack','dodge','jump','crouch','autoAim']) if (typeof input[key] !== 'boolean') return null;
  if (Math.abs(input.moveX)>1.001 || Math.abs(input.moveZ)>1.001 || Math.abs(input.aimYaw)>1e6 || Math.abs(input.aimPitch)>Math.PI/2+.001) return null;
  if(input.mobile!==undefined&&typeof input.mobile!=='boolean')return null;
  if(input.view!==undefined&&!['first','third'].includes(input.view))return null;
  if(input.aspect!==undefined&&!Number.isFinite(input.aspect))return null;
  for(const key of ['dodgeSeq','jumpSeq'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>1e9))return null;
  const length = Math.max(1, Math.hypot(input.moveX,input.moveZ));
  return {moveX:input.moveX/length,moveZ:input.moveZ/length,aimYaw:Math.atan2(Math.sin(input.aimYaw),Math.cos(input.aimYaw)),aimPitch:input.aimPitch,
    attack:input.attack,dodge:input.dodge,jump:input.jump,crouch:input.crouch,autoAim:input.autoAim,
    mobile:input.mobile??false,view:input.view??'third',aspect:Math.max(.5,Math.min(3,input.aspect??16/9)),dodgeSeq:input.dodgeSeq??0,jumpSeq:input.jumpSeq??0};
}
export function validRoomSequence(sequence) { return Number.isSafeInteger(sequence) && sequence >= 0; }
