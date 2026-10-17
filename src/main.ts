// ゲーム全体の状態機械と配線。
//   title → hub（出撃・祭壇・書庫・形見の棚）→ play ⇄ (level / pause) → result → hub
// RunSim（戦闘ロジック）・MetaService（亡霊・供物・形見・ラン終了処理）・表示・入力をつなぐだけ。
import balance from "../data/balance.json" with { type: "json" };
import { loadBalance } from "./data/dataLoader.ts";
import { InputRouter } from "./input/inputRouter.ts";
import { TouchControls } from "./input/touchControls.ts";
import { MetaService, uuid } from "./meta/metaService.ts";
import { SaveRepository, type KV } from "./meta/saveRepository.ts";
import { Platform, urlFlag } from "./platform.ts";
import { Settings } from "./settings.ts";
import { RunSim, STEP } from "./sim/runSim.ts";
import { Menus, type SortieRequest } from "./ui/menus.ts";
import { BattleView } from "./view/battleView.ts";
import { Hud } from "./view/hud.ts";
import { Sfx } from "./view/sfx.ts";

type State = "title" | "hub" | "play" | "level" | "pause" | "settings" | "result" | "loadtest";
const MAX_STEPS_PER_FRAME = 4;   // 端末が遅い時は「処理落ち（ゆっくり）」にして、追いつこうとする悪循環を防ぐ

class MemoryFallbackKV implements KV {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

function storage(): KV {
  try {
    const t = "__dl_probe";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return new MemoryFallbackKV();   // 保存できない環境でも遊べる（閉じると消える）
  }
}

class Game {
  state: State = "title";
  readonly D;
  readonly repo: SaveRepository;
  readonly meta: MetaService;
  sim: RunSim | null = null;
  endTimer = 0;
  loadText = "";
  private load = { time: 0, frames: 0, upd: 0, worst: 0, bench: false };

  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly router = new InputRouter();
  readonly touch: TouchControls;
  readonly view = new BattleView();
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  readonly menus: Menus;
  W = 0;
  H = 0;
  DPR = 1;
  perf = { fps: 60, frameMs: 16.7, frames: 0, acc: 0 };
  private last = 0;
  private acc = 0;

  constructor() {
    const { D, errors } = loadBalance(balance);
    if (errors.length) {
      document.body.textContent = "データ定義にエラーがあります: " + errors.join(" / ");
      throw new Error(errors.join("\n"));
    }
    this.D = D;
    Settings.load();
    const demo = urlFlag("demo") !== null;
    this.repo = new SaveRepository(storage(), demo ? "death_legacy.demo" : "death_legacy.save");
    this.repo.load();
    this.meta = new MetaService(this.repo, D);
    if (demo) this.seedDemo();

    this.cv = document.getElementById("cv") as HTMLCanvasElement;
    this.ctx = this.cv.getContext("2d", { alpha: false })!;
    this.touch = new TouchControls(this.router);
    this.touch.attach(this.cv);
    this.menus = new Menus(document.getElementById("ui")!, this.meta);
    this.menus.onSortie = (r) => this.sortie(r);
    this.sfx.setVolume(Settings.volume);
    if (urlFlag("fps") !== null) Settings.debugHud = true;

    const r = this.router;
    r.attach();
    r.onAnyInput = () => this.sfx.unlock();
    r.onDash = () => {
      if (this.state === "play" && this.sim) {
        const m = r.moveVector();
        this.sim.tryDash(m.x, m.y);
      }
    };
    r.onPause = () => {
      if (this.state === "play") this.pause();
      else if (this.state === "pause") this.setState("play");
    };
    r.onDebug = () => { Settings.debugHud = !Settings.debugHud; Settings.save(); };
    r.onHotkey = (i) => { if (this.state === "level" || this.state === "result") this.menus.pressHotkey(i); };
    r.onTouchMode = (on) => { this.menus.touchMode = on; };
    r.onBlur = () => { if (this.state === "play") this.pause(); };
    r.setTouchMode(Platform.prefersTouch());
    this.menus.touchMode = r.touchMode;
    document.addEventListener("pointerdown", () => this.sfx.unlock(), { capture: true });

    addEventListener("resize", () => this.resize());
    this.resize();
    if (urlFlag("bench") !== null) {
      this.startLoadTest(true);
    } else {
      this.toTitle();
    }
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  }

  // ---------------------------------------------------------------- loop
  resize(): void {
    const r = this.cv.getBoundingClientRect();
    // 画面の細かさは最大2倍まで（3倍で描いても見た目はほぼ同じで、描く量は2倍以上になる）
    this.DPR = Math.min(2, window.devicePixelRatio || 1) * (urlFlag("lowres") !== null ? 0.5 : 1);
    this.W = r.width;
    this.H = r.height;
    this.cv.width = Math.max(1, Math.round(this.W * this.DPR));
    this.cv.height = Math.max(1, Math.round(this.H * this.DPR));
    this.touch.W = this.W;
    this.touch.H = this.H;
  }

  frame(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    const p = this.perf;
    p.frames++;
    p.acc += dt;
    if (p.acc >= 0.5) {
      p.fps = p.frames / p.acc;
      p.frameMs = (p.acc / p.frames) * 1000;
      p.frames = 0;
      p.acc = 0;
    }
    if (this.cv.clientWidth !== Math.round(this.W) || this.cv.clientHeight !== Math.round(this.H)) this.resize();

    if ((this.state === "play" || this.state === "loadtest") && this.sim) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) {
        this.acc -= STEP;
        n++;
        this.tick();
        if (this.state !== "play" && this.state !== "loadtest") { this.acc = 0; break; }
      }
      if (n >= MAX_STEPS_PER_FRAME) this.acc = 0;
    } else {
      this.acc = 0;
    }
    if (this.state === "loadtest") this.loadTestFrame(dt);
    this.view.update(dt);
    this.hud.update(dt);
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** 戦闘は固定ステップ（1/60秒）で進める → seed 再現性 */
  private tick(): void {
    const sim = this.sim!;
    const m = this.router.moveVector();
    sim.step(STEP, m.x, m.y);
    for (const e of sim.drainEvents()) {
      if (e.type === "fx") this.view.addFx(e);
      else if (e.type === "sfx") this.sfx.play(e.name);
      else if (e.type === "toast") this.hud.toast(e.text);
      else if (e.type === "shake" && Settings.shake) this.view.addShake(e.amount);
    }
    if (this.state === "loadtest") {
      sim.pending = 0;
      return;
    }
    if (sim.checkpointDue()) this.meta.checkpoint(sim.run_id, sim.snapshot());
    if (sim.result !== "") {
      this.endTimer -= STEP;
      if (this.endTimer <= 0) this.finish();
    } else if (sim.pending > 0) {
      this.levelUp();
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    ctx.fillStyle = "#0b1014";
    ctx.fillRect(0, 0, this.W, this.H);
    if (!this.sim) {
      this.drawTitleBg();
      return;
    }
    this.view.draw(ctx, this.sim, this.W, this.H, this.router.touchMode);
    this.hud.draw(ctx, this.sim, this.W, this.H, this.router.touchMode, Settings.debugHud || this.state === "loadtest", this.perf);
    if (this.router.touchMode && this.state === "play") this.touch.draw(ctx, this.sim);
  }

  private drawTitleBg(): void {
    const ctx = this.ctx, t = performance.now() / 1000;
    ctx.fillStyle = "#8ff0e0";
    for (let i = 0; i < 18; i++) {
      const x = ((i * 157 + t * 12 * (1 + (i % 3))) % (this.W + 80)) - 40;
      const y = this.H * (0.2 + (0.6 * ((i * 37) % 100)) / 100) + Math.sin(t + i) * 10;
      ctx.globalAlpha = 0.08 + 0.05 * Math.sin(t * 0.7 + i);
      ctx.beginPath();
      ctx.arc(x, y, 10 + (i % 4) * 3, Math.PI, 0);
      ctx.lineTo(x + 12, y + 14);
      ctx.lineTo(x - 12, y + 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- states
  setState(s: State): void {
    this.state = s;
    this.router.gameplayEnabled = s === "play";
    this.touch.reset();
    if (s === "play" || s === "loadtest") this.menus.hideAll();
  }

  toTitle(): void {
    this.dropSim();
    this.setState("title");
    this.menus.showTitle(this.meta.S.active_run, {
      hub: () => this.toHub(),
      resume: () => this.resume(),
      abandon: () => { this.meta.abandonActive(); this.toTitle(); },
      settings: () => this.openSettings(() => this.toTitle()),
    });
  }

  toHub(): void {
    this.dropSim();
    this.setState("hub");
    if (this.meta.S.pending_ghost || this.meta.S.pending_heirloom) {
      this.menus.showPending(() => this.toHub());
      return;
    }
    this.menus.showHub(() => this.toTitle());
  }

  private dropSim(): void {
    this.sim = null;
    this.view.clear();
  }

  private begin(s: RunSim): void {
    this.sim = s;
    this.endTimer = 1.3;
    this.setState("play");
    if (s.ghost) {
      this.hud.toast(`${s.ghost.rec.display_name} が付き従う`);
      this.sfx.play("ghost");
    }
  }

  private sortie(r: SortieRequest): void {
    const rid = uuid();
    // 出撃確定の瞬間に予約を保存（亡霊・形見は reserved）
    if (!this.meta.reserve(rid, r.seed, r.mode, r.weapon, r.ghostId, r.heirId)) {
      this.toHub();
      return;
    }
    const s = new RunSim(this.D, {
      run_id: rid, seed: r.seed, mode: r.mode, weapon: r.weapon,
      ghost: r.ghostId ? this.meta.getGhost(r.ghostId) : null, heirloom: r.heirId ? this.meta.getHeir(r.heirId) : null, card_mods: this.meta.cardMods(),
    });
    this.menus.hub.ghost = "";
    this.menus.hub.heir = "";
    if (r.heirId) this.hud.toast("形見を身につけた");
    this.begin(s);
  }

  private resume(): void {
    const ar = this.meta.S.active_run;
    if (!ar) return this.toTitle();
    this.begin(new RunSim(this.D, {
      run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon,
      ghost: ar.ghost_id ? this.meta.getGhost(ar.ghost_id) : null, heirloom: ar.heirloom_id ? this.meta.getHeir(ar.heirloom_id) : null,
      card_mods: this.meta.cardMods(), checkpoint: ar.checkpoint,
    }));
  }

  private levelUp(): void {
    const sim = this.sim!;
    this.setState("level");
    this.sfx.play("level");
    this.menus.showLevel(sim, sim.rollChoices(), (c) => {
      sim.applyChoice(c);
      if (sim.pending > 0) this.levelUp();
      else this.setState("play");
    });
  }

  private pause(): void {
    const sim = this.sim!;
    this.setState("pause");
    this.menus.showPause(sim, {
      resume: () => this.setState("play"),
      settings: () => this.openSettings(() => this.pause()),
      retire: () => { sim.end("retired"); this.finish(); },
    });
  }

  private finish(): void {
    const sim = this.sim!;
    const res = sim.result === "" ? "retired" : sim.result;
    const out = this.meta.settle(sim.summary(), res);   // 冪等: 2回呼ばれても重複しない
    this.setState("result");
    this.menus.showResult(sim, out, () => this.toHub());
  }

  private openSettings(back: () => void): void {
    this.setState("settings");
    this.menus.showSettings({
      back,
      volume: (v) => this.sfx.setVolume(v),
      loadTest: () => this.startLoadTest(false, back),
      wipe: () => this.repo.wipe(),
    }, this.loadText);
  }

  // ---------------------------------------------------------------- load test
  private loadBack: () => void = () => this.toTitle();

  /** 負荷試験: 敵300体を出して10秒間のFPSと更新時間を測る（セーブには触れない）。bench=true なら測り続ける（?bench） */
  private startLoadTest(bench: boolean, back?: () => void): void {
    this.dropSim();
    if (back) this.loadBack = back;
    const s = new RunSim(this.D, { run_id: "load-test", seed: 1, mode: "full", weapon: "fire" });
    s.hp = 1e9;
    s.maxHp = 1e9;
    s.t = 300;
    s.weapons = { sword: 5, bow: 5, fire: 5 };
    for (let i = 0; i < 300; i++) {
      const e = s.spawnEnemy(["chaser", "charger", "shooter"][i % 3]);
      e.hp = 1e6;
      e.maxHp = 1e6;
    }
    s.spawnAcc = -1e9;
    this.sim = s;
    this.load = { time: 0, frames: 0, upd: 0, worst: 0, bench };
    this.setState("loadtest");
  }

  private loadTestFrame(dt: number): void {
    const L = this.load, sim = this.sim!;
    L.time += dt;
    L.frames++;
    L.upd += sim.updateMs;
    L.worst = Math.max(L.worst, sim.updateMs);
    const line = (): string => `敵${sim.enemies.length}体: 平均 ${Math.round(L.frames / L.time)} FPS / 更新 ${(L.upd / L.frames).toFixed(2)} ms（最大 ${L.worst.toFixed(1)} ms）`;
    if (L.bench) {
      if (L.time >= 5) {
        const text = line();
        console.log("BENCH " + text);
        this.hud.toast(text);
        this.load = { time: 0, frames: 0, upd: 0, worst: 0, bench: true };
      }
      return;
    }
    if (L.time >= 10) {
      this.loadText = line();
      this.dropSim();
      this.openSettings(this.loadBack);
    }
  }

  // ---------------------------------------------------------------- demo
  /** ?demo: 見本データ（亡霊3体・形見・供物）。本物のセーブとは別の場所に作る */
  private seedDemo(): void {
    this.repo.wipe();
    const ws = ["bow", "fire", "sword"];
    for (let k = 0; k < 3; k++) {
      const rid = uuid();
      this.meta.reserve(rid, k, "short", ws[k], "", "");
      const r = new RunSim(this.D, { run_id: rid, seed: k, mode: "short", weapon: ws[k] });
      r.t = [100, 150, 172][k];
      r.weapons[r.mainWeapon] = 4;
      r.passives = { haste: 2 };
      r.ppow = { haste: 3 };
      r.kills = 300 + k * 200;
      r.hp = 0;
      r.end("player_death");
      this.meta.settle(r.summary(), "player_death");
      this.meta.resolveHeirloom(0);
    }
    this.repo.data.alloc = { altar: 4, affinity: { fire: 2, might: 1 }, seals: ["swift"] };
    this.repo.write();
  }
}

// 開発・計測用にコンソールから触れるようにしておく
(globalThis as unknown as { __dl: Game }).__dl = new Game();
