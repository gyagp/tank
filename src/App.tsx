import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Crosshair,
  Crown,
  Flag,
  Gauge,
  Globe2,
  Hexagon,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Monitor,
  Plus,
  Radio,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Target,
  Trash2,
  Trophy,
  User,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  MAPS,
  TEAMS,
  CONTROL_GOAL,
  type MatchMode,
  MAX_PLAYERS,
  PICKUPS,
  FIXED_ROOM_CODE,
  ADVANCED_PICKUPS,
  PICKUP_TYPES,
  TANK_CLASSES,
  type Ack,
  type Difficulty,
  type GameState,
  type MapId,
  type RoomView,
  type TankClass,
  type PickupKind,
} from '../shared/types';

const GameView = lazy(() => import('./game/GameView'));
const socket = io({ autoConnect: false, reconnection: true, timeout: 6000 });
const readPref = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(`ironclad-${key}`) || fallback;
  } catch {
    return fallback;
  }
};
const savePref = (key: string, value: string) => {
  try {
    localStorage.setItem(`ironclad-${key}`, value);
  } catch {
    /* Private storage is optional. */
  }
};

function TankGlyph({
  classId = 'vanguard',
  className = '',
}: {
  classId?: TankClass;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 100 66" fill="none" aria-hidden="true">
      <path d="M15 35 27 22h44l16 14-3 17H17z" fill="currentColor" opacity=".4" />
      <rect x="14" y="40" width="73" height="17" rx="8" fill="currentColor" opacity=".7" />
      <rect x="21" y="44" width="60" height="9" rx="4" fill="var(--glyph-hole,#f3f2ed)" />
      <path
        d={
          classId === 'bastion'
            ? 'M33 20h29l13 16H29z'
            : classId === 'ghost'
              ? 'M43 21h19l9 14H34z'
              : 'M37 20h27l10 16H30z'
        }
        fill="currentColor"
      />
      <path d="M53 24 85 13" stroke="currentColor" strokeWidth={classId === 'bastion' ? 7 : 5} />
      <path d="m83 10 9-3 3 7-10 3" fill="currentColor" />
      <path d="M29 43v10m12-10v10m13-10v10m13-10v10" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <span />
        <span />
        <span />
      </div>
      <div className="brand-word">
        IRONCLAD<small>钢 铁 边 境</small>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<'garage' | 'armory' | 'guide'>('garage'),
    [modal, setModal] = useState<'join' | 'settings' | null>(null);
  const [connected, setConnected] = useState(false),
    [playerId, setPlayerId] = useState(''),
    [ping, setPing] = useState(0),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(() => readPref('name', '指挥官')),
    [tankClass, setTankClass] = useState<TankClass>('vanguard'),
    [map, setMap] = useState<MapId>('desert'),
    [mode, setMode] = useState<MatchMode>('control'),
    [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [muted, setMuted] = useState(() => readPref('muted', 'false') === 'true'),
    [reducedMotion, setReducedMotion] = useState(() => readPref('motion', 'false') === 'true');
  const [room, setRoom] = useState<RoomView | null>(null),
    [initialState, setInitialState] = useState<GameState | null>(null),
    [code, setCode] = useState<string>(FIXED_ROOM_CODE),
    [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    stateSeen = useRef(false);
  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  };
  useEffect(() => {
    const connect = () => {
      setConnected(true);
      setPlayerId(socket.id || '');
    };
    const disconnect = () => {
      setConnected(false);
      setRoom(null);
      setInitialState(null);
      stateSeen.current = false;
      notify('连接已断开，正在重新连接。恢复后可重新进入房间。');
    };
    const receiveRoom = (next: RoomView) => {
      setRoom(next);
      setMap(next.settings.map);
      if (next.status === 'lobby') {
        setInitialState(null);
        stateSeen.current = false;
      }
    };
    const receiveState = (next: GameState) => {
      if (!stateSeen.current) {
        stateSeen.current = true;
        setInitialState(next);
      }
    };
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    socket.on('room', receiveRoom);
    socket.on('state', receiveState);
    socket.connect();
    const pingTimer = setInterval(() => {
      if (!socket.connected) return;
      const start = performance.now();
      socket.timeout(3000).emit('ping-check', (err: Error | null) => {
        if (!err) setPing(Math.round(performance.now() - start));
      });
    }, 2500);
    return () => {
      socket.off('connect', connect);
      socket.off('disconnect', disconnect);
      socket.off('room', receiveRoom);
      socket.off('state', receiveState);
      socket.disconnect();
      clearInterval(pingTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  const request = (event: string, data?: unknown): Promise<Ack> =>
    new Promise((resolve) => {
      if (!socket.connected) {
        const ack = { ok: false, error: '服务器尚未连接，请稍后重试' };
        notify(ack.error);
        resolve(ack);
        return;
      }
      const callback = (err: Error | null, result: Ack) => {
        if (err) {
          notify('请求超时，请重试');
          resolve({ ok: false });
        } else {
          if (!result.ok) notify(result.error || '操作未完成');
          resolve(result);
        }
      };
      if (data === undefined) socket.timeout(5000).emit(event, callback);
      else socket.timeout(5000).emit(event, data, callback);
    });
  const create = async (quick: boolean) => {
    setBusy(true);
    savePref('name', name);
    stateSeen.current = false;
    setInitialState(null);
    const ack = await request('create', { name, classId: tankClass, map, difficulty, mode, quick });
    if (ack.ok && ack.room) {
      setRoom(ack.room);
      setToast('');
    }
    setBusy(false);
  };
  const join = async () => {
    setBusy(true);
    savePref('name', name);
    stateSeen.current = false;
    setInitialState(null);
    const ack = await request('join', { code, name, classId: tankClass });
    if (ack.ok) {
      setModal(null);
      setToast('');
      if (ack.room) setRoom(ack.room);
    }
    setBusy(false);
  };
  const leave = async () => {
    await request('leave');
    setRoom(null);
    setInitialState(null);
    stateSeen.current = false;
  };
  const toggleMute = () =>
    setMuted((v) => {
      savePref('muted', String(!v));
      return !v;
    });
  const copy = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      notify('房间码已复制，发送给朋友即可加入');
    } catch {
      notify(`房间码：${room.code}`);
    }
  };
  const selected = TANK_CLASSES[tankClass];
  if (room && (room.status === 'playing' || room.status === 'finished'))
    return (
      <>
        <Suspense
          fallback={
            <div className="loading-screen">
              <Crosshair size={40} />
              <h2>正在装载战场</h2>
            </div>
          }
        >
          <GameView
            socket={socket}
            room={room}
            playerId={playerId}
            initialState={initialState}
            onLeave={() => void leave()}
            onRematch={() => void request('rematch')}
            muted={muted}
            onMute={toggleMute}
            reducedMotion={reducedMotion}
            ping={ping}
          />
        </Suspense>
        {toast && (
          <div className="toast">
            <Radio size={16} />
            {toast}
          </div>
        )}
      </>
    );
  return (
    <div className={`app-shell ${reducedMotion ? 'reduce-motion' : ''}`}>
      <header className="site-header">
        <button className="brand-button" aria-label="返回车库" onClick={() => setPage('garage')}>
          <Brand />
        </button>
        <nav className="top-nav" aria-label="主导航">
          <button className={page === 'garage' ? 'active' : ''} onClick={() => setPage('garage')}>
            作战车库<span>PLAY</span>
          </button>
          <button className={page === 'armory' ? 'active' : ''} onClick={() => setPage('armory')}>
            军械库<span>ARSENAL</span>
          </button>
          <button className={page === 'guide' ? 'active' : ''} onClick={() => setPage('guide')}>
            作战指南<span>FIELD GUIDE</span>
          </button>
        </nav>
        <div className="header-right">
          <span className={`connection-status ${connected ? 'online' : ''}`}>
            <i />
            {connected ? '作战网络已连接' : '正在连接作战网络'}
          </span>
          <button className="icon-button" aria-label="设置" onClick={() => setModal('settings')}>
            <Settings2 size={19} />
          </button>
          <div className="profile-icon">
            <User size={19} />
          </div>
        </div>
      </header>
      <div className="app-body">
        <aside className="side-rail" aria-label="快捷导航">
          <button
            aria-label="作战车库"
            title="作战车库"
            className={page === 'garage' ? 'active' : ''}
            onClick={() => setPage('garage')}
          >
            <Crosshair size={22} />
          </button>
          <button
            aria-label="军械库"
            title="军械库"
            className={page === 'armory' ? 'active' : ''}
            onClick={() => setPage('armory')}
          >
            <Layers3 size={21} />
          </button>
          <button
            aria-label="作战指南"
            title="作战指南"
            className={page === 'guide' ? 'active' : ''}
            onClick={() => setPage('guide')}
          >
            <BookOpen size={21} />
          </button>
          <div className="rail-line" />
          <span className="vertical-type">EST. 2026 / ARMORED WARFARE</span>
          <div className="rail-bottom">
            <button aria-label={muted ? '开启音效' : '关闭音效'} onClick={toggleMute}>
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <span>01.0</span>
          </div>
        </aside>
        <main className="main-content">
          {page === 'garage' && (
            <>
              <div className="page-intro">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-cross">+</span> YOUR NEXT BATTLE STARTS HERE
                  </div>
                  <h1>
                    准备好，<span>指挥官。</span>
                  </h1>
                  <p>引擎已启动。选择你的战车，让战场记住你的名字。</p>
                </div>
                <div className="session-tag">
                  <span className="pulse-dot" /> {mode === 'control' ? '据点争夺' : '自由混战'}{' '}
                  <i /> 最多 8 人 <span className="tag-outline">3D ARENA</span>
                </div>
              </div>
              <div className="garage-grid">
                <section className="hero-card">
                  <img
                    className="hero-art"
                    src="/assets/hangar-hero.webp"
                    fetchPriority="high"
                    alt="夕阳沙漠哨站中的军绿色主战坦克"
                  />
                  <div className="hero-shade" />
                  <div className="hero-top">
                    <span className="hero-badge">
                      <span /> 全员就绪 · 随时出击
                    </span>
                    <span className="hero-coordinate">34°16′N &nbsp; 108°56′E</span>
                  </div>
                  <div className="hero-copy">
                    <span className="hero-eyebrow">BUILT FOR THE BATTLE.</span>
                    <h2>
                      钢铁交锋，
                      <br />
                      一触即发<span>。</span>
                    </h2>
                    <p>
                      火力、策略，还有一点野心。
                      <br />
                      在下一场交锋中，打出你的风格。
                    </p>
                  </div>
                  <div className="hero-bottom">
                    <div className="hero-facts">
                      <span>
                        <Users size={16} /> 实时联机
                      </span>
                      <span>
                        <Box size={16} /> {PICKUP_TYPES.length} 种战术补给
                      </span>
                      <span>
                        <Target size={16} /> 智能 AI 对手
                      </span>
                    </div>
                    <span className="hero-index">// IRONCLAD — 001</span>
                  </div>
                  <div className="hero-corner top-left" />
                  <div className="hero-corner bottom-right" />
                </section>
                <section className="loadout-card">
                  <div className="section-kicker">
                    <span>
                      <Shield size={15} /> 战车配置
                    </span>
                    <span>LOADOUT / {selected.number}</span>
                  </div>
                  <div className="vehicle-heading">
                    <div>
                      <h2>
                        {selected.name}
                        <span>{selected.en}</span>
                      </h2>
                      <span className="role-tag">{selected.role}</span>
                    </div>
                    <TankGlyph classId={tankClass} className="selected-tank-glyph" />
                  </div>
                  <div className="tank-options" role="group" aria-label="选择战车">
                    {Object.entries(TANK_CLASSES).map(([id, t]) => (
                      <button
                        key={id}
                        className={tankClass === id ? 'selected' : ''}
                        aria-pressed={tankClass === id}
                        onClick={() => setTankClass(id as TankClass)}
                      >
                        <TankGlyph classId={id as TankClass} />
                        <span>{t.name}</span>
                        {tankClass === id && <i />}
                      </button>
                    ))}
                  </div>
                  <div className="tank-stats">
                    {[
                      { name: '火力', value: selected.power, icon: Crosshair },
                      { name: '装甲', value: selected.armor, icon: Shield },
                      { name: '机动', value: selected.mobility, icon: Gauge },
                    ].map((s) => (
                      <div key={s.name}>
                        <s.icon size={13} />
                        <span>{s.name}</span>
                        <div className="stat-segments">
                          {Array.from({ length: 10 }, (_, i) => (
                            <i key={i} className={i < s.value / 10 ? 'filled' : ''} />
                          ))}
                        </div>
                        <strong>{s.value}</strong>
                      </div>
                    ))}
                  </div>
                  <label className="callsign">
                    <User size={14} />
                    <span>你的呼号</span>
                    <input
                      aria-label="你的呼号"
                      maxLength={16}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => savePref('name', name)}
                      placeholder="输入指挥官名称"
                    />
                    <span className="edit-hint">EDIT</span>
                  </label>
                  <div className="loadout-foot">
                    <span className="ready-dot" /> 战车已整备 <span>准备出击</span>
                  </div>
                </section>
              </div>
              <div className="mode-selector" role="group" aria-label="作战模式">
                <button
                  aria-pressed={mode === 'control'}
                  className={mode === 'control' ? 'selected' : ''}
                  onClick={() => setMode('control')}
                >
                  <Flag size={21} />
                  <div>
                    <strong>据点争夺</strong>
                    <span>双队协作 · 控点积累 180 分</span>
                  </div>
                  <small>推荐</small>
                </button>
                <button
                  aria-pressed={mode === 'deathmatch'}
                  className={mode === 'deathmatch' ? 'selected' : ''}
                  onClick={() => setMode('deathmatch')}
                >
                  <Crosshair size={21} />
                  <div>
                    <strong>自由混战</strong>
                    <span>各自为战 · 击毁目标获胜</span>
                  </div>
                </button>
              </div>
              <div className="deployment-bar">
                <div className="deployment-copy">
                  <div className="deploy-icon">
                    <Crosshair size={25} />
                  </div>
                  <div>
                    <strong>下一场胜利，由你开启。</strong>
                    <span>独自磨练，或与好友一较高下。</span>
                  </div>
                </div>
                <div className="deployment-actions">
                  <button
                    className="outline-button"
                    onClick={() => {
                      setCode(FIXED_ROOM_CODE);
                      setModal('join');
                    }}
                  >
                    <Users size={17} /> 加入房间
                  </button>
                  <button
                    className="outline-button"
                    disabled={busy || !connected}
                    onClick={() => void create(false)}
                  >
                    <Plus size={18} /> 创建房间
                  </button>
                  <button
                    className="primary-button quick-button"
                    disabled={busy || !connected}
                    onClick={() => void create(true)}
                  >
                    {busy ? <LoaderCircle className="spin" size={20} /> : <Crosshair size={19} />}{' '}
                    快速出击 <span>人机对战</span>
                    <ArrowRight size={19} />
                  </button>
                </div>
              </div>
              <section className="maps-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      选择战场 <span>CHOOSE YOUR BATTLEGROUND</span>
                    </h2>
                    <p>不同地形，相同目标：成为最后的赢家。</p>
                  </div>
                  <div className="difficulty-select">
                    <SlidersHorizontal size={14} />
                    <label htmlFor="difficulty">AI 难度</label>
                    <select
                      id="difficulty"
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                    >
                      <option value="easy">新兵</option>
                      <option value="normal">标准</option>
                      <option value="hard">精英</option>
                    </select>
                  </div>
                </div>
                <div className="map-grid">
                  {Object.entries(MAPS).map(([id, m], i) => (
                    <button
                      key={id}
                      className={`map-card ${map === id ? 'selected' : ''}`}
                      aria-pressed={map === id}
                      onClick={() => setMap(id as MapId)}
                    >
                      <img src={`/assets/map-${id}.webp`} alt={`${m.name}地图场景`} />
                      <div className="map-image-shade" />
                      <span className="map-number">
                        0{i + 1} <i /> {m.en}
                      </span>
                      <div className="map-info">
                        <div>
                          <h3>{m.name}</h3>
                          <p>{m.description}</p>
                        </div>
                        <span className="map-check">
                          {map === id ? <Check size={17} /> : <ArrowRight size={17} />}
                        </span>
                      </div>
                      {map === id && <span className="selected-map-label">已选择</span>}
                    </button>
                  ))}
                </div>
              </section>
              <section className="field-tip">
                <div>
                  <Zap size={18} />
                  <b>战地速报</b>
                  <span>
                    24 处补给，4–6 秒补充。F 烟幕掩护推进，G
                    侦察识破伏击；分兵占领据点，持续赚取团队积分。
                  </span>
                </div>
                <button onClick={() => setPage('armory')}>
                  探索军械库 <ArrowRight size={15} />
                </button>
              </section>
            </>
          )}
          {page === 'armory' && (
            <section className="armory-page">
              <div className="page-intro">
                <div>
                  <div className="eyebrow">KNOW YOUR FIREPOWER</div>
                  <h1>
                    优势，<span>全副武装。</span>
                  </h1>
                  <p>三款战车，十六种补给。用进阶武装打出你的战场连招。</p>
                </div>
                <button className="outline-button" onClick={() => setPage('garage')}>
                  <ArrowLeft size={16} /> 返回车库
                </button>
              </div>
              <div className="class-grid">
                {Object.entries(TANK_CLASSES).map(([id, t]) => (
                  <button
                    key={id}
                    className={`class-card ${tankClass === id ? 'selected' : ''}`}
                    onClick={() => {
                      setTankClass(id as TankClass);
                      notify(`${t.name}已装备，可返回车库出击`);
                    }}
                  >
                    <div className="class-card-top">
                      <span>
                        0{Object.keys(TANK_CLASSES).indexOf(id) + 1} / {t.role}
                      </span>
                      {tankClass === id ? <Check size={19} /> : <Plus size={19} />}
                    </div>
                    <TankGlyph classId={id as TankClass} />
                    <h2>
                      {t.name} <span>{t.en}</span>
                    </h2>
                    <p>{t.description}</p>
                    <div className="class-numbers">
                      <span>
                        <strong>{t.hp}</strong>生命值
                      </span>
                      <span>
                        <strong>{t.speed}</strong>移动速度
                      </span>
                      <span>
                        <strong>{t.cooldown}s</strong>射击间隔
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="section-heading arsenal-heading">
                <div>
                  <h2>
                    战术补给 <span>TACTICAL SUPPLIES / {PICKUP_TYPES.length}</span>
                  </h2>
                  <p>驶过发光补给即可拾取，武器效果互相替换，增益可以叠加。</p>
                </div>
                <span className="tag-outline">战场定时刷新</span>
              </div>
              <div className="pickup-grid">
                {Object.entries(PICKUPS)
                  .sort(
                    ([a], [b]) =>
                      Number(ADVANCED_PICKUPS.includes(b as PickupKind)) -
                      Number(ADVANCED_PICKUPS.includes(a as PickupKind)),
                  )
                  .map(([id, p], i) => (
                    <article
                      className={`pickup-card ${ADVANCED_PICKUPS.includes(id as PickupKind) ? 'advanced' : ''}`}
                      key={id}
                    >
                      <div
                        className="pickup-icon"
                        style={{ color: p.color, background: `${p.color}20` }}
                      >
                        {p.symbol}
                      </div>
                      <span className="pickup-num">{String(i + 1).padStart(2, '0')}</span>
                      <h3>{p.name}</h3>
                      <span className="pickup-en">{p.en}</span>
                      {ADVANCED_PICKUPS.includes(id as PickupKind) && (
                        <span className="advanced-tag">进阶武装</span>
                      )}
                      <p>{p.description}</p>
                    </article>
                  ))}
              </div>
            </section>
          )}
          {page === 'guide' && (
            <section className="guide-page">
              <div className="page-intro">
                <div>
                  <div className="eyebrow">A GOOD COMMANDER NEVER STOPS LEARNING</div>
                  <h1>
                    先读懂战场，<span>再主宰战场。</span>
                  </h1>
                  <p>一分钟上手，下一次交锋就用得上。</p>
                </div>
              </div>
              <div className="guide-grid">
                <article className="guide-card">
                  <div className="guide-card-title">
                    <Monitor />
                    <h2>掌控你的战车</h2>
                  </div>
                  <div className="key-guide">
                    <span>
                      <kbd>空格</kbd>
                      <b>辅助锁定射击</b>
                      <small>按住即可边移动边射击</small>
                    </span>
                    <span>
                      <kbd>Q</kbd>
                      <b>切换辅助瞄准</b>
                      <small>鼠标左键始终自由瞄准</small>
                    </span>
                    <span>
                      <kbd>W A S D</kbd>
                      <b>移动战车</b>
                      <small>也支持方向键</small>
                    </span>
                    <span>
                      <kbd>鼠标</kbd>
                      <b>独立瞄准</b>
                      <small>左键自由瞄准，持续射击</small>
                    </span>
                    <span>
                      <kbd>SHIFT / 右键</kbd>
                      <b>涡轮冲刺</b>
                      <small>4 秒冷却，快速脱离火线</small>
                    </span>
                    <span>
                      <kbd>E</kbd>
                      <b>战术地雷</b>
                      <small>0.8 秒后武装，最多携带 3 枚</small>
                    </span>
                    <span>
                      <kbd>F</kbd>
                      <b>烟幕掩护</b>
                      <small>5 秒遮蔽视野，12 秒冷却</small>
                    </span>
                    <span>
                      <kbd>G</kbd>
                      <b>战场侦察</b>
                      <small>4 秒共享侦察，15 秒冷却</small>
                    </span>
                    <span>
                      <kbd>TAB</kbd>
                      <b>实时比分</b>
                      <small>按住查看所有玩家</small>
                    </span>
                    <span>
                      <kbd>ESC</kbd>
                      <b>战场菜单</b>
                      <small>联机比赛不会暂停</small>
                    </span>
                  </div>
                  <p className="guide-mobile">
                    <Maximize2 size={17} />{' '}
                    触屏设备使用左侧移动摇杆与右侧瞄准射击摇杆，横屏体验更佳。
                  </p>
                </article>
                <article className="guide-card multiplayer-guide">
                  <div className="guide-card-title">
                    <Globe2 />
                    <h2>和朋友一起上场</h2>
                  </div>
                  <ol>
                    <li>
                      <span>01</span>
                      <div>
                        <h3>创建你的房间</h3>
                        <p>选择战车、地图与呼号，点击「创建房间」。</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <h3>加入固定房间 {FIXED_ROOM_CODE}</h3>
                        <p>让好友打开同一个游戏网址，点击加入房间即可。</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <h3>补充电脑，即刻开战</h3>
                        <p>房主可以加入 AI、调整规则，所有人准备好即可出击。</p>
                      </div>
                    </li>
                  </ol>
                  <div className="guide-note">
                    <Wifi size={19} />
                    <p>同一局最多 8 辆战车。真人和电脑同场竞技；局域网玩家需访问同一台服务器。</p>
                  </div>
                </article>
              </div>
              <div className="tactics-grid">
                {[
                  {
                    icon: Shield,
                    title: '掩体是你的第二层装甲',
                    text: '钢墙可以抵挡炮火。木箱能被摧毁，油桶会爆炸——别在油桶旁久留。',
                  },
                  {
                    icon: Box,
                    title: '让补给为你创造机会',
                    text: '低血量时寻找绿色维修包；护盾适合强行突破，散射则让近距离对抗更有把握。',
                  },
                  {
                    icon: Trophy,
                    title: '分兵控点，团队取胜',
                    text: '默认双队争夺 A/B/C，每点每秒 1 分，180 分获胜。敌我同圈停止得分。可切换自由混战，以击毁数决胜。',
                  },
                ].map((t) => (
                  <article key={t.title}>
                    <t.icon size={23} />
                    <h3>{t.title}</h3>
                    <p>{t.text}</p>
                  </article>
                ))}
              </div>
              <button className="primary-button guide-start" onClick={() => setPage('garage')}>
                准备好了，前往车库 <ArrowRight size={18} />
              </button>
            </section>
          )}
          <footer className="site-footer">
            <div>
              <span className="footer-dot" /> IRONCLAD <span>钢铁边境</span>
              <i /> 为每一次精彩交锋而造。
            </div>
            <div>
              NO DOWNLOAD. JUST PLAY. <span>v1.0</span>
            </div>
          </footer>
        </main>
      </div>
      {room?.status === 'lobby' && (
        <div className="modal-backdrop">
          <section className="room-modal" aria-label="对战准备室">
            <div className="room-visual">
              <img src={`/assets/map-${room.settings.map}.webp`} alt="当前对战地图" />
              <div />
              <button className="room-back" onClick={() => void leave()}>
                <ArrowLeft size={17} /> 离开房间
              </button>
              <span className="eyebrow light">SQUAD ASSEMBLY</span>
              <h2>集结完毕，即刻出击。</h2>
              <p>
                {MAPS[room.settings.map].name} /{' '}
                {room.settings.mode === 'control' ? '据点争夺' : '自由混战'}
              </p>
            </div>
            <div className="room-content">
              <div className="room-heading">
                <div>
                  <span className="eyebrow">YOUR PRIVATE BATTLEGROUND</span>
                  <h2>
                    对战准备室{' '}
                    <span>
                      {room.players.length} / {MAX_PLAYERS}
                    </span>
                  </h2>
                </div>
                <button className="room-code" onClick={() => void copy()} aria-label="复制房间码">
                  <small>房间码</small>
                  <strong data-testid="room-code">{room.code}</strong>
                  <Copy size={17} />
                </button>
              </div>
              <div className="room-columns">
                <div>
                  <div className="room-section-label">
                    指挥官名单 <span>COMMANDERS</span>
                  </div>
                  <div className="player-list">
                    {room.players.map((p, i) => (
                      <div className="player-row" key={p.id}>
                        <span className="player-number">0{i + 1}</span>
                        <div
                          className="player-avatar"
                          style={{ color: `#${p.color.toString(16).padStart(6, '0')}` }}
                        >
                          <TankGlyph classId={p.classId} />
                        </div>
                        <div className="player-info">
                          <strong>
                            {p.name}
                            {p.team && (
                              <small className="team-tag" style={{ color: TEAMS[p.team].color }}>
                                {TEAMS[p.team].name}
                              </small>
                            )}
                            {p.id === playerId && <small>你</small>}
                            {p.id === room.host && <Crown size={13} />}
                          </strong>
                          <span>
                            {TANK_CLASSES[p.classId].name} · {p.bot ? '电脑战车' : '真人玩家'}
                          </span>
                        </div>
                        {p.bot && room.host === playerId ? (
                          <button
                            className="icon-button"
                            aria-label={`移除${p.name}`}
                            onClick={() => void request('remove-bot', p.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : (
                          <span className="player-ready">
                            <Check size={13} /> 就绪
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {room.host === playerId && room.players.length < 8 && (
                    <button className="add-bot-button" onClick={() => void request('add-bot')}>
                      <Plus size={17} /> 添加电脑对手 <span>AI COMMANDER</span>
                    </button>
                  )}
                </div>
                <div className="room-settings">
                  <div className="room-section-label">
                    对战规则 <span>RULES</span>
                  </div>
                  <label>
                    作战模式
                    <select
                      aria-label="房间作战模式"
                      disabled={room.host !== playerId}
                      value={room.settings.mode || 'deathmatch'}
                      onChange={(e) => void request('settings', { mode: e.target.value })}
                    >
                      <option value="control">据点争夺 · 双队协作</option>
                      <option value="deathmatch">自由混战</option>
                    </select>
                  </label>
                  <label>
                    战场
                    <select
                      aria-label="房间地图"
                      disabled={room.host !== playerId}
                      value={room.settings.map}
                      onChange={(e) => void request('settings', { map: e.target.value })}
                    >
                      {Object.entries(MAPS).map(([id, m]) => (
                        <option key={id} value={id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    电脑难度
                    <select
                      aria-label="房间电脑难度"
                      disabled={room.host !== playerId}
                      value={room.settings.difficulty}
                      onChange={(e) => void request('settings', { difficulty: e.target.value })}
                    >
                      <option value="easy">新兵</option>
                      <option value="normal">标准</option>
                      <option value="hard">精英</option>
                    </select>
                  </label>
                  <div className="room-rule-row">
                    <label>
                      {room.settings.mode === 'control' ? '团队目标' : '目标击毁'}
                      <select
                        aria-label="目标击毁"
                        disabled={room.host !== playerId || room.settings.mode === 'control'}
                        value={room.settings.mode === 'control' ? CONTROL_GOAL : room.settings.goal}
                        onChange={(e) => void request('settings', { goal: Number(e.target.value) })}
                      >
                        {(room.settings.mode === 'control' ? [CONTROL_GOAL] : [6, 12, 20]).map(
                          (v) => (
                            <option key={v} value={v}>
                              {v} {room.settings.mode === 'control' ? '分' : '辆'}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      时长
                      <select
                        aria-label="对战时长"
                        disabled={room.host !== playerId}
                        value={room.settings.duration}
                        onChange={(e) =>
                          void request('settings', { duration: Number(e.target.value) })
                        }
                      >
                        <option value={120}>2 分钟</option>
                        <option value={180}>3 分钟</option>
                        <option value={300}>5 分钟</option>
                      </select>
                    </label>
                  </div>
                  <div className="room-settings-note">
                    <Radio size={15} />
                    <p>
                      据点模式自动平衡分队，队友免伤。围绕 A/B/C
                      夺点、防守、争夺补给；同队共享侦察。
                    </p>
                  </div>
                </div>
              </div>
              <div className="room-bottom">
                <span>
                  <span className="ready-dot" />
                  {room.host === playerId ? '你是房主，准备好后即可开始' : '等待房主开始对战…'}
                </span>
                {room.host === playerId && (
                  <button
                    className="primary-button"
                    disabled={room.players.length < 2}
                    onClick={() => void request('start')}
                  >
                    开始对战 <ArrowRight size={18} />
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="small-modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'join' ? '加入房间' : '游戏设置'}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" aria-label="关闭" onClick={() => setModal(null)}>
              <X size={21} />
            </button>
            {modal === 'join' ? (
              <>
                <div className="modal-emblem">
                  <Users size={27} />
                </div>
                <span className="eyebrow">BETTER TOGETHER</span>
                <h2>加入你的战友</h2>
                <p>房间号固定为 {FIXED_ROOM_CODE}，房主创建后即可加入准备室。</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void join();
                  }}
                >
                  <label className="input-label" htmlFor="room-code-input">
                    房间码
                  </label>
                  <input
                    id="room-code-input"
                    className="code-input"
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 5),
                      )
                    }
                    placeholder={FIXED_ROOM_CODE}
                    maxLength={5}
                    autoComplete="off"
                  />
                  <button
                    className="primary-button"
                    disabled={code.length !== 5 || busy || !connected}
                    type="submit"
                    autoFocus
                  >
                    {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{' '}
                    加入战场
                  </button>
                </form>
                <div className="modal-foot">
                  <LockKeyhole size={13} /> 无需注册 · 即刻联机
                </div>
              </>
            ) : (
              <>
                <div className="modal-emblem">
                  <Settings2 size={27} />
                </div>
                <span className="eyebrow">MAKE IT YOURS</span>
                <h2>游戏设置</h2>
                <p>按照你的偏好，调整战场体验。</p>
                <div className="setting-row">
                  <div>
                    <strong>战斗音效</strong>
                    <span>炮火、爆炸与补给提示音</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={!muted}
                    aria-label="战斗音效"
                    className={`toggle ${!muted ? 'on' : ''}`}
                    onClick={toggleMute}
                  >
                    <i />
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>减少动态效果</strong>
                    <span>关闭镜头震动，减少粒子</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={reducedMotion}
                    aria-label="减少动态效果"
                    className={`toggle ${reducedMotion ? 'on' : ''}`}
                    onClick={() =>
                      setReducedMotion((v) => {
                        savePref('motion', String(!v));
                        return !v;
                      })
                    }
                  >
                    <i />
                  </button>
                </div>
                <div className="settings-network">
                  <Wifi size={17} />
                  <span>{connected ? '服务器连接正常' : '正在连接服务器…'}</span>
                  <b>{ping} ms</b>
                </div>
                <button className="primary-button" onClick={() => setModal(null)}>
                  完成 <Check size={17} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Radio size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
