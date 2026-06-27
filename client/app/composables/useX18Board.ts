import type { X18BoardButton } from '~/types/project';

// Shared logic for the X18 control board: the button list (lives on the
// project), an ephemeral per-button toggle state, and the trigger that turns a
// button press into an on-demand OSC command via the server. Used both by the
// global keyboard handler (useCartHotkeys) and the X18View (clicks + visuals),
// so the toggle state stays in sync between key and click.
export const useX18Board = () => {
  const { currentProject } = useProject();
  const server = useLiveplayServer();

  const buttons = computed<X18BoardButton[]>(() => {
    const p = currentProject.value as any;
    if (!p) return [];
    if (!Array.isArray(p.x18Board)) p.x18Board = [];
    return p.x18Board as X18BoardButton[];
  });

  // Runtime toggle state per button id (NOT persisted): false = A / unmuted,
  // true = B / muted. Reset on reload because the console's real state is
  // unknown to us — first press always performs the "active" action.
  const toggleState = useState<Record<string, boolean>>('x18.toggleState', () => ({}));

  // Whether the X18 board is in edit mode. Shared so the global keyboard
  // handler can suppress live OSC triggering while the operator is editing
  // buttons (otherwise pressing a bound key would change the console).
  const editMode = useState<boolean>('x18.editMode', () => false);

  const isActive = (id: string) => !!toggleState.value[id];

  // Resolve the muted value for a mute / mute-group button given its mode and
  // update the toggle state so the UI and the next press stay consistent.
  const resolveMute = (id: string, mode?: 'toggle' | 'mute' | 'unmute'): boolean => {
    let muted: boolean;
    if (mode === 'mute') muted = true;
    else if (mode === 'unmute') muted = false;
    else muted = !toggleState.value[id]; // 'toggle' (default)
    toggleState.value = { ...toggleState.value, [id]: muted };
    return muted;
  };

  const triggerButton = async (button: X18BoardButton) => {
    const a = button?.action;
    if (!a) return;
    // No console configured yet — skip silently. The X18 view shows a banner
    // prompting the user to set the IP in Project Settings, so there's no need
    // to fire a request that the server would only reject with 400.
    const ip = (currentProject.value as any)?.settings?.x18Ip;
    if (typeof ip !== 'string' || ip.trim().length === 0) return;
    try {
      if (a.type === 'fader-toggle') {
        const toB = !toggleState.value[button.id];
        const level = toB ? (a.levelB ?? 100) : (a.levelA ?? 0);
        await server.x18Action({
          kind: 'fader', target: a.target ?? 'master', channel: a.channel, level,
        });
        toggleState.value = { ...toggleState.value, [button.id]: toB };
      } else if (a.type === 'mute-toggle') {
        const muted = resolveMute(button.id, a.mode);
        await server.x18Action({
          kind: 'mute', target: a.target ?? 'master', channel: a.channel, muted,
        });
      } else if (a.type === 'mute-group') {
        const muted = resolveMute(button.id, a.mode);
        await server.x18Action({ kind: 'mute-group', group: a.group ?? 1, muted });
      }
    } catch (e) {
      console.warn('[x18Board] trigger failed:', e);
    }
  };

  const findButtonForEvent = (e: KeyboardEvent): X18BoardButton | null => {
    // Don't fire live OSC from key presses while the board is being edited.
    if (editMode.value) return null;
    for (const b of buttons.value) {
      const k = b.key;
      if (!k) continue;
      if (
        e.key.toLowerCase() === k.key.toLowerCase()
        && (e.ctrlKey || e.metaKey) === k.ctrlKey
        && e.shiftKey === k.shiftKey
        && e.altKey === k.altKey
      ) return b;
    }
    return null;
  };

  return { buttons, toggleState, editMode, isActive, triggerButton, findButtonForEvent };
};
