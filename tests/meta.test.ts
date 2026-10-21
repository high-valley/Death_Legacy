// 亡霊・供物・形見・セーブのテスト（仕様書 §11 の受け入れ条件＋フェーズ1）
import assert from "node:assert/strict";
import { test } from "node:test";
import { SaveRepository } from "../src/meta/saveRepository.ts";
import { STEP } from "../src/sim/runSim.ts";
import { RunSim } from "../src/sim/runSim.ts";
import { botStep, D, World } from "./helpers.ts";

test("t01 新規データで出撃 → レベルアップ → ボス → 敗北で亡霊が1体", () => {
  const w = new World();
  assert.equal(w.meta.storedGhosts().length, 0);
  const r = w.sortie("", "", "short", "sword", 11)!;
  assert.ok(r, "亡霊0体でも出撃できる");
  for (let i = 0; i < 60 * 40; i++) botStep(r);
  assert.ok(r.level >= 3 && r.kills > 10, `Lv${r.level} 撃破${r.kills}`);
  r.t = r.runLen;
  r.step(STEP, 0, 0);
  assert.ok(r.bossSpawned, "時間でボスが出る");
  const out = w.die(r);
  assert.ok(out.result === "player_death" && w.meta.storedGhosts().length === 1);
});

test("t02 亡霊は等級を持たず、武器の種類と特技（一番育てたパッシブ）だけを持つ。名前は「武器の亡霊」（同じ名前は・二、・三）", () => {
  const w = new World();
  const r = w.sortie("", "", "full", "bow", 12)!;
  r.weapons.bow = 9; r.passives = { might: 2 }; r.ppow = { might: 2 };
  w.die(r, 300);
  const g = w.meta.storedGhosts()[0];
  assert.ok(g.survival_seconds === 300 && g.tier_id === "" && g.primary_weapon_id === "bow" && g.passive_id === "might", g.display_name);
  assert.equal(g.display_name, "弓の亡霊");
  w.meta.resolveHeirloom(-1);
  w.die(w.sortie("", "", "full", "bow", 13), 300);
  assert.deepEqual(w.meta.storedGhosts().map((x) => x.display_name), ["弓の亡霊", "弓の亡霊・二"]);
  assert.equal(w.meta.trait(g).text, D.ghost_traits.might.text);
});

test("クリアした時も「亡霊にする / しない」を選べる（英霊）。しないなら保管庫に入らない", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "spear", 3)!;
  r.end("boss_cleared");
  const out = w.meta.settle(r.summary(), "boss_cleared")!;
  assert.ok(out.new_ghost_id && w.repo.data.pending_ghost_kind === "offer");
  assert.match(w.repo.data.pending_ghost!.display_name, /槍の英霊$/);
  assert.equal(w.meta.decideOffer(false), "declined");
  assert.ok(w.repo.data.pending_ghost === null && w.meta.storedGhosts().length === 0);
  assert.ok(w.repo.data.run_history[0].ghost_declined);
  assert.equal(w.meta.decideOffer(true), "", "決めた後は何も起きない");
  w.meta.resolveHeirloom(-1);
  const r2 = w.sortie("", "", "short", "spear", 4)!;
  r2.end("boss_cleared");
  w.meta.settle(r2.summary(), "boss_cleared");
  assert.equal(w.meta.decideOffer(true), "stored");
  assert.equal(w.meta.storedGhosts().length, 1);
});

test("死んだ時も亡霊にしないを選べ、保管庫が満杯なら入れ替えに進む", () => {
  const w = new World();
  for (let i = 0; i < D.vault_capacity; i++) { w.die(w.sortie("", "", "short", "sword", 100 + i), 120); w.meta.resolveHeirloom(-1); }
  assert.equal(w.meta.storedGhosts().length, D.vault_capacity);
  w.die(w.sortie("", "", "short", "sword", 200), 120, -1, false);
  assert.equal(w.meta.decideOffer(true), "full");
  assert.equal(w.repo.data.pending_ghost_kind, "full");
  const victim = w.meta.storedGhosts()[0].ghost_id;
  assert.ok(w.meta.resolvePendingGhost(victim));
  assert.ok(w.repo.data.pending_ghost === null && (w.repo.data.pending_ghost_kind as string) === "");
});

test("t03 単独出撃では保管庫が変わらない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const before = JSON.stringify(w.meta.storedGhosts());
  const r = w.sortie("", "", "short", "fire", 13)!;
  r.end("boss_cleared");
  w.meta.settle(r.summary(), "boss_cleared");
  assert.equal(JSON.stringify(w.meta.storedGhosts()), before);
});

test("t04 連れていった亡霊は死亡しても保管庫に戻る（減らない）。出撃中は選べない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "sword", 14);
  assert.equal(w.meta.getGhost(gid)!.status, "reserved");
  assert.equal(w.meta.reserve("x", 1, "short", "sword", gid, ""), false, "出撃中に同じ亡霊は選べない");
  const out = w.die(r, 80);
  assert.equal(w.meta.getGhost(gid)!.status, "stored");
  assert.deepEqual(out.companions, [w.meta.getGhost(gid)!.display_name]);
  assert.equal(w.meta.storedGhosts().length, 2, "元の亡霊＋新しく生まれた亡霊");
  w.meta.resolveHeirloom(-1);
  assert.ok(w.sortie(gid), "次のランでもまた連れていける");
});

test("t05 生還でも亡霊は戻り、新しい亡霊（英霊）は残すかどうか選べる", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "bow", 15)!;
  r.t = r.runLen + 1;
  r.spawnBoss();
  r.boss!.hp = 0;
  r.step(STEP, 0, 0);
  const out = w.meta.settle(r.summary(), "boss_cleared")!;
  assert.ok(r.result === "boss_cleared" && w.meta.getGhost(gid)!.status === "stored" && out.new_ghost_id !== "" && w.repo.data.pending_ghost_kind === "offer");
});

test("亡霊を2体まで連れていける（双魂の契りを開いてから）", () => {
  const w = new World();
  for (let i = 0; i < 2; i++) { w.die(w.sortie("", "", "short", ["fire", "ice"][i], 60 + i), 100); w.meta.resolveHeirloom(-1); }
  const [a, b] = w.meta.storedGhosts().map((g) => g.ghost_id);
  const two = [{ id: a, mode: "bring" as const }, { id: b, mode: "bring" as const }];
  assert.equal(w.meta.ghostSlots(), 1);
  assert.equal(w.meta.reserve("r1", 1, "short", "sword", two, ""), false, "最初は1体まで");
  w.repo.data.tree = ["soul1", "soul2", "twin"];
  assert.equal(w.meta.ghostSlots(), 2);
  assert.equal(w.meta.reserve("r1", 1, "short", "sword", [{ id: a, mode: "bring" }, { id: a, mode: "bring" }], ""), false, "同じ亡霊を2回は選べない");
  const r = new RunSim(D, w.meta.runOpts((w.meta.reserve("r2", 2, "short", "thunder", two, ""), w.repo.data.active_run!)));
  assert.equal(r.ghosts.length, 2);
  const pts = r.tagPoints();
  assert.ok(pts.thunder === 2 && pts.fire === 1 && pts.ice === 1 && pts.spirit === 2, JSON.stringify(pts));
  assert.ok(r.activeSets().some((s) => s.tag === "spirit" && s.at === 2), "亡霊2体で霊2のセット");
  const out = w.die(r, 30, 0);
  assert.equal(out.companions!.length, 2);
  assert.equal(w.meta.storedGhosts().length, 2, "2体とも戻る");
});

test("t06 亡霊は保管データのコピーで、生前の武器で攻撃する", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "fire", 1), 150);
  const g = w.meta.storedGhosts()[0];
  const r = w.sortie(g.ghost_id, "", "short", "sword", 16)!;
  assert.ok(r.ghost && r.ghost.rec.ghost_id === g.ghost_id);
  r.ghost.rec.display_name = "書き換え";
  assert.notEqual(w.meta.getGhost(g.ghost_id)!.display_name, "書き換え");
  let ghostHits = 0;
  for (let i = 0; i < 60 * 15; i++) {
    r.step(STEP, 0, 0);
    r.drainEvents();
    for (const z of r.zones) if (z.ghost) ghostHits++;
  }
  assert.ok(ghostHits > 0, "亡霊が魔導書で攻撃する");
  assert.ok(r.ghost.lv === 1 && r.ghost.rank === 0, "生前の Lv・ランクは引き継がない");
});

test("亡霊の札: 3枚に混ざり、取ると亡霊の Lv が上がる。rank_levels に届くと亡霊のランクアップ（道）が必ず出る。再開しても育ちは残り、保管データには書き戻さない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "ice", 1), 150);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "sword", 9)!;
  let seen = 0;
  for (let i = 0; i < 100; i++) if (r.rollChoices().some((c) => c.kind === "gweapon")) seen++;
  assert.ok(seen > 30, `亡霊の札 ${seen}/100`);
  r.applyChoice({ kind: "gweapon", id: "ice", lv: 1, rar: "N", slot: 0 });
  assert.equal(r.ghost!.lv, 1 + D.ghost_cards.lv_mult, "亡霊の札は lv_mult 倍上がる");
  const rk = r.rollChoices().filter((c) => c.kind === "grank");
  assert.deepEqual(rk.map((c) => c.branch), ["a", "b"], "亡霊のランクアップ（道）");
  assert.match(r.describe(rk[0]).k, /亡霊①/);
  r.applyChoice(rk[1]);
  assert.equal(r.ghostWeaponName(r.ghost!), "アイスランス");
  assert.ok((r.tagPoints().ice ?? 0) >= D.tag_points.ghost_weapon + D.tag_points.ghost_rank, "育つと共鳴の点も増える");
  const r2 = new RunSim(D, { ...w.meta.runOpts(w.repo.data.active_run!), checkpoint: r.snapshot() });
  assert.ok(r2.ghost!.lv === 1 + D.ghost_cards.lv_mult && r2.ghost!.rank === 1 && r2.ghost!.branch === "b", "再開しても育ちは残る");
  assert.equal(w.meta.getGhost(gid)!.weapon_rank, 0, "保管データは変わらない");
});

test("亡霊の札が続けて出ない時は、次は必ず1枚出る（救済）", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "fire", 1), 150);
  const r = w.sortie(w.meta.storedGhosts()[0].ghost_id, "", "short", "sword", 2)!;
  r.ghostDry = D.ghost_cards.dry_limit;
  assert.ok(r.rollChoices().some((c) => c.kind === "gweapon"));
  assert.equal(r.ghostDry, 0);
});

test("t07 終了処理を何度呼んでも重複しない", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "sword", 17)!;
  r.t = 90; r.hp = 0; r.end("player_death");
  const a = w.meta.settle(r.summary(), "player_death")!;
  const snap = JSON.stringify(w.repo.data);
  w.meta.settle(r.summary(), "player_death");
  w.meta.settle(r.summary(), "boss_cleared");
  assert.equal(JSON.stringify(w.repo.data), snap);
  assert.ok(a.offerings > 0);
});

test("t08 異常終了しても同じランを途中から再開でき、亡霊は複製されず最後に保管庫へ戻る", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "fire", 18)!;
  for (let i = 0; i < 60 * 12; i++) {
    botStep(r);
    if (r.checkpointDue()) w.meta.checkpoint(r.run_id, r.snapshot());
  }
  w.reload();
  const ar = w.repo.data.active_run!;
  assert.ok(ar.run_id === r.run_id && w.meta.getGhost(gid)!.status === "reserved");
  assert.equal(w.repo.data.ghosts.filter((g) => g.ghost_id === gid).length, 1, "亡霊は複製されない");
  const r2 = w.resume();
  assert.ok(r2.t >= 10 && r2.ghost && r2.ghost.rec.ghost_id === gid, `${r2.t}秒`);
  w.die(r2);
  assert.equal(w.meta.getGhost(gid)!.status, "stored");
});

test("t08b 放棄はリタイア扱い。連れていた亡霊は戻る", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  w.sortie(gid, "", "short", "sword", 19);
  const out = w.meta.abandonActive()!;
  assert.ok(out.result === "retired" && w.meta.getGhost(gid)!.status === "stored" && w.repo.data.active_run === null);
});

test("亡霊になれるのは、生存時間の最低ラインを超え、未練の欠片が足りている時だけ", () => {
  const w = new World();
  const need = D.ghost_birth.fragments, minT = D.run_length.short * D.ghost_birth.min_survival;
  let out = w.die(w.sortie("", "", "short", "sword", 70), minT - 5, need);
  assert.ok(out.ghost_failed === "time" && out.new_ghost_id === "", "早すぎる死は亡霊にならない");
  w.meta.resolveHeirloom(-1);
  out = w.die(w.sortie("", "", "short", "sword", 71), minT + 10, need - 1);
  assert.ok(out.ghost_failed === "fragments" && out.new_ghost_id === "", "欠片が足りない");
  w.meta.resolveHeirloom(-1);
  out = w.die(w.sortie("", "", "short", "sword", 72), minT + 10, need);
  assert.ok(out.ghost_failed === "" && out.new_ghost_id !== "");
});

test("精鋭（墓暴き）を倒すと未練の欠片が手に入る", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "sword", 74)!;
  const e = r.spawnEnemy("elite");
  e.hp = 0;
  r.step(STEP, 0, 0);
  assert.equal(r.fragments, D.ghost_birth.drops.elite);
  assert.equal(r.summary().fragments, D.ghost_birth.drops.elite);
});

test("t09 保管庫が満杯なら pending、入れ替え後も10体", () => {
  const w = new World();
  for (let i = 0; i < 10; i++) {
    w.die(w.sortie("", "", "short", "sword", 100 + i), 60 + i);
    w.meta.resolveHeirloom(-1);
  }
  assert.equal(w.meta.storedGhosts().length, 10);
  const oldest = w.meta.storedGhosts()[0].ghost_id;
  const out = w.die(w.sortie("", "", "short", "bow", 200), 170);
  assert.ok(out.new_ghost_pending && w.repo.data.pending_ghost && w.meta.storedGhosts().length === 10);
  w.reload();
  assert.ok(w.repo.data.pending_ghost, "入れ替え前に落ちても pending は残る");
  const nid = w.repo.data.pending_ghost.ghost_id;
  assert.ok(w.meta.resolvePendingGhost(oldest));
  assert.ok(w.meta.storedGhosts().length === 10 && w.meta.getGhost(oldest)!.status === "released" && w.meta.getGhost(nid)!.status === "stored");
});

test("出撃中に同じ亡霊で二重出撃できない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  assert.ok(w.sortie(gid));
  assert.equal(w.sortie(gid), null);
});

test("本体が壊れていたらバックアップから復元", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  w.die(w.sortie("", "", "short", "sword", 2), 60);
  w.kv.setItem("test", "{broken");
  w.reload();
  assert.ok(w.repo.source === "backup" && w.repo.data.ghosts.length >= 1);
});

test("古いセーブに新項目を補う", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({ schema_version: 1, ghosts: [], run_history: [], settled_runs: [], progress: { clears: 0, deaths: 3, runs: 3 } }));
  const repo = new SaveRepository(w.kv, "test");
  const d = repo.load();
  assert.ok(d.offerings && Array.isArray(d.alloc.seals) && d.progress.generation === 0 && d.progress.deaths === 3);
});

test("v1 のセーブ: 祭壇・書庫に払っていた供物は全部戻る", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({
    schema_version: 1, ghosts: [], run_history: [], settled_runs: [], offerings: { earned: 9 },
    alloc: { altar: 4, affinity: { fire: 2 }, seals: ["bow"] },
  }));
  w.reload();
  assert.equal(w.repo.data.schema_version, 6);
  assert.deepEqual(w.repo.data.tree, []);
  assert.deepEqual(w.repo.data.alloc, { affinity: {}, seals: [] });
  assert.equal(w.meta.offeringsFree(), 9);
});

test("供物: 生存6/10 + 撃破200 = 8、世代が1進む", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "bow", 21)!;
  r.kills = 250;
  const out = w.die(r, 120);
  assert.ok(out.offerings === 8 && w.repo.data.offerings.earned === 8, String(out.offerings));
  assert.equal(w.repo.data.progress.generation, 1);
});

test("祭壇の樹: 親から順に・供物の分だけ開け、ほどくと全額戻る", () => {
  const w = new World();
  w.repo.data.offerings.earned = 5;
  assert.ok(!w.meta.openNode("rar2"), "手前の節が開いていない");
  assert.ok(w.meta.openNode("rar1"));
  assert.equal(w.meta.cardMods().altar, 2);
  assert.equal(w.meta.nodeBlock("aff1"), "累計の生存時間 5分で開ける");
  w.repo.data.progress.total_survival = 9999;
  assert.ok(w.meta.openNode("aff1"));
  assert.equal(w.meta.offeringsFree(), 2);
  assert.ok(!w.meta.openNode("rar2"), "供物が足りない");
  assert.ok(w.meta.allocAffinity("fire", 2));
  assert.ok(!w.meta.allocAffinity("bow", 1), "縁は樹で開いた数まで");
  assert.ok(!w.meta.toggleSeal("bow"), "封の札を開くまで封印できない");
  w.meta.resetTree();
  assert.equal(w.meta.offeringsFree(), 5);
  assert.equal(w.meta.affinity("fire"), 0);
  assert.ok(w.meta.openNode("seal1") && w.meta.toggleSeal("bow"));
  assert.ok(!w.meta.allocAffinity("bow", 1), "封印中のカードに縁は結べない");
  assert.ok(!w.meta.toggleSeal("swift"), "封印の枠は1つ");
});

test("祭壇の樹の合流節は、親がすべて開いてから", () => {
  const w = new World();
  w.repo.data.offerings.earned = 99;
  w.repo.data.progress.total_survival = 9999;
  for (const id of ["rar1", "rar2"]) assert.ok(w.meta.openNode(id));
  assert.ok(!w.meta.openNode("meifu"));
  for (const id of ["aff1", "aff2", "meifu", "rar3"]) assert.ok(w.meta.openNode(id), id);
  assert.equal(w.meta.cardMods().altar, D.altar.max);
});

test("形見: 候補 → 棚 → 身につけて出撃 → 使い切り", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "bow", 22)!;
  r.passives = { haste: 3 };
  r.ppow = { haste: 3 };
  w.die(r, 100);
  const p = w.repo.data.pending_heirloom;
  assert.ok(p && p.options.length === 2);
  w.meta.resolveHeirloom(1);
  const h = w.meta.storedHeirs()[0];
  assert.ok(h.type === "passive" && h.id === "haste" && h.level === 2, h.name);
  const r2 = w.sortie("", h.heir_id, "short", "sword", 23)!;
  assert.ok(w.meta.getHeir(h.heir_id)!.status === "reserved" && r2.passives.haste === 2, "形見 Lv2（家系なし）");
  w.die(r2, 50);
  assert.equal(w.meta.getHeir(h.heir_id), null);
});

test("形見: 異常終了後も reserved、再開しても持っていて、1回だけ使い切る", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "fire", 24), 100);
  w.meta.resolveHeirloom(0);
  const hid = w.meta.storedHeirs()[0].heir_id;
  const r2 = w.sortie("", hid, "short", "sword", 25)!;
  for (let i = 0; i < 60 * 11; i++) {
    botStep(r2);
    if (r2.checkpointDue()) w.meta.checkpoint(r2.run_id, r2.snapshot());
  }
  w.reload();
  assert.equal(w.meta.getHeir(hid)!.status, "reserved");
  const ar = w.repo.data.active_run!;
  const r3 = new RunSim(D, { run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon, heirloom: w.meta.getHeir(ar.heirloom_id), card_mods: w.meta.cardMods(), checkpoint: ar.checkpoint });
  assert.ok((r3.weapons.sword ?? 0) >= 1, "武器の形見は主人公の武器のLvになる");
  w.die(r3);
  assert.equal(w.meta.getHeir(hid), null);
});

test("形見の棚は5つまで（古いものから手放す）", () => {
  const w = new World();
  for (let i = 0; i < 7; i++) {
    w.die(w.sortie("", "", "short", "fire", 30 + i), 30);
    w.meta.resolveHeirloom(0);
  }
  assert.equal(w.meta.storedHeirs().length, D.shelf.capacity);
});

test("リタイアは供物半分・形見と亡霊なし", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "sword", 50)!;
  r.t = 90;
  r.end("retired");
  const out = w.meta.settle(r.summary(), "retired")!;
  assert.ok(out.offerings === 2 && w.repo.data.pending_heirloom === null && out.new_ghost_id === "");
});

test("v4 のセーブ: 古い武器Lv（1〜5）をランクと新しいレベルに読み替える（亡霊・形見・中断ラン）", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({
    schema_version: 4, run_history: [], settled_runs: [],
    ghosts: [{ ghost_id: "g1", status: "stored", primary_weapon_id: "sword", weapon_level: 5, weapon_branch: "b", passive_level: 3, tier_id: "hero", display_name: "x", stat_snapshot: { attack_mult: 1, attack_speed: 1, area: 1 } }],
    heirlooms: [{ heir_id: "h1", type: "weapon", id: "sword", level: 3, name: "第1代の形見・剣 Lv3", from_generation: 1, status: "stored" }],
    progress: { best_weapon_level: { fire: 5 } },
    active_run: { run_id: "r", seed: 1, mode: "short", weapon: "spear", heirloom_id: "", lineage_id: "nameless", started_at: "", ghosts: [],
      checkpoint: { t: 60, hp: 50, max_hp: 120, level: 5, xp: 0, weapons: { spear: 3 }, passives: { might: 2 }, ppow: { might: 2 }, wbonus: {}, evolved: {}, kills: 0, boss_kills: 0, boss_spawned: false, elite_idx: 0, spawn_acc: 0, branch: { spear: "b" } } },
  }));
  w.reload();
  const g = w.meta.getGhost("g1")!;
  assert.ok(g.weapon_rank === 2 && g.weapon_level === 12 && g.passive_level === 5, JSON.stringify(g));
  assert.equal(w.repo.data.heirlooms[0].level, 7);
  assert.equal(w.repo.data.heirlooms[0].name, "形見・剣 Lv7");
  assert.equal(w.repo.data.progress.best_weapon_level.fire, 12);
  const r = w.resume();
  assert.equal(r.weaponName("spear"), "トライデント", "中断ラン: ランク1＝道の最初");
  assert.equal(r.weapons.spear, 7);
  assert.equal(r.passives.might, 3);
});

test("家系なし: 出撃は無名でも特性・専用カードなし、家系は解放されない", () => {
  const w = new World();
  assert.equal(w.sortie("", "", "short", "sword", 1, "firekeeper"), null, "他の家系では出撃できない");
  const r = w.sortie("", "", "short", "fire", 1)!;
  assert.ok(!r.cardPool().some((o) => o.kind === "lineage"), "家系の札は出ない");
  assert.equal(r.maxHp, D.player.hp);
  r.weapons.fire = 20;
  const out = w.die(r, 60);
  assert.deepEqual(out.unlocked_lineages, []);
});

test("v5 のセーブ: 亡霊の名前の等級名を「亡霊」に、入れ替え待ちの亡霊は満杯の入れ替えとして扱う", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({
    schema_version: 5, run_history: [], settled_runs: [],
    ghosts: [{ ghost_id: "g1", status: "stored", primary_weapon_id: "ice", weapon_level: 9, weapon_rank: 1, passive_level: 2, passive_id: "might", tier_id: "legend", display_name: "第3代・フロストの伝説の英霊", stat_snapshot: { attack_mult: 3, attack_speed: 1, area: 1 } }],
    pending_ghost: { ghost_id: "g2", status: "pending", primary_weapon_id: "bow", weapon_level: 1, weapon_rank: 0, passive_level: 0, passive_id: "", tier_id: "echo", display_name: "第4代・ショートボウの残響", stat_snapshot: { attack_mult: 1, attack_speed: 1, area: 1 } },
  }));
  w.reload();
  assert.equal(w.meta.getGhost("g1")!.display_name, "フロストの亡霊", "等級名も「第N代」も外れる");
  assert.equal(w.repo.data.pending_ghost!.display_name, "ショートボウの亡霊");
  assert.equal(w.repo.data.pending_ghost_kind, "full");
  const r = w.sortie("g1", "", "short", "sword", 1)!;
  assert.ok(r.ghost!.lv === 1 && r.ghost!.rank === 0, "古い亡霊も Lv1 から");
});
