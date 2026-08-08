<template>
  <div class="x18-view">
    <!-- On a phone this row is 60px spent repeating the name of the deck tab
         you just pressed — which is right there at the bottom, in accent, with
         a count. It earns its space only when it carries something else: the
         "no console IP" warning, or the desktop board editor. -->
    <div class="x18-header" :class="{ 'x18-header--redundant': headerIsRedundant }">
      <div class="x18-title">
        <span class="material-symbols-rounded">equalizer</span>
        <h2>{{ t('x18.title') }}</h2>
      </div>
      <!-- The warning is a direct child of the header, so hiding the (Electron
           only) editor actions can never hide "no X18 IP configured" with them. -->
      <span v-if="!x18Configured" class="x18-warn">{{ t('x18.boardRequiresIp') }}</span>
      <div v-if="hasElectron && section === 'board'" class="x18-header-actions">
        <button
          type="button"
          class="x18-btn"
          :class="{ 'x18-btn--active': editMode }"
          @click="toggleEdit"
        >
          <span class="material-symbols-rounded">{{ editMode ? 'check' : 'edit' }}</span>
          {{ editMode ? t('x18.doneEditing') : t('x18.edit') }}
        </button>
        <button v-if="editMode" type="button" class="x18-btn" @click="addButton">
          <span class="material-symbols-rounded">add</span>
          {{ t('x18.addButton') }}
        </button>
      </div>
    </div>

    <!-- Board vs. levels. Two different jobs on the same desk — buttons are
         pre-programmed show moves, the faders are the thing you reach for when
         one channel is simply too loud right now. Full-width segments so the
         switch is a thumb target, not a 24px tab.

         Toggle buttons rather than role="tab": the ARIA tabs pattern owes the
         user roving tabindex and arrow-key navigation, and a half-implemented
         one promises behaviour that is not there. Every other switcher in this
         app (MainWorkspace's deck tabs, ControlConfigModal) is plain buttons
         too. -->
    <div class="x18-sections" role="group" :aria-label="t('x18.title')">
      <button
        type="button"
        class="x18-section"
        :class="{ 'x18-section--active': section === 'board' }"
        :aria-pressed="section === 'board' ? 'true' : 'false'"
        @click="selectSection('board')"
      >
        <span class="material-symbols-rounded" aria-hidden="true">apps</span>
        {{ t('x18.sectionBoard') }}
        <span class="x18-section__count">{{ buttons.length }}</span>
      </button>
      <button
        type="button"
        class="x18-section"
        :class="{ 'x18-section--active': section === 'faders' }"
        :aria-pressed="section === 'faders' ? 'true' : 'false'"
        @click="selectSection('faders')"
      >
        <span class="material-symbols-rounded" aria-hidden="true">tune</span>
        {{ t('x18.sectionFaders') }}
      </button>
    </div>

    <X18FaderPanel v-if="section === 'faders'" />

    <div v-else-if="buttons.length === 0" class="x18-empty">
      <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>
      <p>{{ hasElectron ? t('x18.emptyDesktop') : t('x18.emptyViewer') }}</p>
    </div>

    <div v-else class="x18-grid lp-scroll-fade">
      <button
        v-for="b in buttons"
        :key="b.id"
        type="button"
        class="x18-tile"
        :class="{ 'x18-tile--active': isActive(b.id), 'x18-tile--editing': editMode && selectedId === b.id }"
        :style="{ '--tile-color': b.color }"
        @click="onTileClick(b)"
      >
        <span class="x18-tile__label">{{ b.label || '—' }}</span>
        <span class="x18-tile__summary">{{ actionSummary(b) }}</span>
        <span v-if="b.key" class="x18-tile__key">{{ formatKeyLabel(b.key) }}</span>
        <span v-if="editMode" class="x18-tile__edit material-symbols-rounded">edit</span>
      </button>
    </div>

    <!-- Editor overlay (desktop edit mode only) -->
    <div v-if="editMode && selectedButton" class="x18-editor-backdrop" @click.self="closeEditor">
      <div class="x18-editor">
        <header class="x18-editor__head">
          <h3>{{ t('x18.editButton') }}</h3>
          <button class="x18-editor__close" @click="closeEditor">✕</button>
        </header>

        <div class="x18-editor__body">
          <label class="x18-field">
            <span>{{ t('x18.label') }}</span>
            <input type="text" v-model="selectedButton.label" @change="persist" />
          </label>

          <div class="x18-field">
            <span>{{ t('properties.color') }}</span>
            <div class="x18-colors">
              <button
                v-for="c in PRESET_COLORS"
                :key="c"
                type="button"
                class="x18-color"
                :class="{ active: selectedButton.color === c }"
                :style="{ backgroundColor: c }"
                @click="selectedButton.color = c; persist()"
              ></button>
            </div>
          </div>

          <label class="x18-field">
            <span>{{ t('x18.actionType') }}</span>
            <select :value="selectedButton.action.type" @change="onActionTypeChange">
              <option value="fader-toggle">{{ t('x18.actionFaderToggle') }}</option>
              <option value="fader-relative">{{ t('x18.actionFaderRelative') }}</option>
              <option value="mute-toggle">{{ t('x18.actionMuteToggle') }}</option>
              <option value="mute-group">{{ t('x18.actionMuteGroup') }}</option>
            </select>
          </label>

          <!-- Target (every fader/mute action) -->
          <template v-if="selectedButton.action.type !== 'mute-group'">
            <label class="x18-field">
              <span>{{ t('x18.target') }}</span>
              <select v-model="selectedButton.action.target" @change="onTargetChange">
                <option value="master">{{ t('x18.targetMaster') }}</option>
                <option value="channel">{{ t('x18.targetChannel') }}</option>
                <option value="bus">{{ t('x18.targetBus') }}</option>
              </select>
            </label>
            <label v-if="selectedButton.action.target !== 'master'" class="x18-field">
              <span>{{ selectedButton.action.target === 'bus' ? t('x18.busNumber') : t('x18.channel') }}</span>
              <input
                type="number"
                min="1"
                :max="selectedButton.action.target === 'bus' ? 6 : 16"
                step="1"
                v-model.number="selectedButton.action.channel"
                @change="onChannelChange"
              />
            </label>
          </template>

          <!-- Fader toggle levels -->
          <template v-if="selectedButton.action.type === 'fader-toggle'">
            <label class="x18-field">
              <span>{{ t('x18.levelA') }}</span>
              <input type="number" min="0" max="100" step="1" v-model.number="selectedButton.action.levelA" @change="onLevelChange('levelA')" /> %
            </label>
            <label class="x18-field">
              <span>{{ t('x18.levelB') }}</span>
              <input type="number" min="0" max="100" step="1" v-model.number="selectedButton.action.levelB" @change="onLevelChange('levelB')" /> %
            </label>
          </template>

          <!-- Relative move: how far, and whether it comes back -->
          <template v-if="selectedButton.action.type === 'fader-relative'">
            <label class="x18-field">
              <span>{{ t('x18.relativeDelta') }}</span>
              <input
                type="number"
                min="-90"
                max="90"
                step="0.5"
                v-model.number="selectedButton.action.deltaDb"
                @change="onDeltaChange"
              /> dB
            </label>
            <div class="x18-field">
              <span>{{ t('x18.mode') }}</span>
              <select :value="selectedButton.action.mode === 'step' ? 'step' : 'toggle'"
                      @change="onRelativeModeChange">
                <option value="toggle">{{ t('x18.relativeModeToggle') }}</option>
                <option value="step">{{ t('x18.relativeModeStep') }}</option>
              </select>
              <p class="x18-hint">
                {{ selectedButton.action.mode === 'step'
                    ? t('x18.relativeModeStepHint')
                    : t('x18.relativeModeToggleHint') }}
              </p>
            </div>
          </template>

          <!-- Mute group number -->
          <label v-if="selectedButton.action.type === 'mute-group'" class="x18-field">
            <span>{{ t('x18.muteGroup') }}</span>
            <input type="number" min="1" max="4" step="1" v-model.number="selectedButton.action.group" @change="onGroupChange" />
          </label>

          <!-- Mode (mute-toggle & mute-group) -->
          <label
            v-if="selectedButton.action.type === 'mute-toggle' || selectedButton.action.type === 'mute-group'"
            class="x18-field"
          >
            <span>{{ t('x18.mode') }}</span>
            <select v-model="selectedButton.action.mode" @change="persist">
              <option value="toggle">{{ t('x18.modeToggle') }}</option>
              <option value="mute">{{ t('x18.modeMute') }}</option>
              <option value="unmute">{{ t('x18.modeUnmute') }}</option>
            </select>
          </label>

          <!-- Key binding -->
          <div class="x18-field">
            <span>{{ t('x18.key') }}</span>
            <div class="x18-key-row">
              <button type="button" class="x18-key-capture" :class="{ capturing }" @click="startCapture">
                {{ capturing ? t('x18.pressKey') : (selectedButton.key ? formatKeyLabel(selectedButton.key) : t('x18.noKey')) }}
              </button>
              <button v-if="selectedButton.key" type="button" class="x18-btn x18-btn--small" @click="clearKey">
                {{ t('common.delete') }}
              </button>
            </div>
            <p v-if="captureError" class="x18-error">{{ captureError }}</p>
          </div>
        </div>

        <footer class="x18-editor__foot">
          <button class="x18-btn x18-btn--danger" @click="removeSelected">
            <span class="material-symbols-rounded">delete</span>
            {{ t('common.delete') }}
          </button>
          <button class="x18-btn" @click="closeEditor">{{ t('x18.doneEditing') }}</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { X18BoardButton, CartSlotKeyBinding } from '~/types/project';
import { PRESET_COLORS } from '~/types/project';
import { eventToBinding, isReservedCombo, formatKeyLabel } from '~/composables/useCartHotkeys';
import X18FaderPanel from './X18FaderPanel.vue';

// Module scope: one hydration per page load, however often the view mounts.
let sectionHydrated = false;

const { t } = useLocalization();
const { currentProject, saveProject } = useProject();
const { buttons, isActive, triggerButton, editMode } = useX18Board();

const hasElectron = import.meta.client && !!(window as any).electronAPI;

// Which half of the X18 view is showing. Remembered across reloads on purpose:
// a phone browser evicts a backgrounded tab freely, and an operator who has
// been riding channel levels all evening should not land back on the button
// grid every time they switch apps.
const SECTION_KEY = 'liveplay.x18.section';
const section = useState<'board' | 'faders'>('x18.section', () => 'board');

onMounted(() => {
  // Read once per page, the way useUiMode hydrates its own per-device
  // preference: X18View remounts on every switch away from the tab, and
  // re-reading storage there would clobber a choice made since.
  if (sectionHydrated) return;
  sectionHydrated = true;
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    if (saved === 'board' || saved === 'faders') section.value = saved;
  } catch { /* private mode — the default is fine */ }
});

// Nothing in the header but the title: the bottom deck tab already says so.
const headerIsRedundant = computed(() =>
  x18Configured.value && !(hasElectron && section.value === 'board'));

const selectSection = (next: 'board' | 'faders') => {
  section.value = next;
  // Edit mode suppresses live key triggering for the whole board, so leaving
  // the board with it still on would silently kill every board hotkey.
  if (next !== 'board' && editMode.value) { editMode.value = false; closeEditor(); }
  try { localStorage.setItem(SECTION_KEY, next); } catch { /* not worth an error */ }
};

const x18Configured = computed(() => {
  const ip = (currentProject.value as any)?.settings?.x18Ip;
  return typeof ip === 'string' && ip.trim().length > 0;
});

const selectedId = ref<string | null>(null);
const selectedButton = computed<X18BoardButton | null>(() =>
  buttons.value.find(b => b.id === selectedId.value) ?? null
);

const toggleEdit = () => {
  editMode.value = !editMode.value;
  if (!editMode.value) closeEditor();
};

const persist = () => { saveProject(); };

const genId = (): string => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* noop */ }
  return 'x18-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

const ensureArray = (): X18BoardButton[] => {
  const p = currentProject.value as any;
  if (!p) return [];
  if (!Array.isArray(p.x18Board)) p.x18Board = [];
  return p.x18Board as X18BoardButton[];
};

const addButton = () => {
  const arr = ensureArray();
  const b: X18BoardButton = {
    id: genId(),
    label: t('x18.title'),
    color: PRESET_COLORS[6],
    key: null,
    action: { type: 'fader-toggle', target: 'master', levelA: 0, levelB: 100 },
  };
  arr.push(b);
  selectedId.value = b.id;
  persist();
};

const removeSelected = () => {
  const arr = ensureArray();
  const i = arr.findIndex(b => b.id === selectedId.value);
  if (i >= 0) arr.splice(i, 1);
  closeEditor();
  persist();
};

const onTileClick = (b: X18BoardButton) => {
  if (editMode.value) {
    selectedId.value = b.id;
  } else {
    triggerButton(b);
  }
};

const closeEditor = () => {
  selectedId.value = null;
  stopCapture();
};

// ---- Action field editing -------------------------------------------------
const onActionTypeChange = (e: Event) => {
  const b = selectedButton.value;
  if (!b) return;
  const type = (e.target as HTMLSelectElement).value as X18BoardButton['action']['type'];
  if (type === 'fader-toggle') {
    b.action = { type, target: b.action.target ?? 'master', channel: b.action.channel, levelA: 0, levelB: 100 };
  } else if (type === 'fader-relative') {
    // -6 dB is the move people reach for: audibly quieter, still clearly there.
    b.action = { type, target: b.action.target ?? 'master', channel: b.action.channel,
                 deltaDb: -6, mode: 'toggle' };
  } else if (type === 'mute-toggle') {
    b.action = { type, target: b.action.target ?? 'master', channel: b.action.channel, mode: 'toggle' };
  } else {
    b.action = { type, group: b.action.group ?? 1, mode: 'toggle' };
  }
  persist();
};

const onTargetChange = () => {
  const a = selectedButton.value?.action;
  if (!a) return;
  if (a.target !== 'master') {
    const max = a.target === 'bus' ? 6 : 16;
    if (!a.channel || a.channel < 1 || a.channel > max) a.channel = 1;
  } else {
    delete a.channel;
  }
  persist();
};

const onChannelChange = () => {
  const a = selectedButton.value?.action;
  if (!a) return;
  const max = a.target === 'bus' ? 6 : 16;
  a.channel = Math.min(max, Math.max(1, Math.round(Number(a.channel) || 1)));
  persist();
};

const onLevelChange = (field: 'levelA' | 'levelB') => {
  const a = selectedButton.value?.action;
  if (!a) return;
  let v = Number((a as any)[field]);
  if (!Number.isFinite(v)) v = 0;
  (a as any)[field] = Math.min(100, Math.max(0, Math.round(v)));
  persist();
};

const onDeltaChange = () => {
  const a = selectedButton.value?.action;
  if (!a) return;
  let v = Number(a.deltaDb);
  if (!Number.isFinite(v)) v = -6;
  // Half a dB is the finest step the readouts show, and ±90 spans the taper.
  a.deltaDb = Math.min(90, Math.max(-90, Math.round(v * 2) / 2));
  persist();
};

const onRelativeModeChange = (e: Event) => {
  const a = selectedButton.value?.action;
  if (!a) return;
  a.mode = (e.target as HTMLSelectElement).value === 'step' ? 'step' : 'toggle';
  persist();
};

const onGroupChange = () => {
  const a = selectedButton.value?.action;
  if (!a) return;
  a.group = Math.min(4, Math.max(1, Math.round(Number(a.group) || 1)));
  persist();
};

// ---- Tile summary ---------------------------------------------------------
const targetLabel = (a: X18BoardButton['action']): string => {
  if (a.target === 'channel') return `${t('x18.channel')} ${a.channel ?? '?'}`;
  if (a.target === 'bus') return `${t('x18.targetBus')} ${a.channel ?? '?'}`;
  return t('x18.targetMaster');
};
const modeLabel = (mode?: string): string =>
  mode === 'mute' ? t('x18.modeMute') : mode === 'unmute' ? t('x18.modeUnmute') : t('x18.modeToggle');

const actionSummary = (b: X18BoardButton): string => {
  const a = b.action;
  if (!a) return '';
  if (a.type === 'fader-toggle') return `${targetLabel(a)} · ${a.levelA ?? 0}% ↔ ${a.levelB ?? 100}%`;
  if (a.type === 'fader-relative') {
    const d = a.deltaDb ?? -6;
    const signed = `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} dB`;
    // "↩" for the one that comes back, "per press" for the one that does not —
    // that difference matters more at a glance than the word "relative" does.
    return `${targetLabel(a)} · ${signed} ${a.mode === 'step' ? t('x18.relativeSummaryStep') : '↩'}`;
  }
  if (a.type === 'mute-toggle') return `${targetLabel(a)} · ${modeLabel(a.mode)}`;
  return `${t('x18.muteGroup')} ${a.group ?? 1} · ${modeLabel(a.mode)}`;
};

// ---- Key capture ----------------------------------------------------------
const capturing = ref(false);
const captureError = ref('');

const startCapture = () => { capturing.value = true; captureError.value = ''; };
const stopCapture = () => { capturing.value = false; captureError.value = ''; };

const clearKey = () => {
  const b = selectedButton.value;
  if (!b) return;
  b.key = null;
  persist();
};

// True if `binding` collides with a cart slot, playback action, or another
// board button (which would shadow this board key in the global handler).
const findConflict = (binding: CartSlotKeyBinding, selfId: string): string | null => {
  const match = (x: CartSlotKeyBinding | null | undefined) =>
    !!x && x.key.toLowerCase() === binding.key.toLowerCase()
    && x.ctrlKey === binding.ctrlKey && x.shiftKey === binding.shiftKey && x.altKey === binding.altKey;

  const p = currentProject.value as any;
  if (p) {
    const cart = p.cartSlotKeys ?? {};
    for (const [slot, b] of Object.entries(cart)) {
      if (match(b as CartSlotKeyBinding)) return t('x18.conflictCart', { n: parseInt(slot, 10) + 1 });
    }
    const pb = p.playbackKeys ?? {};
    for (const b of Object.values(pb)) {
      if (match(b as CartSlotKeyBinding)) return t('x18.conflictPlayback');
    }
  }
  for (const other of buttons.value) {
    if (other.id !== selfId && match(other.key)) return t('x18.conflictBoard', { label: other.label || '—' });
  }
  return null;
};

const handleCaptureKeydown = (e: KeyboardEvent) => {
  if (!capturing.value) return;
  if (e.key === 'Escape') { stopCapture(); e.preventDefault(); return; }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();

  const binding = eventToBinding(e);
  if (isReservedCombo(binding)) { captureError.value = t('x18.keyReserved'); return; }
  const b = selectedButton.value;
  if (!b) { stopCapture(); return; }
  const conflict = findConflict(binding, b.id);
  if (conflict) { captureError.value = conflict; return; }
  b.key = binding;
  stopCapture();
  persist();
};

onMounted(() => window.addEventListener('keydown', handleCaptureKeydown, true));
onUnmounted(() => {
  window.removeEventListener('keydown', handleCaptureKeydown, true);
  // Leaving the view must re-enable live key triggering.
  editMode.value = false;
});
</script>

<style scoped>
.x18-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  overflow: hidden;
}

.x18-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}
.x18-title { display: flex; align-items: center; gap: 8px; }
.x18-title h2 { margin: 0; font-size: 18px; }
.x18-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.x18-warn { color: #e0a000; font-size: 12px; }

.x18-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
@media (any-hover: hover) and (any-pointer: fine) {
  .x18-btn:hover { background: var(--color-surface-hover); }
}
.x18-btn--active { color: var(--color-accent); border-color: var(--color-accent); }
.x18-btn--small { padding: 6px 10px; }
.x18-btn--danger { color: #e53e3e; border-color: #e53e3e; }
.x18-btn .material-symbols-rounded { font-size: 18px; }

/* ---- Board / faders switch ---- */
.x18-sections {
  display: flex;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-md) 0;
  flex: none;
}
.x18-section {
  flex: 1;
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}
.x18-section--active {
  color: var(--color-text-primary);
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
}
.x18-section .material-symbols-rounded { font-size: 20px; }
.x18-section__count {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.22);
}
@media (any-hover: hover) and (any-pointer: fine) {
  .x18-section:hover { background: var(--color-surface-hover); }
  .x18-section--active:hover { background: color-mix(in srgb, var(--color-accent) 24%, var(--color-surface)); }
}

.x18-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  color: var(--color-text-secondary);
}
.x18-empty .material-symbols-rounded { font-size: 48px; }

.x18-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  align-content: start;
}

.x18-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  min-height: 96px;
  padding: 12px;
  border-radius: 8px;
  border: 2px solid var(--tile-color, var(--color-border));
  background: color-mix(in srgb, var(--tile-color, var(--color-surface)) 18%, var(--color-surface));
  color: var(--color-text-primary);
  cursor: pointer;
  text-align: left;
  transition: transform 0.05s ease, box-shadow 0.1s ease;
}
@media (any-hover: hover) and (any-pointer: fine) {
  .x18-tile:hover { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
}
.x18-tile:active { transform: scale(0.98); }
.x18-tile--active {
  background: color-mix(in srgb, var(--tile-color, var(--color-accent)) 55%, var(--color-surface));
  box-shadow: 0 0 0 2px var(--tile-color, var(--color-accent)) inset;
}
.x18-tile--editing { outline: 2px dashed var(--color-accent); outline-offset: 2px; }
.x18-tile__label { font-weight: 600; font-size: 15px; }
.x18-tile__summary { font-size: 11px; color: var(--color-text-secondary); }
.x18-tile__key {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.25);
}
.x18-tile__edit { position: absolute; top: 8px; right: 8px; font-size: 16px; opacity: 0.6; }

/* ---- Editor overlay ---- */
.x18-editor-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.x18-editor {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  width: min(480px, 94vw);
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  color: var(--color-text-primary);
}
.x18-editor__head, .x18-editor__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
}
.x18-editor__head { border-bottom: 1px solid var(--color-border); }
.x18-editor__head h3 { margin: 0; font-size: 16px; }
.x18-editor__foot { border-top: 1px solid var(--color-border); }
.x18-editor__close { background: none; border: none; color: var(--color-text-secondary); font-size: 18px; cursor: pointer; }
.x18-editor__body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }

.x18-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-text-secondary); }
.x18-field input[type="text"], .x18-field input[type="number"], .x18-field select {
  padding: 8px 10px;
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: max(14px, var(--lp-input-fs-min));
  min-height: var(--lp-input-h);
}
.x18-field input[type="number"] { width: 90px; }

.x18-colors { display: flex; flex-wrap: wrap; gap: 6px; }
.x18-color { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.x18-color.active { border-color: var(--color-text-primary); }

.x18-key-row { display: flex; align-items: center; gap: 8px; }
.x18-key-capture {
  flex: 1;
  padding: 8px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-primary);
  cursor: pointer;
  font-family: var(--font-mono);
}
.x18-key-capture.capturing { border-color: var(--color-accent); color: var(--color-accent); }
.x18-error { color: #e53e3e; font-size: 12px; margin: 0; }
.x18-hint { color: var(--color-text-secondary); font-size: 11px; line-height: 1.4; margin: 2px 0 0; }

/* ---- Phone: less chrome, readable tiles -------------------------------- */
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .x18-header {
    padding: var(--spacing-sm) var(--spacing-md);
    gap: var(--spacing-sm);
    min-height: var(--lp-panel-header-h);
    flex-wrap: wrap;
  }
  .x18-title h2 {
    font-size: 16px;
  }
  /* Full-width own row, so hiding the editor actions can never hide the
     "no IP configured" warning with them. */
  .x18-warn {
    flex: 1 0 100%;
    order: 2;
  }
  .x18-header--redundant { display: none; }
  .x18-sections {
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-sm) 0;
  }
  .x18-section {
    min-height: var(--lp-tap);
    font-size: 15px;
  }
  .x18-section .material-symbols-rounded { font-size: var(--lp-tap-icon); }
  .x18-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    overscroll-behavior: contain;
  }
  .x18-tile {
    min-height: 88px;
    justify-content: flex-start;
    gap: 2px;
    touch-action: manipulation;
  }
  .x18-tile__label {
    font-size: 17px;
  }
  .x18-tile__summary {
    font-size: 13px;
  }
  /* A PC-keyboard badge competing with the label for the one glance you get. */
  .x18-tile__key {
    display: none;
  }
  .x18-btn {
    min-height: var(--lp-tap);
  }
}

/* Landscape: the two nav rows above the faders cost a third of the screen at
   the portrait sizes. Shrink the outer one; X18FaderPanel shrinks its own. */
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .x18-sections {
    padding: 6px var(--spacing-sm) 0;
  }
  .x18-section {
    min-height: var(--lp-tap-sm);
  }
}
</style>
