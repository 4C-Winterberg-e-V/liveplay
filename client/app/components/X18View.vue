<template>
  <div class="x18-view">
    <div class="x18-header">
      <div class="x18-title">
        <span class="material-symbols-rounded">equalizer</span>
        <h2>{{ t('x18.title') }}</h2>
      </div>
      <div class="x18-header-actions">
        <span v-if="!x18Configured" class="x18-warn">{{ t('x18.boardRequiresIp') }}</span>
        <button
          v-if="hasElectron"
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

    <div v-if="buttons.length === 0" class="x18-empty">
      <span class="material-symbols-rounded">add_circle</span>
      <p>{{ hasElectron ? t('x18.emptyDesktop') : t('x18.emptyViewer') }}</p>
    </div>

    <div v-else class="x18-grid">
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
              <option value="mute-toggle">{{ t('x18.actionMuteToggle') }}</option>
              <option value="mute-group">{{ t('x18.actionMuteGroup') }}</option>
            </select>
          </label>

          <!-- Target (fader-toggle & mute-toggle) -->
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

          <!-- Mute group number -->
          <label v-if="selectedButton.action.type === 'mute-group'" class="x18-field">
            <span>{{ t('x18.muteGroup') }}</span>
            <input type="number" min="1" max="4" step="1" v-model.number="selectedButton.action.group" @change="onGroupChange" />
          </label>

          <!-- Mode (mute-toggle & mute-group) -->
          <label v-if="selectedButton.action.type !== 'fader-toggle'" class="x18-field">
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

const { t } = useLocalization();
const { currentProject, saveProject } = useProject();
const { buttons, isActive, triggerButton } = useX18Board();

const hasElectron = import.meta.client && !!(window as any).electronAPI;

const x18Configured = computed(() => {
  const ip = (currentProject.value as any)?.settings?.x18Ip;
  return typeof ip === 'string' && ip.trim().length > 0;
});

const editMode = ref(false);
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
onUnmounted(() => window.removeEventListener('keydown', handleCaptureKeydown, true));
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
.x18-btn:hover { background: var(--color-surface-hover); }
.x18-btn--active { color: var(--color-accent); border-color: var(--color-accent); }
.x18-btn--small { padding: 6px 10px; }
.x18-btn--danger { color: #e53e3e; border-color: #e53e3e; }
.x18-btn .material-symbols-rounded { font-size: 18px; }

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
.x18-tile:hover { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
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
  font-size: 14px;
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
</style>
