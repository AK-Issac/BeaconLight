import { useEffect, useRef, useState, type RefObject } from "react";
import { ext } from "../browserApi";

export type MascotMood = "idle" | "confused" | "alert" | "shocked";

const HOLD: Record<MascotMood, string> = {
  idle: "MascotAnimation/MascotIdleAnimation.svg",
  confused: "MascotAnimation/MascotConfusedAnimation.svg",
  alert: "MascotAnimation/MascotLookingDownRightAnimation.svg",
  shocked: "MascotAnimation/MascotShockedAnimation.svg",
};

const INTRO: Partial<Record<MascotMood, { file: string; ms: number }>> = {
  shocked: { file: "MascotAnimation/NormalToShockedAnimation.gif", ms: 4200 },
};

const REST_MOODS = new Set<MascotMood>(["idle", "confused"]);

function assetUrl(path: string): string {
  try {
    return ext?.runtime?.getURL?.(path) ?? `/${path}`;
  } catch {
    return `/${path}`;
  }
}

export function deriveMascotMood(
  isMasterActive: boolean,
  openFlaggedCount: number,
  visibleGroups: number
): MascotMood {
  if (!isMasterActive) return "confused";
  if (visibleGroups === 0) return "idle";
  if (openFlaggedCount > 0) return "shocked";
  return "alert";
}

export function useMascotSrc(mood: MascotMood): string {
  const [src, setSrc] = useState(() => assetUrl(HOLD.idle));
  const shownMood = useRef<MascotMood>("idle");

  useEffect(() => {
    const from = shownMood.current;
    const to = mood;
    const intro = INTRO[to];
    const playIntro = Boolean(intro) && from !== to && REST_MOODS.has(from);

    if (playIntro && intro) {
      shownMood.current = to;
      setSrc(`${assetUrl(intro.file)}?t=${Date.now()}`);
      const id = window.setTimeout(() => {
        setSrc(assetUrl(HOLD[to]));
      }, intro.ms);
      return () => window.clearTimeout(id);
    }

    shownMood.current = to;
    setSrc(assetUrl(HOLD[to]));
  }, [mood]);

  return src;
}

export function Mascot({
  src,
  size,
  mood = "idle",
  alt = "",
}: {
  src: string;
  size: "hero";
  mood?: MascotMood;
  alt?: string;
}) {
  const startled = useStartle(mood);
  return (
    <div
      className={`mascot-hero mascot-hero--${mood}${startled ? " is-startled" : ""}`}
    >
      <img className="mascot mascot--hero" src={src} alt={alt} draggable={false} />
    </div>
  );
}

function useStartle(mood: MascotMood): boolean {
  const [startled, setStartled] = useState(false);
  const prev = useRef(mood);

  useEffect(() => {
    const was = prev.current;
    prev.current = mood;
    if (mood !== "shocked" || was === "shocked") return;
    setStartled(true);
    const id = window.setTimeout(() => setStartled(false), 1100);
    return () => window.clearTimeout(id);
  }, [mood]);

  return startled;
}

function hopDelay(): number {
  return 7000 + Math.random() * 4000;
}

function nextNeighbor(index: number, length: number): number {
  if (length <= 1) return 0;
  const dir = Math.random() < 0.6 ? 1 : -1;
  let next = index + dir;
  if (next < 0) next = 1;
  if (next >= length) next = length - 2;
  return next;
}

/** Small buddy on the right gutter so domain names stay visible. */
export function RoamingMascot({
  src,
  mood,
  shellRef,
  listRef,
}: {
  src: string;
  mood: MascotMood;
  shellRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const [top, setTop] = useState(12);
  const yRef = useRef(12);
  const indexRef = useRef(0);
  const placed = useRef(false);
  const startled = useStartle(mood);

  useEffect(() => {
    let waitTimer: number | undefined;
    let cancelled = false;

    const visibleCards = () => {
      const shell = shellRef.current;
      const list = listRef.current;
      if (!shell || !list) return [];
      const shellBox = shell.getBoundingClientRect();
      return Array.from(
        list.querySelectorAll<HTMLElement>(".log-entry:not(.system)")
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > shellBox.top + 12 && r.top < shellBox.bottom - 12;
      });
    };

    const yForCard = (card: HTMLElement) => {
      const shell = shellRef.current;
      if (!shell) return yRef.current;
      const size = 40;
      const shellBox = shell.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      return Math.min(
        Math.max(cardBox.top - shellBox.top + 8, 8),
        Math.max(8, shellBox.height - size - 8)
      );
    };

    const goTo = (y: number) => {
      yRef.current = y;
      setTop(Math.round(y));
    };

    const step = () => {
      if (cancelled) return;
      const cards = visibleCards();
      if (cards.length === 0) return;

      const next = nextNeighbor(indexRef.current, cards.length);
      indexRef.current = next;
      const target = yForCard(cards[next]);
      const maxStep = 52;
      const delta = target - yRef.current;
      goTo(
        Math.abs(delta) <= maxStep
          ? target
          : yRef.current + Math.sign(delta) * maxStep
      );
    };

    const kickoff = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const cards = visibleCards();
      if (cards.length === 0) return;
      if (!placed.current) {
        indexRef.current = 0;
        goTo(yForCard(cards[0]));
        placed.current = true;
      }
    });

    const schedule = () => {
      waitTimer = window.setTimeout(() => {
        step();
        schedule();
      }, hopDelay());
    };
    schedule();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(kickoff);
      window.clearTimeout(waitTimer);
    };
  }, [shellRef, listRef]);

  return (
    <div
      className={`mascot-roam mascot-roam--list mascot-roam--${mood}${
        startled ? " is-startled" : ""
      }`}
      style={{ top: `${top}px` }}
      aria-hidden="true"
    >
      <img className="mascot mascot--roam" src={src} alt="" draggable={false} />
    </div>
  );
}
