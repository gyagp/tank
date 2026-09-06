import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CloudFog,
  Radar,
  AudioLines,
  Crosshair,
  Expand,
  Flag,
  Gauge,
  HelpCircle,
  Maximize2,
  Shield,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import {
  EMPTY_INPUT,
  TEAMS,
  MAPS,
  PICKUPS,
  type GameState,
  type InputState,
  type RoomView,
} from '../../shared/types';
import { allies, visibleTanks } from '../../shared/tactics';
import { ArenaRenderer } from './renderer';
import { GameAudio } from './audio';
import { BattleControls, findAssistTarget } from './controls';

interface Props {
  socket: Socket;
  room: RoomView;
  playerId: string;
  initialState: GameState | null;
  onLeave: () => void;
  onRematch: () => void;
  muted: boolean;
  onMute: () => void;
  reducedMotion: boolean;
  ping: number;
}
export default function GameView({
  socket,
  room,
  playerId,
  initialState,
  onLeave,
  onRematch,
  muted,
  onMute,
  reducedMotion,
  ping,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null),
    renderer = useRef<ArenaRenderer | null>(null),
    audio = useRef<GameAudio | null>(null);
  const controls = useRef(new BattleControls());
  const stateRef = useRef(initialState),
    blocked = useRef(false);
  const [assist, setAssist] = useState(() => {
    try {
      return localStorage.getItem('ironclad-aim-assist') !== 'false';
    } catch {
      return true;
    }
  });
  const assistEnabled = useRef(assist);
  assistEnabled.current = assist;
  const [lockedTarget, setLockedTarget] = useState('');
  const toggleAssist = () => {
    const next = !assistEnabled.current;
    assistEnabled.current = next;
    setAssist(next);
    try {
      localStorage.setItem('ironclad-aim-assist', String(next));
    } catch {}
  };
  const labelElements = useRef(new Map<string, HTMLDivElement>());
  const [state, setState] = useState<GameState | null>(initialState),
    [menu, setMenu] = useState(false),
    [scoreboard, setScoreboard] = useState(false),
    [failure, setFailure] = useState(''),
    [notice, setNotice] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [joysticks, setJoysticks] = useState<{
    move: { x: number; y: number };
    aim: { x: number; y: number };
  }>({ move: { x: 0, y: 0 }, aim: { x: 0, y: 0 } });
  const maxEvent = useRef(0),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  blocked.current = menu || state?.status === 'finished';
  useEffect(() => {
    if (!viewport.current) return;
    const sound = new GameAudio();
    sound.muted = muted;
    audio.current = sound;
    let visual: ArenaRenderer;
    try {
      visual = new ArenaRenderer(viewport.current, room.settings.map, playerId, sound);
      renderer.current = visual;
      visual.reducedMotion = reducedMotion;
    } catch (e) {
      setFailure('无法启动 3D 画面，请在浏览器中启用硬件加速后重试。');
      return;
    }
    visual.onLabels = (positions) => {
      for (const p of positions) {
        const el = labelElements.current.get(p.id);
        if (el) {
          el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
          el.style.display = p.visible ? 'block' : 'none';
        }
      }
    };
    let aimTarget = '',
      nextTargetSearch = 0;
    const readInput = () => {
      const control = controls.current;
      if (blocked.current) {
        if (aimTarget) {
          aimTarget = '';
          setLockedTarget('');
        }
        nextTargetSearch = 0;
        return { ...EMPTY_INPUT, angle: control.state.angle };
      }
      if (assistEnabled.current && control.assistFire && stateRef.current) {
        if (performance.now() >= nextTargetSearch) {
          const next = findAssistTarget(stateRef.current, playerId)?.id || '';
          if (next !== aimTarget) {
            aimTarget = next;
            setLockedTarget(next);
          }
          nextTargetSearch = performance.now() + 100;
        }
        const angle = aimTarget ? visual.aimAtTank(aimTarget) : null;
        if (angle !== null) control.state.angle = angle;
        else if (control.state.x || control.state.z)
          control.state.angle = Math.atan2(control.state.x, control.state.z);
      } else {
        if (aimTarget) {
          aimTarget = '';
          setLockedTarget('');
        }
        nextTargetSearch = 0;
        const pointer = control.pointerAim;
        if (pointer) {
          const angle = visual.aim(pointer.x, pointer.y);
          if (angle !== null) control.state.angle = angle;
        }
      }
      return control.state;
    };
    visual.readInput = readInput;
    if (stateRef.current) visual.update(stateRef.current);
    let lastHudAt = 0;
    const onState = (next: GameState) => {
      stateRef.current = next;
      visual.update(next);
      const now = performance.now();
      if (now - lastHudAt >= 100 || next.status === 'finished') {
        setState(next);
        lastHudAt = now;
      }
      for (const e of next.events)
        if (e.id > maxEvent.current) {
          maxEvent.current = e.id;
          if (e.type === 'pickup' && e.actor === playerId) {
            const action =
              e.label === 'frost'
                ? '已释放'
                : e.label === 'repair'
                  ? '已修复'
                  : e.label === 'mines'
                    ? '已补充'
                    : '已装备';
            setNotice(`${PICKUPS[e.label as keyof typeof PICKUPS]?.name} ${action}`);
            if (noticeTimer.current) clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(''), 2200);
          }
          if (
            ((e.type === 'smoke' || e.type === 'radar') && e.actor === playerId) ||
            e.type === 'capture'
          ) {
            const actor = next.tanks.find((t) => t.id === e.actor);
            setNotice(
              e.type === 'capture'
                ? `${actor?.team ? TEAMS[actor.team].name : '队伍'}占领 ${e.label} 点`
                : e.type === 'smoke'
                  ? '烟幕展开 · 开火会暴露位置'
                  : '侦察启动 · 隔烟识敌 4 秒',
            );
            if (noticeTimer.current) clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(''), 2200);
          }
          if (e.type === 'kill' && e.actor === playerId && e.target !== playerId) {
            setNotice('目标摧毁  +1');
            if (noticeTimer.current) clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(''), 2200);
          }
        }
    };
    socket.on('state', onState);
    const transmit = () => {
      const intended = readInput();
      const current = blocked.current
        ? { ...EMPTY_INPUT, angle: intended.angle }
        : controls.current.packet();
      socket.emit('input', current);
      visual.localAim(current);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (!e.repeat) setMenu((v) => !v);
        return;
      }
      if (blocked.current) return;
      if (e.code === 'Tab') {
        e.preventDefault();
        setScoreboard(true);
        return;
      }
      if (e.code === 'KeyQ') {
        if (!e.repeat) toggleAssist();
        return;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
        e.preventDefault();
      sound.unlock();
      controls.current.keyDown(e.code);
      transmit();
    };
    const up = (e: KeyboardEvent) => {
      controls.current.keyUp(e.code);
      transmit();
      if (e.code === 'Tab') setScoreboard(false);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') controls.current.movePointer(e.clientX, e.clientY);
    };
    const press = (e: PointerEvent) => {
      if (
        e.pointerType === 'touch' ||
        blocked.current ||
        (e.target as HTMLElement).closest('button,.touch-control,.hud-panel')
      )
        return;
      if (e.button === 0 || e.button === 2) {
        sound.unlock();
        controls.current.movePointer(e.clientX, e.clientY);
        controls.current.mouseButton(e.button, true);
        transmit();
      }
    };
    const release = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') {
        controls.current.mouseButton(e.button, false);
        transmit();
      }
    };
    const reset = () => {
      aimTarget = '';
      nextTargetSearch = 0;
      controls.current.reset();
      setScoreboard(false);
      setLockedTarget('');
      socket.emit('input', controls.current.packet());
    };
    const visibility = () => {
      if (document.hidden) reset();
    };
    const contextMenu = (e: MouseEvent) => {
      if (!blocked.current && (e.target as HTMLElement).closest('.battle-viewport'))
        e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('contextmenu', contextMenu);
    const timer = setInterval(transmit, 1000 / 30);
    return () => {
      socket.off('state', onState);
      clearInterval(timer);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', reset);
      window.removeEventListener('contextmenu', contextMenu);
      document.removeEventListener('visibilitychange', visibility);
      visual.destroy();
      sound.destroy();
      renderer.current = null;
    };
    // Match identity controls the lifetime of the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, room.code, room.settings.map, playerId]);
  useEffect(() => {
    if (audio.current) audio.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (renderer.current) renderer.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);
  useEffect(() => {
    if (menu) {
      controls.current.reset();
      setLockedTarget('');
      socket.emit('input', controls.current.packet());
    }
  }, [menu]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const me = state?.tanks.find((t) => t.id === playerId),
    ranking = [...(state?.tanks || [])].sort(
      (a, b) =>
        (state?.mode === 'control' ? b.captures - a.captures : 0) ||
        b.kills - a.kills ||
        a.deaths - b.deaths,
    );
  const visible = useMemo(
    () => (state ? visibleTanks(state, playerId) : new Set<string>()),
    [state, playerId],
  );
  const controlMode = state?.mode === 'control' || room.settings.mode === 'control';
  const activePoint = state?.controlPoints.find(
    (p) => me?.alive && Math.hypot(me.x - p.x, me.z - p.z) < p.radius,
  );
  const resultTitle =
    state?.status !== 'finished'
      ? '战场排行'
      : controlMode
        ? state?.winnerTeam
          ? state.winnerTeam === me?.team
            ? '团队胜利'
            : TEAMS[state.winnerTeam].name + '获胜'
          : '势均力敌'
        : state?.winner === playerId
          ? '胜利属于你'
          : state?.winner
            ? state.tanks.find((t) => t.id === state.winner)?.name + ' 获胜'
            : '势均力敌';
  const remaining = Math.max(0, Math.ceil((state?.duration || 180) - (state?.time || 0))),
    time = state?.time || 0;
  const effects = me
    ? [
        { kind: me.weapon, until: me.weaponUntil },
        { kind: 'shield', until: me.shieldUntil },
        { kind: 'speed', until: me.speedUntil },
        { kind: 'damage', until: me.damageUntil },
        { kind: 'frost', until: me.slowUntil },
      ].filter((e) => e.until > time && e.kind !== 'standard')
    : [];
  const touch = (kind: 'move' | 'aim', e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(),
      dx = e.clientX - rect.left - rect.width / 2,
      dy = e.clientY - rect.top - rect.height / 2,
      len = Math.max(36, Math.hypot(dx, dy));
    const x = dx / len,
      z = dy / len;
    setJoysticks((v) => ({ ...v, [kind]: { x: x * 30, y: z * 30 } }));
    if (kind === 'move') {
      controls.current.moveTouch(x, z);
    } else {
      if (Math.hypot(dx, dy) > 4)
        controls.current.aimTouch(Math.atan2(x, z), Math.hypot(dx, dy) > 9);
      else controls.current.stopTouchAim();
    }
  };
  const endTouch = (kind: 'move' | 'aim') => {
    setJoysticks((v) => ({ ...v, [kind]: { x: 0, y: 0 } }));
    if (kind === 'move') {
      controls.current.moveTouch(0, 0);
    } else controls.current.stopTouchAim();
  };
  const touchAction = (kind: 'mine' | 'dash') => {
    controls.current.ability(kind, true);
    audio.current?.unlock();
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice('当前浏览器不支持全屏');
    }
  };
  return (
    <main
      className={`battle-screen ${controlMode ? 'control-mode' : ''}`}
      data-testid="battle-screen"
    >
      <div ref={viewport} className="battle-viewport" />
      <div className="battle-vignette" />
      <div className="tank-labels" ref={labels}>
        {state?.tanks.map((t) => (
          <div
            key={t.id}
            data-tank={t.id}
            ref={(element) => {
              if (element) labelElements.current.set(t.id, element);
              else labelElements.current.delete(t.id);
            }}
            className={`tank-label ${t.id === playerId ? 'self' : ''} ${t.id === lockedTarget ? 'locked' : ''}`}
          >
            <span>{t.id === playerId ? '▼  你' : t.name}</span>
            <i>
              <b
                style={{
                  width: `${(t.hp / t.maxHp) * 100}%`,
                  background: `#${t.color.toString(16).padStart(6, '0')}`,
                }}
              />
            </i>
          </div>
        ))}
      </div>
      <header className="battle-top">
        <div className="battle-brand">
          <Crosshair size={25} />
          <div>
            IRONCLAD<small>{MAPS[room.settings.map].en}</small>
          </div>
        </div>
        <div className="match-clock">
          <span>
            {controlMode
              ? `据点争夺 · ${state?.goal || 180} 分获胜`
              : `自由混战 · ${room.settings.goal} 击毁获胜`}
          </span>
          <strong className={remaining < 30 ? 'urgent' : ''}>
            {String(Math.floor(remaining / 60)).padStart(2, '0')}
            <em>:</em>
            {String(remaining % 60).padStart(2, '0')}
          </strong>
        </div>
        <div className="battle-actions">
          <button
            className={`assist-control ${assist ? 'active' : ''}`}
            aria-label="辅助瞄准"
            aria-pressed={assist}
            onClick={toggleAssist}
            title="空格辅助射击，Q 切换"
          >
            <Crosshair size={16} />
            <span>辅助瞄准</span>
            <kbd>Q</kbd>
          </button>
          <span className="ping">
            <i />
            {ping} ms
          </span>
          <button
            className="battle-icon"
            aria-label={muted ? '开启音效' : '关闭音效'}
            onClick={onMute}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button
            className="battle-icon desktop-only"
            aria-label={fullscreen ? '退出全屏' : '全屏'}
            onClick={() => void toggleFullscreen()}
          >
            <Expand size={18} />
          </button>
          <button className="battle-icon" aria-label="游戏菜单" onClick={() => setMenu(true)}>
            <HelpCircle size={19} />
          </button>
        </div>
      </header>
      {controlMode && state && (
        <section className="objective-hud hud-panel" aria-label="据点战况">
          <div className="team-scores">
            {(['ember', 'tide'] as const).map((team) => (
              <div key={team} style={{ color: TEAMS[team].color }}>
                <span>
                  {TEAMS[team].name}
                  {me?.team === team ? ' · 我方' : ''}
                </span>
                <strong>{Math.floor(state.teamScores[team])}</strong>
              </div>
            ))}
          </div>
          <div className="objective-list">
            {state.controlPoints.map((p) => (
              <div
                key={p.id}
                className={p.contested ? 'contested' : ''}
                style={{ color: p.owner ? TEAMS[p.owner].color : '#e1e4d7' }}
              >
                <strong>{p.id}</strong>
                <span>
                  {p.contested
                    ? '争夺中'
                    : p.capturing
                      ? p.owner
                        ? '中立化'
                        : '占领中'
                      : p.owner
                        ? TEAMS[p.owner].name
                        : '待占领'}
                </span>
                <i>
                  <b
                    style={{
                      width: `${p.progress * 100}%`,
                      background: p.capturing ? TEAMS[p.capturing].color : 'currentColor',
                    }}
                  />
                </i>
              </div>
            ))}
          </div>
          <p>
            {activePoint
              ? activePoint.contested
                ? '敌我同圈 · 清除敌军才能占领'
                : activePoint.owner === me?.team
                  ? '据点已控制 · 守住或支援其他点'
                  : '保持在圈内 · 正在夺取据点'
              : '占据据点持续得分 · 分兵推进，留人防守'}
          </p>
        </section>
      )}
      <div className="tactical-commands">
        {(
          [
            {
              kind: 'smoke',
              name: '烟幕掩护',
              key: 'F',
              ready: me?.smokeReadyAt || 0,
              icon: CloudFog,
            },
            {
              kind: 'radar',
              name: '战场侦察',
              key: 'G',
              ready: me?.radarReadyAt || 0,
              icon: Radar,
            },
          ] as const
        ).map((skill) => (
          <button
            key={skill.kind}
            aria-label={skill.name}
            className={skill.ready > time ? 'cooling' : ''}
            disabled={!me?.alive || skill.ready > time || menu || state?.status === 'finished'}
            onClick={() => {
              controls.current.ability(skill.kind, true);
              controls.current.ability(skill.kind, false);
              socket.emit('input', controls.current.packet());
              audio.current?.unlock();
            }}
          >
            <skill.icon size={21} />
            <div>
              <strong>{skill.name}</strong>
              <span>
                {skill.ready > time
                  ? `${Math.ceil(skill.ready - time)} 秒`
                  : skill.kind === 'smoke'
                    ? '掩护 5 秒'
                    : '共享视野 4 秒'}
              </span>
            </div>
            <kbd>{skill.key}</kbd>
          </button>
        ))}
        {me && me.radarUntil > time && (
          <span className="recon-active">侦察生效 · {Math.ceil(me.radarUntil - time)} 秒</span>
        )}
      </div>
      <div className="battle-left">
        <span className="hud-eyebrow">
          {controlMode ? '战场贡献' : '击毁排行'} <kbd>TAB</kbd>
        </span>
        {ranking.slice(0, 4).map((t, i) => (
          <div className={`mini-rank ${t.id === playerId ? 'active' : ''}`} key={t.id}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <i style={{ background: `#${t.color.toString(16).padStart(6, '0')}` }} />
            <b>{t.name}</b>
            <strong>{t.kills}</strong>
          </div>
        ))}
      </div>
      <div className="kill-feed">
        {state?.events
          .filter((e) => e.type === 'kill')
          .slice(-3)
          .map((e) => (
            <div key={e.id}>
              <b className={e.actor === playerId ? 'orange' : ''}>
                {state.tanks.find((t) => t.id === e.actor)?.name || '环境'}
              </b>
              <Crosshair size={12} />
              <span>{state.tanks.find((t) => t.id === e.target)?.name || '战车'}</span>
            </div>
          ))}
      </div>
      {notice && (
        <div className="pickup-notice" key={notice}>
          <Zap size={18} />
          {notice}
        </div>
      )}
      {me?.alive &&
        state?.fields.some(
          (f) =>
            f.kind === 'orbital' &&
            !allies(
              state,
              me,
              state.tanks.find((t) => t.id === f.owner),
            ) &&
            Math.hypot(me.x - f.x, me.z - f.z) < f.radius &&
            me.shieldUntil <= f.triggerAt &&
            me.invulnerableUntil <= f.triggerAt,
        ) && (
          <div className="strike-warning" role="status">
            <Crosshair size={17} />
            轨道锁定 · 立即冲刺撤离
          </div>
        )}
      {me && !me.alive && state?.status === 'playing' && (
        <div className="respawn-overlay">
          <Crosshair size={34} />
          <h2>战车被摧毁</h2>
          <p>{Math.max(1, Math.ceil(me.respawnAt - time))} 秒后重返战场</p>
          <span>寻找掩体，争夺补给，下一次出击更从容。</span>
        </div>
      )}
      <div className="battle-bottom">
        <div className="health-panel hud-panel">
          <div className="health-title">
            <Shield size={17} />
            <b>{me?.name || '指挥官'}</b>
            <span>装甲完整度</span>
          </div>
          <div className="health-row">
            <strong>
              {Math.ceil(me?.hp || 0)}
              <small> / {me?.maxHp || 100}</small>
            </strong>
            <span>
              {me?.kills || 0} <Crosshair size={13} /> {me?.deaths || 0} <Flag size={13} />
            </span>
          </div>
          <div className="health-track">
            <div style={{ width: `${((me?.hp || 0) / (me?.maxHp || 100)) * 100}%` }} />
          </div>
        </div>
        <div className="ability-bar">
          <div className={`ability hud-panel ${me && me.dashReadyAt > time ? 'cooling' : ''}`}>
            <Gauge />
            <div>
              <strong>
                {me && me.dashReadyAt > time
                  ? `${(me.dashReadyAt - time).toFixed(1)}s`
                  : '涡轮冲刺'}
              </strong>
              <span>
                <kbd>SHIFT</kbd> 快速位移
              </span>
            </div>
          </div>
          <div className="ability hud-panel">
            <Crosshair />
            <div>
              <strong>
                战术地雷 <em>×{me?.mines || 0}</em>
              </strong>
              <span>
                <kbd>E</kbd> 布置地雷
              </span>
            </div>
          </div>
          <div className="weapon-slot hud-panel">
            <Crosshair size={24} />
            <div>
              <strong>
                {me?.weapon && me.weapon !== 'standard' ? PICKUPS[me.weapon].name : '标准火炮'}
              </strong>
              <span>
                {me?.weapon && me.weapon !== 'standard'
                  ? `${Math.ceil(me.weaponUntil - time)} 秒`
                  : '无限弹药'}
              </span>
            </div>
          </div>
        </div>
        <div className="minimap hud-panel">
          <svg viewBox="-25 -25 50 50" aria-label="战场小地图">
            <rect x="-24" y="-24" width="48" height="48" fill="#343b35" />
            {state?.obstacles.map((o) => (
              <rect
                key={o.id}
                x={o.x - o.w / 2}
                y={o.z - o.d / 2}
                width={o.w}
                height={o.d}
                fill={o.kind === 'crate' ? '#a3966d' : '#7a8274'}
              />
            ))}
            {state?.controlPoints.map((p) => (
              <g key={p.id}>
                <circle
                  cx={p.x}
                  cy={p.z}
                  r={p.radius}
                  fill={p.owner ? TEAMS[p.owner].color + '55' : '#ffffff22'}
                  stroke={p.contested ? '#ffe17a' : p.owner ? TEAMS[p.owner].color : '#eee'}
                  strokeWidth=".4"
                />
                <text
                  x={p.x}
                  y={p.z + 1.3}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="4"
                  fontWeight="bold"
                >
                  {p.id}
                </text>
              </g>
            ))}
            {state?.fields.map((f) => (
              <circle
                key={`field-${f.id}`}
                cx={f.x}
                cy={f.z}
                r={f.radius}
                fill={
                  f.kind === 'smoke'
                    ? '#d1e8df45'
                    : f.kind === 'gravity'
                      ? '#b688ff24'
                      : '#ff846324'
                }
                stroke={
                  f.kind === 'smoke' ? '#d1e8df' : f.kind === 'gravity' ? '#b688ff' : '#ffb27a'
                }
                strokeWidth=".35"
              />
            ))}
            {state?.pickups
              .filter((p) => p.active)
              .map((p) => (
                <circle key={p.id} cx={p.x} cy={p.z} r="0.5" fill={PICKUPS[p.kind].color} />
              ))}
            {state?.tanks
              .filter((t) => t.alive && visible.has(t.id))
              .map((t) => (
                <circle
                  key={t.id}
                  cx={t.x}
                  cy={t.z}
                  r={t.id === playerId ? 1.1 : 0.75}
                  fill={t.id === playerId ? '#fff' : `#${t.color.toString(16).padStart(6, '0')}`}
                  stroke={t.id === playerId ? '#f77747' : 'none'}
                  strokeWidth="0.4"
                />
              ))}
          </svg>
          <span>{MAPS[room.settings.map].name}</span>
        </div>
      </div>
      <div className="active-effects">
        {effects.map((e) => (
          <span key={e.kind} style={{ color: PICKUPS[e.kind as keyof typeof PICKUPS].color }}>
            {PICKUPS[e.kind as keyof typeof PICKUPS].symbol}{' '}
            {e.kind === 'frost' ? '冰霜减速' : PICKUPS[e.kind as keyof typeof PICKUPS].name}{' '}
            <b>{Math.ceil(e.until - time)}s</b>
          </span>
        ))}
      </div>
      <div className="battle-hint">
        W A S D 移动 <i /> 鼠标瞄准 · 左键开火 <i /> 房间 {room.code}
      </div>
      <div className="touch-controls">
        {(['move', 'aim'] as const).map((kind) => (
          <div
            key={kind}
            role="region"
            aria-label={kind === 'move' ? '移动摇杆' : '瞄准射击摇杆'}
            className={`touch-control joystick ${kind}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              audio.current?.unlock();
              touch(kind, e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) touch(kind, e);
            }}
            onPointerUp={() => endTouch(kind)}
            onPointerCancel={() => endTouch(kind)}
          >
            <span>{kind === 'move' ? '移动' : '开火'}</span>
            <i style={{ transform: `translate(${joysticks[kind].x}px, ${joysticks[kind].y}px)` }} />
          </div>
        ))}
        <button
          className="touch-control touch-dash"
          aria-label="冲刺"
          onPointerDown={() => {
            touchAction('dash');
          }}
          onPointerUp={() => {
            controls.current.ability('dash', false);
          }}
          onPointerCancel={() => {
            controls.current.ability('dash', false);
          }}
        >
          <Zap />
        </button>
        <button
          className="touch-control touch-mine"
          aria-label="地雷"
          onPointerDown={() => {
            touchAction('mine');
          }}
          onPointerUp={() => {
            controls.current.ability('mine', false);
          }}
          onPointerCancel={() => {
            controls.current.ability('mine', false);
          }}
        >
          <Crosshair />
        </button>
      </div>
      {(scoreboard || state?.status === 'finished') && (
        <div className="game-overlay">
          <section className="results-panel hud-panel">
            <span className="eyebrow light">AFTER ACTION REPORT</span>
            <Trophy className="result-trophy" size={36} />
            <h1>{resultTitle}</h1>
            <p>
              {state?.status === 'finished'
                ? '每一次交锋，都让你更强。'
                : '保持移动，留意战场补给。'}
            </p>
            <div className="score-table">
              <div className="score-head">
                <span>排名 / 指挥官</span>
                <span>击毁</span>
                <span>阵亡</span>
                <span>{controlMode ? '占点' : 'K/D'}</span>
              </div>
              {ranking.map((t, i) => (
                <div key={t.id} className={t.id === playerId ? 'you' : ''}>
                  <span>
                    <em>{i + 1}</em>
                    <b style={{ color: t.team ? TEAMS[t.team].color : undefined }}>{t.name}</b>
                    {t.id === playerId && <small>你</small>}
                  </span>
                  <b>{t.kills}</b>
                  <span>{t.deaths}</span>
                  <span>
                    {controlMode ? t.captures : (t.kills / Math.max(1, t.deaths)).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
            {state?.status === 'finished' && (
              <div className="result-actions">
                {room.host === playerId ? (
                  <button className="primary-button" onClick={onRematch}>
                    再来一局 <ArrowLeft size={16} />
                  </button>
                ) : (
                  <p>等待房主开启下一局…</p>
                )}
                <button className="dark-secondary" onClick={onLeave}>
                  返回车库
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {menu && state?.status !== 'finished' && (
        <div className="game-overlay">
          <section className="pause-panel hud-panel">
            <button
              className="modal-close light-close"
              aria-label="关闭菜单"
              onClick={() => setMenu(false)}
            >
              <X />
            </button>
            <span className="eyebrow light">FIELD MANUAL</span>
            <h2>战场手册</h2>
            <p className="pause-note">联机对战仍在继续，保持警惕。</p>
            <div className="control-manual">
              <span>
                <kbd>空格</kbd>按住辅助瞄准并射击
              </span>
              <span>
                <kbd>Q</kbd>开启 / 关闭辅助瞄准
              </span>
              <span>
                <kbd>W A S D</kbd>移动战车
              </span>
              <span>
                <kbd>鼠标</kbd>自由瞄准 · 左键开火
              </span>
              <span>
                <kbd>SHIFT / 右键</kbd>涡轮冲刺 · 4 秒冷却
              </span>
              <span>
                <kbd>E</kbd>放置战术地雷
              </span>
              <span>
                <kbd>F</kbd>烟幕掩护 · 12 秒冷却
              </span>
              <span>
                <kbd>G</kbd>侦察识敌 · 15 秒冷却
              </span>
              <span>
                <kbd>TAB</kbd>查看击毁排行
              </span>
              <span>
                <kbd>ESC</kbd>打开 / 关闭菜单
              </span>
            </div>
            <p>
              据点模式：圈内停留 3 秒占领，敌方点需先中立化；争夺时不计分。每点每秒 1 分，先到 180
              分获胜，友军免伤。24 处补给持续补充。烟幕遮蔽视野，侦察、近身或开火可暴露位置。
            </p>
            <button className="primary-button" onClick={() => setMenu(false)}>
              继续战斗 <Crosshair size={18} />
            </button>
            <button className="dark-secondary" onClick={onLeave}>
              <ArrowLeft size={16} /> 离开对战
            </button>
          </section>
        </div>
      )}
      {failure && (
        <div className="game-overlay">
          <section className="pause-panel hud-panel">
            <h2>画面初始化失败</h2>
            <p>{failure}</p>
            <button className="primary-button" onClick={onLeave}>
              返回车库
            </button>
          </section>
        </div>
      )}
      {!state && !failure && (
        <div className="game-overlay">
          <div className="connecting">
            <Crosshair size={40} />
            <h2>正在进入战场</h2>
            <p>同步战车与补给数据…</p>
          </div>
        </div>
      )}
    </main>
  );
}
