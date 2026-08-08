<template>
  <!--
    Add or change one fader. On a phone this is the app's shared bottom sheet
    (.lp-sheet + friends, declared in main.scss inside the compact query), not a
    hand-rolled one: that convention is what makes every dialog stop ABOVE the
    bottom bar instead of hiding its own action row behind it — the bar sits at
    z-index 1600 precisely so STOP ALL CUES stays reachable through any dialog.

    Not inside <Teleport> for the same reason the other modals are not: Vue's
    scoped styles do not reach teleported nodes.
  -->
  <div class="x18-ed__backdrop lp-sheet-backdrop" @click.self="emit('close')">
    <div class="x18-ed lp-sheet" role="dialog" aria-modal="true" :aria-label="t('x18.faderEditEntry')">
      <header class="x18-ed__head lp-sheet__bar lp-sheet__bar--top">
        <h3>{{ existing ? t('x18.faderEditEntry') : t('x18.faderAdd') }}</h3>
        <button type="button" class="x18-ed__close lp-close" :aria-label="t('common.cancel')" @click="emit('close')">✕</button>
      </header>

      <div class="x18-ed__body lp-sheet__scroll">
        <!-- What the fader controls. Plain words, not console jargon: "the bus
             itself" vs "one channel on that bus" is the distinction that
             matters, and it is the one people ask about. -->
        <fieldset class="x18-ed__field">
          <legend>{{ t('x18.faderWhat') }}</legend>
          <div class="x18-ed__choices">
            <button
              type="button"
              class="x18-ed__choice"
              :class="{ 'x18-ed__choice--active': kind === 'mix' }"
              :aria-pressed="kind === 'mix' ? 'true' : 'false'"
              @click="kind = 'mix'"
            >
              <span class="x18-ed__choice-title">{{ t('x18.faderKindMix') }}</span>
              <span class="x18-ed__choice-hint">{{ t('x18.faderKindMixHint') }}</span>
            </button>
            <button
              type="button"
              class="x18-ed__choice"
              :class="{ 'x18-ed__choice--active': kind === 'send' }"
              :aria-pressed="kind === 'send' ? 'true' : 'false'"
              @click="kind = 'send'"
            >
              <span class="x18-ed__choice-title">{{ t('x18.faderKindSend') }}</span>
              <span class="x18-ed__choice-hint">{{ t('x18.faderKindSendHint') }}</span>
            </button>
          </div>
        </fieldset>

        <fieldset class="x18-ed__field">
          <legend>{{ kind === 'mix' ? t('x18.faderWhichMixOwn') : t('x18.faderWhichMix') }}</legend>
          <div class="x18-ed__grid">
            <button
              v-for="option in MIXES"
              :key="String(option)"
              type="button"
              class="x18-ed__pill"
              :class="{ 'x18-ed__pill--active': bus === option }"
              :aria-pressed="bus === option ? 'true' : 'false'"
              @click="bus = option"
            >{{ x18MixLabel(option) }}</button>
          </div>
        </fieldset>

        <fieldset v-if="kind === 'send'" class="x18-ed__field">
          <legend>{{ t('x18.faderWhichChannel') }}</legend>
          <div class="x18-ed__grid x18-ed__grid--channels">
            <button
              v-for="n in X18_CHANNEL_COUNT"
              :key="n"
              type="button"
              class="x18-ed__pill"
              :class="{ 'x18-ed__pill--active': channel === n }"
              :aria-pressed="channel === n ? 'true' : 'false'"
              @click="channel = n"
            >{{ n }}</button>
          </div>
        </fieldset>

        <label class="x18-ed__field">
          <span>{{ t('x18.faderName') }}</span>
          <input
            ref="labelRef"
            type="text"
            class="x18-ed__input"
            :maxlength="32"
            :placeholder="preview"
            v-model="label"
          />
          <span class="x18-ed__hint">{{ t('x18.faderNameHint', { preview }) }}</span>
        </label>

        <p v-if="duplicate" class="x18-ed__warn">{{ t('x18.faderDuplicate') }}</p>
      </div>

      <footer class="x18-ed__foot lp-sheet__bar lp-sheet__bar--bottom">
        <button v-if="existing" type="button" class="x18-ed__btn x18-ed__btn--danger" @click="onDelete">
          <span class="material-symbols-rounded" aria-hidden="true">delete</span>
          {{ t('common.delete') }}
        </button>
        <span class="x18-ed__spacer"></span>
        <button type="button" class="x18-ed__btn" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="button" class="x18-ed__btn x18-ed__btn--primary" :disabled="!valid" @click="onSave">
          {{ t('settings.save') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  X18_BUS_COUNT,
  X18_CHANNEL_COUNT,
  isSameX18Target,
  isValidX18Entry,
  x18EntryTag,
  x18MixLabel,
  type X18FaderEntry,
  type X18Mix,
} from '~/utils/x18Fader';

const props = defineProps<{
  /** The entry being changed, or null when adding a new one. */
  existing?: X18FaderEntry | null;
  /** Everything already on the list, so we can warn about a duplicate target. */
  siblings: X18FaderEntry[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', value: Omit<X18FaderEntry, 'id'>): void;
  (e: 'delete'): void;
}>();

const { t } = useLocalization();

const MIXES: X18Mix[] = ['lr', ...Array.from({ length: X18_BUS_COUNT }, (_, i) => i + 1)];

const kind = ref<'mix' | 'send'>(props.existing?.kind ?? 'send');
const bus = ref<X18Mix>(props.existing?.bus ?? 'lr');
const channel = ref<number>(props.existing?.channel ?? 1);
const label = ref<string>(props.existing?.label ?? '');
const labelRef = ref<HTMLInputElement | null>(null);

const draft = computed<X18FaderEntry>(() => ({
  id: props.existing?.id ?? 'draft',
  kind: kind.value,
  bus: bus.value,
  ...(kind.value === 'send' ? { channel: channel.value } : {}),
  label: label.value,
}));

/** What the strip will read when no name is given. */
const preview = computed(() => x18EntryTag(draft.value));
const valid = computed(() => isValidX18Entry(draft.value));

// Two faders on the same parameter fight each other on every echo. Allowed —
// an operator may genuinely want one near the top and one near the bottom of a
// long list — but worth saying out loud.
const duplicate = computed(() =>
  props.siblings.some(s => s.id !== props.existing?.id && isSameX18Target(s, draft.value)));

function onSave() {
  if (!valid.value) return;
  emit('save', {
    kind: kind.value,
    bus: bus.value,
    ...(kind.value === 'send' ? { channel: channel.value } : {}),
    label: label.value.trim(),
  });
}

function onDelete() { emit('delete'); }

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close'); }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true));
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<style scoped>
.x18-ed__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.x18-ed {
  display: flex;
  flex-direction: column;
  width: min(460px, 96vw);
  max-height: 90vh;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-text-primary);
  overflow: hidden;
}

.x18-ed__head,
.x18-ed__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  flex: none;
}
.x18-ed__head { border-bottom: 1px solid var(--color-border); justify-content: space-between; }
.x18-ed__head h3 { margin: 0; font-size: 16px; }
.x18-ed__foot { border-top: 1px solid var(--color-border); }
.x18-ed__spacer { flex: 1; }
.x18-ed__close {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 18px;
  cursor: pointer;
  min-width: 40px;
  min-height: 40px;
}

.x18-ed__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.x18-ed__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.x18-ed__field legend { padding: 0; font-size: 13px; color: var(--color-text-secondary); }

.x18-ed__choices { display: flex; gap: 8px; }
.x18-ed__choice {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  padding: 10px 12px;
  min-height: 56px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  touch-action: manipulation;
}
.x18-ed__choice--active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
  color: var(--color-text-primary);
}
.x18-ed__choice-title { font-size: 14px; font-weight: 600; }
.x18-ed__choice-hint { font-size: 11px; line-height: 1.3; opacity: 0.85; }

.x18-ed__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}
.x18-ed__grid--channels { grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); }
.x18-ed__pill {
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  touch-action: manipulation;
}
.x18-ed__pill--active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 22%, var(--color-surface));
  color: var(--color-text-primary);
}

.x18-ed__input {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  /* 16px is iOS's focus-zoom floor. */
  font-size: max(16px, var(--lp-input-fs-min));
  min-height: 44px;
}
.x18-ed__hint { font-size: 11px; line-height: 1.4; }
.x18-ed__warn { margin: 0; font-size: 12px; color: var(--color-warning); }

.x18-ed__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}
.x18-ed__btn:disabled { opacity: 0.45; cursor: default; }
.x18-ed__btn--primary { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 26%, var(--color-surface)); }
.x18-ed__btn--danger { color: #e53e3e; border-color: #e53e3e; }
.x18-ed__btn .material-symbols-rounded { font-size: 18px; }

@media (any-hover: hover) and (any-pointer: fine) {
  .x18-ed__choice:hover,
  .x18-ed__pill:hover,
  .x18-ed__btn:hover:not(:disabled) { background: var(--color-surface-hover); }
}

/* Phone: a bottom sheet, because that is where the thumb is.
   The geometry is spelled out here rather than left to .lp-sheet because a
   scoped rule (.x18-ed[data-v-…]) out-specifies the global one — the base
   `max-height: 90vh` and `width: min(460px, 96vw)` above would otherwise win on
   a phone and push the action row down behind the bottom bar, which is exactly
   the bug this replaced. Values match main.scss's .lp-sheet. */
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .x18-ed__backdrop { align-items: flex-end; padding: 0; padding-top: env(safe-area-inset-top); }
  .x18-ed {
    position: fixed;
    left: 0;
    right: 0;
    top: auto;
    /* Stops above the bottom bar, so Cancel/Save land in front of it and
       STOP ALL CUES stays reachable behind. */
    bottom: var(--lp-bottom-h);
    width: 100%;
    max-width: none;
    max-height: calc(100dvh - var(--lp-sheet-top) - var(--lp-bottom-h) - env(safe-area-inset-top));
    border-radius: 14px 14px 0 0;
    border-bottom: none;
    overflow: hidden;
  }
  /* The one part that scrolls. Without min-height:0 a flex child refuses to
     shrink below its content and the sheet grows instead of scrolling. */
  .x18-ed__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .x18-ed__foot { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .x18-ed__close { min-width: var(--lp-tap); min-height: var(--lp-tap); }
  .x18-ed__pill { min-height: var(--lp-tap); font-size: 15px; }
  .x18-ed__choice { min-height: var(--lp-tap-lg); }
  .x18-ed__btn { min-height: var(--lp-tap); }
  .x18-ed__input { min-height: var(--lp-tap); }
}
</style>
