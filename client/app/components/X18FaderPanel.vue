<template>
  <div class="x18-faders">
    <div class="x18-faders__bar">
      <!-- Whether the desk is actually answering. Everything below is only as
           true as this line: the levels are read from the console, so "not
           reachable" and "at 0 dB" must never look the same. -->
      <span class="x18-faders__link" :class="{ 'x18-faders__link--up': linkUp }">
        <span class="x18-faders__dot" aria-hidden="true"></span>
        {{ linkUp ? t('x18.faderLinkUp') : (isConfigured ? t('x18.faderLinkWaiting') : t('x18.faderLinkNone')) }}
      </span>
      <button v-if="canEdit" type="button" class="x18-faders__add" @click="openEditor(null)">
        <span class="material-symbols-rounded" aria-hidden="true">add</span>
        {{ t('x18.faderAdd') }}
      </button>
    </div>

    <div v-if="entries.length === 0" class="x18-faders__empty">
      <span class="material-symbols-rounded" aria-hidden="true">tune</span>
      <p>{{ canEdit ? t('x18.faderEmpty') : t('x18.faderEmptyLocked') }}</p>
    </div>

    <div v-else class="x18-faders__list lp-scroll-fade">
      <div v-for="(entry, i) in entries" :key="entry.id" class="x18-faders__row">
        <X18FaderStrip
          :entry="entry"
          :disabled="!isConfigured"
          @edit="openEditor(entry)"
        />
        <!-- Order is the operator's: the two faders you touch every service
             belong at the top, not wherever they happened to be added. -->
        <div v-if="canEdit && entries.length > 1" class="x18-faders__order">
          <button
            type="button"
            class="x18-faders__move"
            :disabled="i === 0"
            :aria-label="t('x18.faderMoveUp', { name: entryName(entry) })"
            @click="moveEntry(entry.id, -1)"
          ><span class="material-symbols-rounded" aria-hidden="true">keyboard_arrow_up</span></button>
          <button
            type="button"
            class="x18-faders__move"
            :disabled="i === entries.length - 1"
            :aria-label="t('x18.faderMoveDown', { name: entryName(entry) })"
            @click="moveEntry(entry.id, 1)"
          ><span class="material-symbols-rounded" aria-hidden="true">keyboard_arrow_down</span></button>
        </div>
      </div>
    </div>

    <X18FaderEditor
      v-if="editorOpen"
      :existing="editing"
      :siblings="entries"
      @close="closeEditor"
      @save="onSave"
      @delete="onDelete"
    />
  </div>
</template>

<script setup lang="ts">
import X18FaderStrip from './X18FaderStrip.vue';
import X18FaderEditor from './X18FaderEditor.vue';
import { x18EntryTag, type X18FaderEntry } from '~/utils/x18Fader';

const { t } = useLocalization();
const { uiMode } = useUiMode();
const server = useLiveplayServer();
const {
  isConfigured, consoleIp, linkUp, entries,
  addEntry, updateEntry, removeEntry, moveEntry,
  refresh, applyValues,
} = useX18Faders();

// Adding and reordering are edit affordances; riding the faders is not. Same
// rule the rest of the app follows once the show has started.
const canEdit = computed(() => uiMode.value !== 'playback');

const entryName = (entry: X18FaderEntry) => (entry.label ?? '').trim() || x18EntryTag(entry);

// ---- Editor ---------------------------------------------------------------
const editorOpen = ref(false);
const editing = ref<X18FaderEntry | null>(null);

const openEditor = (entry: X18FaderEntry | null) => {
  if (!canEdit.value) return;
  editing.value = entry;
  editorOpen.value = true;
};
const closeEditor = () => { editorOpen.value = false; editing.value = null; };

const onSave = (value: Omit<X18FaderEntry, 'id'>) => {
  if (editing.value) updateEntry(editing.value.id, value);
  else addEntry(value);
  closeEditor();
};
const onDelete = () => {
  if (editing.value) removeEntry(editing.value.id);
  closeEditor();
};

// ---- Live console state ----------------------------------------------------
// The server owns the socket, so it is the one the desk talks to. A joining
// client pulls the whole picture once, then rides the doc_patch stream — the
// same one that carries a fader another operator just moved, and the one a hand
// on the physical console produces.
let stopPatch: (() => void) | null = null;
let stopReconnect: (() => void) | null = null;

onMounted(() => {
  stopPatch = server.onDocPatch((p: any) => {
    if (p?.op === 'x18_state') applyValues(p.values);
  });
  // The server's cache does not survive its own restart, and a reconnect is
  // exactly when ours is most likely to be stale.
  stopReconnect = server.onReconnected?.(() => { void refresh(); }) ?? null;
});
onUnmounted(() => { stopPatch?.(); stopReconnect?.(); });

// Re-read on any change of console: a different desk means different levels,
// and "no desk" means we know nothing at all.
watch(consoleIp, () => { void refresh(); }, { immediate: true });
</script>

<style scoped>
.x18-faders {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.x18-faders__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-md) 0;
  flex: none;
}

.x18-faders__link {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.x18-faders__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--color-text-secondary);
  opacity: 0.5;
}
.x18-faders__link--up .x18-faders__dot { background: #24a148; opacity: 1; }

.x18-faders__add {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}
.x18-faders__add .material-symbols-rounded { font-size: 20px; }

.x18-faders__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  color: var(--color-text-secondary);
  text-align: center;
}
.x18-faders__empty .material-symbols-rounded { font-size: 44px; opacity: 0.5; }
.x18-faders__empty p { margin: 0; max-width: 32em; line-height: 1.5; }

/* One column on a phone, more as the window grows: a single strip stretched
   across a desktop is one absurdly long fader where eight more would fit. */
.x18-faders__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
  align-content: start;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
  overscroll-behavior: contain;
}

.x18-faders__row { display: flex; align-items: stretch; gap: 6px; min-width: 0; }
.x18-faders__row > :first-child { flex: 1; min-width: 0; }

.x18-faders__order { display: flex; flex-direction: column; gap: 4px; flex: none; }
.x18-faders__move {
  flex: 1;
  width: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  touch-action: manipulation;
}
.x18-faders__move:disabled { opacity: 0.3; cursor: default; }
.x18-faders__move .material-symbols-rounded { font-size: 18px; }

@media (any-hover: hover) and (any-pointer: fine) {
  .x18-faders__add:hover { background: color-mix(in srgb, var(--color-accent) 26%, var(--color-surface)); }
  .x18-faders__move:hover:not(:disabled) { background: var(--color-surface-hover); }
}

@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .x18-faders__bar {
    padding: var(--spacing-sm) var(--spacing-sm) 0;
  }
  .x18-faders__link { font-size: 13px; }
  .x18-faders__add { min-height: var(--lp-tap); font-size: 15px; }
  .x18-faders__list {
    gap: 6px;
    padding: var(--spacing-sm);
  }
  .x18-faders__move { width: 36px; }
}

/* Landscape: height is the scarce axis, so one column of the single-line
   strips rather than two columns of two-line ones. */
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .x18-faders__list {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 6px var(--spacing-sm) var(--spacing-sm);
  }
  .x18-faders__bar { padding: 6px var(--spacing-sm) 0; }
  .x18-faders__add { min-height: var(--lp-tap-sm); }
}
</style>
