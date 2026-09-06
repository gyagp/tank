export type TankClass = 'vanguard' | 'ghost' | 'bastion';
export type MapId = 'desert' | 'arctic' | 'forest';
export type MatchMode = 'deathmatch' | 'control';
export type Team = 'ember' | 'tide';
export const TEAMS = {
  ember: { name: '赤焰', color: '#ff8857' },
  tide: { name: '苍蓝', color: '#62ddd7' },
} as const;
export const CONTROL_GOAL = 180;
export type Difficulty = 'easy' | 'normal' | 'hard';
export type PickupKind =
  | 'scatter'
  | 'rapid'
  | 'rail'
  | 'homing'
  | 'flame'
  | 'shield'
  | 'speed'
  | 'repair'
  | 'mines'
  | 'damage'
  | 'lightning'
  | 'ricochet'
  | 'gravity'
  | 'cluster'
  | 'orbital'
  | 'frost';
export type Weapon =
  | 'standard'
  | 'scatter'
  | 'rapid'
  | 'rail'
  | 'homing'
  | 'flame'
  | 'lightning'
  | 'ricochet'
  | 'gravity'
  | 'cluster'
  | 'orbital';
export interface Vec2 {
  x: number;
  z: number;
}
export interface InputState {
  x: number;
  z: number;
  angle: number;
  fire: boolean;
  dash: boolean;
  mine: boolean;
  smoke?: boolean;
  radar?: boolean;
}
export interface Tank extends Vec2 {
  id: string;
  name: string;
  classId: TankClass;
  color: number;
  bot: boolean;
  angle: number;
  bodyAngle: number;
  hp: number;
  maxHp: number;
  team?: Team;
  captures: number;
  smokeReadyAt: number;
  radarReadyAt: number;
  radarUntil: number;
  revealedUntil: number;
  kills: number;
  deaths: number;
  alive: boolean;
  respawnAt: number;
  invulnerableUntil: number;
  weapon: Weapon;
  weaponUntil: number;
  shieldUntil: number;
  speedUntil: number;
  damageUntil: number;
  slowUntil: number;
  dashUntil: number;
  dashReadyAt: number;
  mines: number;
  nextFire: number;
  nextMine: number;
}
export interface Bullet extends Vec2 {
  id: number;
  owner: string;
  vx: number;
  vz: number;
  damage: number;
  life: number;
  kind: Weapon;
  bounces?: number;
}
export interface Field extends Vec2 {
  id: number;
  kind: 'gravity' | 'orbital' | 'smoke';
  owner: string;
  radius: number;
  createdAt: number;
  triggerAt: number;
  expiresAt: number;
  nextTick: number;
  damage: number;
}
export interface Obstacle extends Vec2 {
  id: number;
  w: number;
  d: number;
  h: number;
  hp: number;
  kind: 'wall' | 'crate' | 'barrel' | 'rock';
}
export interface Pickup extends Vec2 {
  id: number;
  kind: PickupKind;
  active: boolean;
  support?: boolean;
  respawnAt: number;
}
export interface Mine extends Vec2 {
  id: number;
  owner: string;
  armedAt: number;
  expireAt: number;
}
export interface GameEvent extends Vec2 {
  id: number;
  type:
    | 'shot'
    | 'hit'
    | 'explosion'
    | 'pickup'
    | 'kill'
    | 'dash'
    | 'arc'
    | 'strike'
    | 'frost'
    | 'smoke'
    | 'radar'
    | 'capture';
  actor?: string;
  target?: string;
  label?: string;
  toX?: number;
  toZ?: number;
  radius?: number;
}
export interface ControlPoint extends Vec2 {
  id: 'A' | 'B' | 'C';
  radius: number;
  owner: Team | null;
  capturing: Team | null;
  progress: number;
  contested: boolean;
}
export interface GameState {
  mode: MatchMode;
  controlPoints: ControlPoint[];
  teamScores: Record<Team, number>;
  winnerTeam: Team | null;
  map: MapId;
  time: number;
  duration: number;
  goal: number;
  status: 'playing' | 'finished';
  winner: string | null;
  tanks: Tank[];
  bullets: Bullet[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  mines: Mine[];
  events: GameEvent[];
  fields: Field[];
}
export interface RoomPlayer {
  team?: Team;
  id: string;
  name: string;
  classId: TankClass;
  bot: boolean;
  color: number;
}
export interface RoomSettings {
  mode?: MatchMode;
  map: MapId;
  difficulty: Difficulty;
  goal: number;
  duration: number;
}
export interface RoomView {
  code: string;
  host: string;
  players: RoomPlayer[];
  settings: RoomSettings;
  status: 'lobby' | 'playing' | 'finished';
}
export interface Ack {
  ok: boolean;
  error?: string;
  room?: RoomView;
}
export const EMPTY_INPUT: InputState = {
  x: 0,
  z: 0,
  angle: 0,
  fire: false,
  dash: false,
  mine: false,
  smoke: false,
  radar: false,
};
export const ARENA_SIZE = 48;
export const TANK_RADIUS = 0.78;
export const MAX_PLAYERS = 8;
export const FIXED_ROOM_CODE = '12345';
export const COLORS = [
  0xef6a3b, 0x54c9c3, 0xabb863, 0xc291e3, 0x6caff1, 0xe8b947, 0xe375a8, 0xd1d7ca,
];
export const TANK_CLASSES = {
  vanguard: {
    name: '游隼',
    en: 'VANGUARD',
    role: '均衡突击',
    hp: 100,
    speed: 7,
    cooldown: 0.43,
    armor: 65,
    power: 72,
    mobility: 75,
    number: '01',
    description: '速度与火力的精妙平衡。永远是突破战线的第一选择。',
  },
  ghost: {
    name: '幽灵',
    en: 'GHOST',
    role: '高速侦察',
    hp: 75,
    speed: 9,
    cooldown: 0.38,
    armor: 40,
    power: 65,
    mobility: 96,
    number: '02',
    description: '轻量装甲，极致机动。从侧翼出击，让敌人来不及转身。',
  },
  bastion: {
    name: '壁垒',
    en: 'BASTION',
    role: '重装压制',
    hp: 150,
    speed: 5.5,
    cooldown: 0.56,
    armor: 95,
    power: 88,
    mobility: 48,
    number: '03',
    description: '厚重装甲与大口径火炮。守住阵地，也碾过一切阻碍。',
  },
} as const;
export const MAPS = {
  desert: {
    name: '赤沙哨站',
    en: 'DUST OUTPOST',
    description: '炙热沙海 · 近距交锋',
    ground: 0xbba781,
    fog: 0xc6b594,
    wall: 0x77786b,
    accent: '#dba568',
  },
  arctic: {
    name: '极夜基地',
    en: 'FROST STATION',
    description: '冰封前线 · 火力对决',
    ground: 0xb8cbd2,
    fog: 0xa9beca,
    wall: 0x697f89,
    accent: '#8cbacf',
  },
  forest: {
    name: '翠谷遗迹',
    en: 'OVERGROWN',
    description: '丛林废墟 · 迂回突袭',
    ground: 0x819074,
    fog: 0x9fac92,
    wall: 0x626c59,
    accent: '#98ab74',
  },
} as const;
export const PICKUPS: Record<
  PickupKind,
  { name: string; en: string; symbol: string; color: string; description: string }
> = {
  scatter: {
    name: '三连散射',
    en: 'TRIPLE SHOT',
    symbol: '⋔',
    color: '#ffb247',
    description: '三发扇形炮弹同时出膛，近身威力倍增，持续 12 秒。',
  },
  rapid: {
    name: '速射机炮',
    en: 'RAPID FIRE',
    symbol: '»',
    color: '#f3d66a',
    description: '射速大幅提升，用连续火力封锁战线，持续 12 秒。',
  },
  rail: {
    name: '穿甲轨道炮',
    en: 'RAILGUN',
    symbol: '↗',
    color: '#b7a0ff',
    description: '高速穿甲弹穿透箱体与敌车，单发 52 伤害，持续 12 秒。',
  },
  homing: {
    name: '追踪导弹',
    en: 'HOMING',
    symbol: '⌖',
    color: '#f59cc1',
    description: '导弹自动修正方向追击附近敌车，持续 12 秒。',
  },
  flame: {
    name: '烈焰喷射',
    en: 'INFERNO',
    symbol: '♨',
    color: '#ff7f43',
    description: '短距离高频喷射火焰，适合贴身压制，持续 12 秒。',
  },
  shield: {
    name: '能量护盾',
    en: 'SHIELD',
    symbol: '⬡',
    color: '#7ddde4',
    description: '能量屏障完全吸收伤害，持续 7 秒。',
  },
  speed: {
    name: '涡轮增压',
    en: 'OVERDRIVE',
    symbol: 'ϟ',
    color: '#a9de70',
    description: '移动速度提升 45%，持续 10 秒。',
  },
  repair: {
    name: '战地维修',
    en: 'FIELD REPAIR',
    symbol: '+',
    color: '#6adea2',
    description: '立即恢复 60 点生命值，重新投入战斗。',
  },
  mines: {
    name: '战术地雷',
    en: 'MINE PACK',
    symbol: '✳',
    color: '#e6b171',
    description: '补充两枚地雷，按 E 布置，接近敌人时爆炸。',
  },
  damage: {
    name: '超载弹药',
    en: 'DOUBLE DAMAGE',
    symbol: '×2',
    color: '#fb7770',
    description: '所有火炮伤害翻倍，持续 8 秒。',
  },
  lightning: {
    name: '雷霆电弧',
    en: 'CHAIN LIGHTNING',
    symbol: 'ϟ',
    color: '#80daff',
    description: '瞄准放电，最多连锁 3 辆敌车，伤害逐次衰减。利用掩体可隔断连锁，持续 12 秒。',
  },
  ricochet: {
    name: '棱镜弹射炮',
    en: 'PRISM RICOCHET',
    symbol: '◇',
    color: '#63f0d6',
    description: '高速能量弹最多反弹 3 次，用墙壁制造意想不到的射击角度，持续 12 秒。',
  },
  gravity: {
    name: '奇点引力弹',
    en: 'SINGULARITY',
    symbol: '◎',
    color: '#b688ff',
    description: '制造持续 3.5 秒的引力井，吸附并灼伤敌人；护盾免疫牵引。武器持续 12 秒。',
  },
  cluster: {
    name: '蜂群集束弹',
    en: 'CLUSTER SWARM',
    symbol: '✺',
    color: '#ffad61',
    description: '主弹范围爆破，再分裂成 6 枚短程碎片，封锁敌方走位，持续 12 秒。',
  },
  orbital: {
    name: '天基轰炸',
    en: 'ORBITAL STRIKE',
    symbol: '⊕',
    color: '#ff8473',
    description: '锁定瞄准方向的敌人当前位置，0.9 秒预警后降下范围打击，持续 12 秒。',
  },
  frost: {
    name: '冰霜新星',
    en: 'FROST NOVA',
    symbol: '❄',
    color: '#a8edff',
    description: '拾取后立刻释放 8 米冰霜冲击，造成 18 点伤害并减速 3 秒；护盾可抵抗。',
  },
};
export const PICKUP_TYPES = Object.keys(PICKUPS) as PickupKind[];
export const ADVANCED_PICKUPS: readonly PickupKind[] = [
  'lightning',
  'ricochet',
  'gravity',
  'cluster',
  'orbital',
  'frost',
];
export const WEAPON_PICKUPS: readonly Weapon[] = [
  'scatter',
  'rapid',
  'rail',
  'homing',
  'flame',
  'lightning',
  'ricochet',
  'gravity',
  'cluster',
  'orbital',
];
export const OPENING_SUPPLIES: readonly PickupKind[] = [
  'gravity',
  'orbital',
  'cluster',
  'ricochet',
  'repair',
  'lightning',
  'shield',
  'frost',
  'scatter',
  'speed',
  'rapid',
  'rail',
  'homing',
  'flame',
  'mines',
  'damage',
  'repair',
  'repair',
  'shield',
  'shield',
  'mines',
  'mines',
  'speed',
  'speed',
];
