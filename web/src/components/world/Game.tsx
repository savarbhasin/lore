"use client";

import { Sky, Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type DirectionalLight } from "three";
import { useAppState } from "../AppState";
import { toolMeta } from "../ToolSteps";
import { api, type Action, type IncidentRow, type Service } from "@/lib/api";
import { Campus } from "./Campus";
import { Constellation } from "./Constellation";
import { Dialogue, EntityCard, IncidentBanner, IncidentPanel, Intro, Minimap, Prompt, QuestLog, Toasts, TopBar, type Toast } from "./Hud";
import { IncidentRoom, ROOM_RADIUS, roomColliders } from "./IncidentRoom";
import { Island } from "./Island";
import { LabelLayer, LabelProjector, type LabelRegistry } from "./Labels";
import { worldLabels } from "./labelItems";
import { buildWorld, heightAt, ORACLE_HEAD, type Interactable, type Pad, type World } from "./layout";
import { Oracle, type OracleMood } from "./Oracle";
import { lookFor, teamHue } from "./palette";
import { Player, type Mode, type PlayerState } from "./Player";
import { useLoreAsk } from "./useLoreAsk";
import { SandboxScreen } from "./SandboxScreen";
import { useIncidentBoards, useIncidentLive } from "./useIncidents";
import { speakable, useNeuralSpeech, useSpeechInput } from "./useVoice";

function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function Lighting({ night, sun }: { night: boolean; sun: React.RefObject<DirectionalLight | null> }) {
  return (
    <>
      <hemisphereLight args={[night ? "#3b4a7a" : "#d8ecff", night ? "#10131c" : "#5b6b3a", night ? 0.35 : 1.1]} />
      <ambientLight intensity={night ? 0.12 : 0.18} />
      <directionalLight
        ref={sun}
        color={night ? "#9fb4ff" : "#fff1d6"}
        intensity={night ? 0.55 : 2.6}
        position={[30, 45, 34]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </>
  );
}

type Profile = {
  id: string;
  name: string;
  title: string;
  team: string;
  out_of_office: boolean;
  ooo_to?: number;
  authored: { id: string; title: string }[];
  decisions: { id: string; title: string; role: string }[];
  incidents: { id: string; title: string }[];
};

const LORE_SUGGESTIONS = [
  "Why is the payments DB pool fixed at 32?",
  "What changed in checkout recently?",
  "Which services have a bus factor of one?",
  "Clone payments-api and check whether POOL_SIZE matches decision D-17.",
];

function personSuggestions(p?: Profile): string[] {
  if (!p) return ["What are you working on these days?"];
  const out = ["What are you working on these days?"];
  if (p.authored[0]) out.push(`Why did you write ${p.authored[0].id}?`);
  if (p.decisions[0]) out.push(`Why did you ${p.decisions[0].role === "DECIDED" ? "decide" : "approve"} ${p.decisions[0].id}?`);
  if (p.incidents[0]) out.push(`What happened in ${p.incidents[0].id}?`);
  out.push("Who should I ask about your team's services?");
  return out.slice(0, 4);
}

/** Put each open incident's war room on the free clearing nearest its affected service. */
function assignRooms(incidents: IncidentRow[], world: World | null) {
  if (!world) return [];
  const free = [...world.pads];
  const out: { incident: IncidentRow; pad: Pad }[] = [];
  for (const inc of [...incidents].sort((a, b) => a.ts - b.ts)) {
    if (!free.length) break;
    const a = world.anchors.get(inc.services[0] ?? "");
    const want = a ? Math.atan2(a[0], a[2]) : 0;
    let best = 0;
    let bestD = Infinity;
    free.forEach((p, i) => {
      const d = Math.abs(((p.angle - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    out.push({ incident: inc, pad: free.splice(best, 1)[0] });
  }
  return out;
}

export default function Game() {
  const { tenant, person, people } = useAppState();
  const [services, setServices] = useState<Service[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [started, setStarted] = useState(false);
  const [modeState, setModeState] = useState<Mode>("intro");
  const [talkWith, setTalkWith] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [nearby, setNearby] = useState<Interactable | null>(null);
  const [card, setCard] = useState<Interactable | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [night, setNight] = useState(false);
  const [muted, setMuted] = useState(false);
  const [discovered, setDiscovered] = useState<Set<string>>(new Set());
  const [everQuests, setEverQuests] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  // Suggested questions only until you've asked someone your first question.
  const [asked, setAsked] = useState<Set<string>>(new Set());
  // Stable mutable boxes (not useRef) so label anchors and the camera can read them without tripping the compiler's ref rules.
  const player = useMemo<{ current: PlayerState }>(() => ({ current: { x: 0, z: 17, heading: Math.PI, yaw: 0 } }), []);
  const talkTarget = useMemo<{ current: [number, number, number] }>(() => ({ current: [0, 3.2, 0] }), []);
  const autopilot = useMemo<{ current: { target: [number, number] | null; run?: boolean } }>(() => ({ current: { target: null } }), []);
  const mode = useRef<Mode>("intro");
  const sun = useRef<DirectionalLight>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mutedRef = useRef(muted);
  const lastProgress = useRef(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const orbPositions = useMemo(() => new Map<string, Vector3>(), []);
  const registry = useMemo<LabelRegistry>(() => new Map(), []);

  const { current, ask } = useLoreAsk(tenant, person);
  const voice = useNeuralSpeech();
  const { speak, cancel: hush, level } = voice;

  const setMode = useCallback((m: Mode) => {
    mode.current = m;
    setModeState(m);
  }, []);

  const toast = useCallback((title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    api<Service[]>(`/api/services?tenant=${tenant}`)
      .then(setServices)
      .catch(() => setServices([]));
    const load = () =>
      api<IncidentRow[]>(`/api/incidents?tenant=${tenant}`)
        .then((rows) => setIncidents(rows.filter((r) => r.status !== "resolved")))
        .catch(() => setIncidents([]));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [tenant]);

  const world = useMemo(() => (people.length ? buildWorld(people, services, person) : null), [people, services, person]);
  const me = people.find((p) => p.id === person);
  const look = useMemo(() => lookFor(person, me ? teamHue(me.team) : 40), [person, me]);
  const incidentServices = useMemo(() => new Set(incidents.flatMap((i) => i.services)), [incidents]);
  const name = useCallback((pid: string) => people.find((p) => p.id === pid)?.name ?? pid, [people]);

  // ---- war rooms -----------------------------------------------------------------------------
  const rooms = useMemo(() => assignRooms(incidents, world), [incidents, world]);
  const colliders = useMemo(() => (world ? [...world.colliders, ...rooms.flatMap((r) => roomColliders(r.pad))] : []), [world, rooms]);
  const interactables = useMemo<Interactable[]>(
    () =>
      world
        ? [
            ...world.interactables,
            ...rooms.map((r) => ({ id: r.incident.id, kind: "incident" as const, x: r.pad.x, z: r.pad.z, r: ROOM_RADIUS, label: r.incident.title })),
          ]
        : [],
    [world, rooms],
  );
  const insideRoom = nearby?.kind === "incident" ? nearby.id : null;
  const { boards, refresh } = useIncidentBoards(
    tenant,
    rooms.map((r) => r.incident.id),
  );
  const refreshInside = useCallback(() => {
    if (insideRoom) refresh(insideRoom);
  }, [insideRoom, refresh]);
  const liveRoom = useIncidentLive(tenant, insideRoom, refreshInside);

  async function decide(a: Action, approve: boolean) {
    setActionErrors((m) => ({ ...m, [a.id]: "" }));
    try {
      await api(`/api/actions/${a.id}/decide`, { method: "POST", body: JSON.stringify({ tenant, person_id: person, approve }) });
      toast(approve ? "Approved" : "Rejected", a.summary.slice(0, 80));
    } catch (e) {
      setActionErrors((m) => ({ ...m, [a.id]: String((e as Error).message) }));
    }
    if (insideRoom) refresh(insideRoom);
  }

  async function resolveRoom(id: string) {
    await api(`/api/incidents/${id}/resolve?tenant=${tenant}`, { method: "POST" }).catch(() => {});
    toast("Resolved", "The scribe is writing a playbook for next time");
    refresh(id);
  }

  useEffect(() => {
    if (!insideRoom) return;
    const r = rooms.find((x) => x.incident.id === insideRoom);
    if (r) toast(`${r.incident.id} war room`, "Approve or reject the agents' proposed actions here");
  }, [insideRoom, rooms, toast]);

  // ---- conversations -------------------------------------------------------------------------
  const startTalk = useCallback(
    (who: string) => {
      setCard(null);
      setDismissed(null);
      setTalkWith(who);
      if (who === "lore") talkTarget.current = [0, 3.2, 0];
      else {
        const a = world?.anchors.get(who);
        if (a) talkTarget.current = [a[0], 1.8, a[2]];
        if (!profiles[who])
          api<Profile>(`/api/people/${who}/profile?tenant=${tenant}`)
            .then((p) => setProfiles((m) => ({ ...m, [who]: p })))
            .catch(() => {});
      }
      setMode("talk");
    },
    [world, profiles, tenant, talkTarget, setMode],
  );

  const endTalk = useCallback(() => {
    setMode("explore");
    setTalkWith(null);
  }, [setMode]);

  const send = useCallback(
    (q: string, speaker?: string) => {
      hush();
      setDismissed(null);
      setFocus(null);
      const who = speaker ?? (mode.current === "talk" ? (talkWith ?? "lore") : "lore");
      setAsked((s) => (s.has(who) ? s : new Set(s).add(who)));
      ask(q, who);
    },
    [ask, hush, talkWith],
  );
  const stt = useSpeechInput(send, tenant);

  // The spoken version of the answer drives both the voice and the typewriter captions.
  const doneText = current?.status === "done" ? (current.text ?? "") : "";
  const speaker = current?.speaker ?? "lore";
  const spoken = useMemo(() => speakable(doneText), [doneText]);
  useEffect(() => {
     
    setRevealed(0);
    if (!spoken) return;
    const voiced = !mutedRef.current;
    lastProgress.current = Date.now();
    if (voiced)
      speak(
        spoken,
        speaker,
        (c) => {
          lastProgress.current = Date.now();
          setRevealed((r) => Math.max(r, c));
        },
        () => setRevealed(spoken.length),
      );
    // Without a voice (muted, or the voice stalls), captions type out on their own.
    const id = setInterval(() => {
      if (voiced && Date.now() - lastProgress.current < 7000) return;
      setRevealed((r) => Math.min(spoken.length, r + 3.5));
    }, 50);
    return () => clearInterval(id);
  }, [spoken, speak, speaker]);

  const cited = useMemo(() => new Set(current?.citations.map((c) => c.id) ?? []), [current?.citations]);
  const anchors = world?.anchors;
  // Only the first few people/services cited become quests, so a long answer doesn't flood the island.
  const quests = useMemo(
    () => new Set([...cited].filter((id) => anchors?.has(id) && id !== person && id !== speaker).slice(0, 6)),
    [cited, anchors, person, speaker],
  );
  useEffect(() => {
    if (!quests.size) return;
     
    setEverQuests((s) => new Set([...s, ...quests]));
  }, [quests]);

  useEffect(() => {
    if (!nearby || !quests.has(nearby.id) || discovered.has(nearby.id)) return;
     
    setDiscovered((s) => new Set(s).add(nearby.id));
    toast("Insight found", nearby.label);
  }, [nearby, quests, discovered, toast]);

  const voicing = voice.speaking || (!!spoken && revealed < spoken.length);
  const loreTurn = speaker === "lore";
  const mood: OracleMood =
    stt.listening && talkWith === "lore"
      ? "listening"
      : loreTurn && current?.status === "thinking"
        ? current.sandbox
          ? "working"
          : "thinking"
        : loreTurn && voicing
          ? "speaking"
          : "idle";
  const live = current?.status === "thinking" ? ([...current.steps].reverse().find((s) => !s.done) ?? current.steps.at(-1)) : undefined;
  const oracleStatus =
    loreTurn && current?.status === "thinking"
      ? current.sandbox
        ? "Working in the sandbox…"
        : live
          ? toolMeta(live.tool).doing(live.args)
          : "Thinking…"
      : undefined;
  const npcThinking = !loreTurn && current?.status === "thinking";
  const npcStatus = useMemo(() => (npcThinking ? { id: speaker, text: `${name(speaker).split(" ")[0]} is thinking…` } : null), [npcThinking, speaker, name]);
  const speakingNpc = !loreTurn && voice.speaking ? speaker : null;
  const origin = useMemo<[number, number, number]>(() => {
    const a = anchors?.get(speaker);
    return a && !loreTurn ? [a[0], 2.2, a[2]] : ORACLE_HEAD;
  }, [anchors, speaker, loreTurn]);

  const guide = useMemo(() => {
    const open = [...quests]
      .filter((id) => !discovered.has(id))
      .map((id) => world?.anchors.get(id))
      .filter(Boolean) as [number, number, number][];
    return open.length ? open : null;
  }, [quests, discovered, world]);
  const youPos = useMemo(() => new Vector3(), []);
  const youAnchor = useCallback(() => {
    const p = player.current;
    return youPos.set(p.x, heightAt(p.x, p.z) + 2.5, p.z);
  }, [youPos, player]);
  const roomLabels = useMemo(
    () =>
      rooms.map((r) => ({
        id: r.incident.id,
        x: r.pad.x,
        z: r.pad.z,
        title: r.incident.title,
        severity: r.incident.severity,
        status: boards[r.incident.id]?.incident.status ?? r.incident.status,
      })),
    [rooms, boards],
  );
  const labels = useMemo(
    () =>
      world
        ? worldLabels({
            world,
            meName: me?.name ?? "You",
            youAnchor,
            oracleStatus,
            incidents: incidentServices,
            quests,
            evidence: current?.evidence,
            orbPositions,
            cited,
            focus,
            hovered,
            npcStatus,
            rooms: roomLabels,
          })
        : [],
    [
      world,
      me?.name,
      youAnchor,
      oracleStatus,
      incidentServices,
      quests,
      current?.evidence,
      orbPositions,
      cited,
      focus,
      hovered,
      npcStatus,
      roomLabels,
    ],
  );

  useEffect(() => {
    // Dev-only handle for scripted play-throughs (teleporting to an NPC or a war room).
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __loreWorld?: unknown }).__loreWorld = { player, world, rooms, autopilot };
  }, [player, world, rooms, autopilot]);

  const start = () => {
    setStarted(true);
    setMode("explore");
    setTimeout(() => toast("Lore is waiting in the plaza", "Walk up and press E, or hold V to speak"), 1200);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!started) return;
      if (e.code === "Escape") {
        if (stt.listening) stt.stop();
        hush();
        if (card) setCard(null);
        else if (focus) setFocus(null);
        else if (mode.current === "talk" || current) {
          endTalk();
          setDismissed(current?.question ?? null);
        }
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (typing(e)) return;
      if (e.code === "KeyE" && !e.repeat) {
        if (nearby?.kind === "oracle" || nearby?.kind === "person") {
          if (mode.current === "talk" && talkWith === (nearby.kind === "oracle" ? "lore" : nearby.id)) endTalk();
          else startTalk(nearby.kind === "oracle" ? "lore" : nearby.id);
        } else if (nearby?.kind === "service") setCard(card?.id === nearby.id ? null : nearby);
      } else if (e.code === "KeyV" && !e.repeat) {
        if (mode.current !== "talk") {
          if (nearby?.kind === "oracle") startTalk("lore");
          else if (nearby?.kind === "person") startTalk(nearby.id);
          else {
            toast("Nobody can hear you here", "Walk up to Lore in the plaza, or to a colleague");
            return;
          }
        }
        hush();
        stt.start();
      } else if (e.code === "Enter" && mode.current === "talk") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.code === "KeyN") setNight((n) => !n);
      else if (e.code === "KeyM") {
        setMuted((m) => !m);
        hush();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyV") stt.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [started, nearby, card, focus, stt, hush, toast, current, talkWith, startTalk, endTalk]);

  // Leaving someone mid-conversation ends it.
  useEffect(() => {
    if (modeState !== "talk" || !talkWith) return;
    const id = setInterval(() => {
      const [tx, , tz] = talkTarget.current;
      if (Math.hypot(player.current.x - tx, player.current.z - tz) > (talkWith === "lore" ? 12 : 7)) endTalk();
    }, 500);
    return () => clearInterval(id);
  }, [modeState, talkWith, talkTarget, player, endTalk]);

  const focusItem = focus ? interactables.find((i) => i.id === focus) : undefined;
  const shownItem = card ?? (focusItem?.kind !== "incident" ? focusItem : undefined) ?? null;
  const focusNode = focus && !focusItem ? current?.evidence.nodes.find((n) => n.id === focus) : undefined;
  const questItems = [...quests].map((id) => {
    const it = interactables.find((i) => i.id === id);
    return { id, label: it?.label ?? id, kind: it?.kind === "person" ? "person" : "service" };
  });
  const talking = modeState === "talk";
  const shownExchange = talking ? (current && current.speaker === (talkWith ?? "lore") ? current : null) : current;
  const dialogueOpen = talking || (!!current && dismissed !== current.question);
  const partner = talking ? (talkWith ?? "lore") : speaker;
  const profile = partner !== "lore" ? profiles[partner] : undefined;
  const partnerPerson = people.find((p) => p.id === partner);
  const who =
    partner === "lore"
      ? { name: "Lore", lore: true }
      : {
          name: partnerPerson?.name ?? partner,
          subtitle: partnerPerson ? `${partnerPerson.title} · ${partnerPerson.team}` : undefined,
          seed: partner,
          lore: false,
          away:
            profile?.out_of_office && profile.ooo_to
              ? `Out of office until ${new Date(profile.ooo_to).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : undefined,
        };
  const room = insideRoom ? rooms.find((r) => r.incident.id === insideRoom) : undefined;
  const roomBoard = room ? boards[room.incident.id] : undefined;
  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black">
      <Canvas shadows="percentage" flat dpr={[1, 1.75]} camera={{ fov: 50, near: 0.1, far: 700, position: [0, 60, 95] }} gl={{ antialias: true }}>
        {night ? (
          <>
            <color attach="background" args={["#05070f"]} />
            <Stars radius={260} depth={60} count={5000} factor={5} fade speed={0.6} />
            <fog attach="fog" args={["#0a1020", 45, 210]} />
          </>
        ) : (
          <>
            <Sky distance={550} sunPosition={[120, 38, 70]} turbidity={5.5} rayleigh={1.3} mieCoefficient={0.004} mieDirectionalG={0.86} />
            <fog attach="fog" args={["#cfdde6", 80, 300]} />
          </>
        )}
        <Lighting night={night} sun={sun} />
        {world && (
          <>
            <Island world={world} night={night} />
            <Campus
              districts={world.districts}
              night={night}
              player={player}
              quests={quests}
              discovered={discovered}
              incidents={incidentServices}
              nearbyId={nearby?.id ?? null}
              speakingId={speakingNpc}
              level={level}
            />
            <Oracle mood={mood} player={player} level={level} />
            <SandboxScreen
              lines={loreTurn ? (current?.term ?? []) : []}
              running={loreTurn && !!current?.sandbox}
              position={[3.4, 4.4, 0]}
              source={[0, 3, 0]}
              beside={-3.6}
              playerRef={player}
              title="lore · sandbox"
            />
            {rooms.map((r) => (
              <IncidentRoom
                key={r.incident.id}
                pad={r.pad}
                board={boards[r.incident.id]}
                agents={insideRoom === r.incident.id ? liveRoom.agents : []}
                term={insideRoom === r.incident.id ? liveRoom.term : []}
                running={insideRoom === r.incident.id && liveRoom.running}
                playerRef={player}
                inside={insideRoom === r.incident.id}
              />
            ))}
            {current && (
              <Constellation
                evidence={current.evidence}
                cited={cited}
                quests={quests}
                focus={focus}
                anchors={world.anchors}
                positions={orbPositions}
                origin={origin}
                onPick={(id) => setFocus(id === focus ? null : id)}
                onHover={setHovered}
              />
            )}
            <Player
              look={look}
              stateRef={player}
              modeRef={mode}
              colliders={colliders}
              interactables={interactables}
              onNearby={setNearby}
              sunRef={sun}
              guide={guide}
              talkRef={talkTarget}
              autopilotRef={autopilot}
            />
          </>
        )}
        {world && <LabelProjector items={labels} registry={registry} playerRef={player} />}
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={night ? 1.3 : 0.8} />
          <Vignette offset={0.32} darkness={0.55} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      {started && <LabelLayer items={labels} registry={registry} />}
      {!started && <Intro tenant={tenant} me={me} ready={!!world} onStart={start} />}
      {started && world && (
        <>
          <TopBar
            tenant={tenant}
            me={me}
            found={discovered.size}
            total={everQuests.size}
            night={night}
            muted={muted}
            onNight={() => setNight((n) => !n)}
            onMute={() => {
              setMuted((m) => !m);
              hush();
            }}
          />
          <IncidentBanner incidents={incidents} />
          <Minimap world={world} player={player} quests={quests} discovered={discovered} incidents={incidentServices} />
          {!roomBoard && <QuestLog items={questItems} discovered={discovered} />}
          {roomBoard && (
            <IncidentPanel
              board={roomBoard}
              me={me}
              name={name}
              agents={liveRoom.agents}
              steps={liveRoom.steps}
              term={liveRoom.term}
              running={liveRoom.running}
              errors={actionErrors}
              onDecide={decide}
              onResolve={() => resolveRoom(roomBoard.incident.id)}
            />
          )}
          <Prompt nearby={nearby} mode={modeState} />
          <EntityCard
            item={shownItem}
            person={people.find((p) => p.id === shownItem?.id)}
            service={services.find((s) => s.id === shownItem?.id)}
            incident={shownItem ? incidents.find((i) => i.services.includes(shownItem.id)) : undefined}
            node={focusNode}
            source={current?.citations.find((c) => c.id === focus)}
            onAsk={(q) => {
              setCard(null);
              send(q, "lore");
            }}
            onClose={() => {
              setCard(null);
              setFocus(null);
            }}
          />
          {dialogueOpen && (
            <Dialogue
              who={who}
              suggestions={asked.has(partner) ? [] : partner === "lore" ? LORE_SUGGESTIONS : personSuggestions(profile)}
              exchange={shownExchange}
              spoken={spoken}
              revealed={Math.floor(revealed)}
              talking={talking}
              listening={stt.listening}
              interim={stt.interim}
              micSupported={stt.supported}
              micError={stt.error}
              focus={focus}
              onCite={(id) => setFocus(id === focus ? null : id)}
              onSend={(q) => send(q)}
              onMicDown={() => {
                hush();
                stt.start();
              }}
              onMicUp={stt.stop}
              onClose={() => {
                hush();
                endTalk();
                setDismissed(current?.question ?? null);
              }}
              onSkip={() => {
                hush();
                setRevealed(spoken.length);
              }}
              inputRef={inputRef}
            />
          )}
          <Toasts toasts={toasts} />
          {modeState === "explore" && !dialogueOpen && (
            <p className="pointer-events-none absolute bottom-4 left-4 z-20 text-[12px] text-white/60">
              WASD move · Shift run · drag to look · scroll to zoom · E interact · V speak · N night · M mute
            </p>
          )}
        </>
      )}
    </div>
  );
}
