<template>
  <!--
    One touch-first channel level for the X18.

    Why a horizontal fader in a vertical list instead of the console's column of
    vertical faders: on a phone in portrait a vertical fader gets ~300px of
    height to share between every strip, while a horizontal one gets the full
    width per strip and the list scrolls the way every other list on the phone
    does. The drag axis is also the axis a thumb is most accurate on.

    Interaction rules, all deliberate:
      • Drag is RELATIVE, never absolute — tapping the track does not jump the
        level. On a live desk an accidental tap must not become a level change.
      • touch-action: pan-y, so a vertical swipe scrolls the list and only a
        horizontal drag moves the fader.
      • Straying off-axis while dragging makes the fader finer (see
        dragSensitivity), the way an iOS slider does.
      • ± buttons step 0.5 dB and repeat when held — the guaranteed-precise path
        that needs no gesture at all.
      • The value chip is a text field: tap it and type a number.
  -->
  <div class="x18-strip" :class="{ 'x18-strip--dragging': dragging, 'x18-strip--unsent': !sentFlag }">
    <div class="x18-strip__head">
      <!-- Tap the name to rename the strip. Renaming can never make a sound, so
           unlike every audible control here it needs no confirmation and is not
           gated to the desktop — the phone is exactly where you need to read
           "Funke Pfarrer" instead of "CH 3". -->
      <button
        v-if="!namingEdit"
        type="button"
        class="x18-strip__name"
        :class="{ 'x18-strip__name--tagged': !!customName }"
        :disabled="!canRename"
        :title="canRename ? t('x18.faderRename') : undefined"
        @click="startNaming"
      >
        <span class="x18-strip__tag">{{ strip.short }}</span>
        <span v-if="customName" class="x18-strip__label">{{ customName }}</span>
      </button>
      <input
        v-else
        ref="nameRef"
        class="x18-strip__name-input"
        type="text"
        :maxlength="24"
        :aria-label="t('x18.faderRename')"
        :placeholder="strip.short"
        v-model="nameValue"
        @blur="commitName"
        @keyup.enter="commitName"
        @keyup.escape="namingEdit = false"
      />

      <!-- A title attribute needs a mouse to read, which is exactly the device
           this feature is not built for. When a command does not land, say so in
           words on the strip. -->
      <span v-if="failedFlag" class="x18-strip__warn" role="status">
        <span class="material-symbols-rounded" aria-hidden="true">sync_problem</span>
        {{ t('x18.faderNotSent') }}
      </span>

      <button
        v-if="!editing"
        type="button"
        class="x18-strip__value"
        :disabled="disabled"
        :title="t('x18.faderSetLevel', { name: spokenName })"
        @click="startEdit"
      >
        {{ formatX18Db(db) }}<small>dB</small>
      </button>
      <input
        v-else
        ref="editRef"
        class="x18-strip__value-input"
        type="text"
        inputmode="decimal"
        :aria-label="t('x18.faderSetLevel', { name: spokenName })"
        v-model="editValue"
        @blur="commitEdit"
        @keyup.enter="commitEdit"
        @keyup.escape="editing = false"
      />
    </div>

    <div class="x18-strip__row">
      <button
        type="button"
        class="x18-strip__step"
        :disabled="disabled"
        :aria-label="t('x18.faderDown', { name: spokenName })"
        @pointerdown="startRepeat($event, -STEP_DB)"
        @keydown="onStepKeydown($event, -STEP_DB)"
      >
        <span class="material-symbols-rounded" aria-hidden="true">remove</span>
      </button>

      <div
        ref="trackRef"
        class="x18-strip__track"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        :aria-label="t('x18.faderLevel', { name: spokenName })"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(pos * 100)"
        :aria-valuetext="spokenLevel"
        :aria-disabled="disabled ? 'true' : 'false'"
        @pointerdown="onPointerDown"
        @keydown="onKeydown"
        @wheel="onWheel"
      >
        <div class="x18-strip__rail">
          <div class="x18-strip__fill" :style="{ width: fillPct + '%' }"></div>
          <div v-if="pos > X18_UNITY_POS" class="x18-strip__over" :style="overStyle"></div>
          <!-- Scale marks. On a dimmed phone in a blacked-out room the thumb's
               position is the only thing an operator can read, and it means
               nothing without landmarks — unity most of all. -->
          <div
            v-for="tick in TICKS"
            :key="tick.db"
            class="x18-strip__tick"
            :class="{ 'x18-strip__tick--unity': tick.db === 0 }"
            :style="{ left: tick.pos * 100 + '%' }"
          ></div>
          <div class="x18-strip__thumb" :style="{ left: fillPct + '%' }"></div>
        </div>
        <span v-if="dragging && sensitivity < 1" class="x18-strip__fine">
          {{ t('x18.faderFine') }} ×{{ sensitivity }}
        </span>
      </div>

      <button
        type="button"
        class="x18-strip__step"
        :disabled="disabled"
        :aria-label="t('x18.faderUp', { name: spokenName })"
        @pointerdown="startRepeat($event, STEP_DB)"
        @keydown="onStepKeydown($event, STEP_DB)"
      >
        <span class="material-symbols-rounded" aria-hidden="true">add</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  X18_UNITY_POS,
  clampPos,
  dragSensitivity,
  formatX18Db,
  stepPosByDb,
  x18DbToPos,
  x18PosToDb,
  type X18Strip,
} from '~/utils/x18Fader';

const props = defineProps<{
  strip: X18Strip;
  disabled?: boolean;
}>();

const { t } = useLocalization();
const { positionOf, isSent, hasFailed, setPosition, nameOf, setName } = useX18Faders();

const STEP_DB = 0.5;
const PAGE_DB = 6;

// Landmarks along the rail. Unity is the one that matters; the rest give the
// thumb a scale to be read against instead of a bare stripe.
const TICKS = [-40, -20, -10, 0, 10].map(db => ({ db, pos: x18DbToPos(db) }));

const pos = computed(() => positionOf(props.strip));
const db = computed(() => x18PosToDb(pos.value));
const customName = computed(() => nameOf(props.strip));

// Every accessible name on this strip carries whatever the operator called it.
// The rename feature exists because "CH 3" does not say which microphone is too
// loud — a screen reader announcing "CH 3 level" and nothing else would hand
// back exactly the problem the naming was added to solve.
const spokenName = computed(() =>
  customName.value ? `${props.strip.short} ${customName.value}` : props.strip.short);

// aria-valuetext must be a translated sentence, not a hardcoded English one —
// it is the ONLY thing a screen reader reads out for this slider.
const spokenLevel = computed(() => Number.isFinite(db.value)
  ? t('x18.faderSpokenDb', { db: Math.round(db.value * 10) / 10 })
  : t('x18.faderSpokenOff'));
const sentFlag = computed(() => isSent(props.strip));
const failedFlag = computed(() => hasFailed(props.strip));

const fillPct = computed(() => pos.value * 100);
// Anything above unity is gain the operator added on top of the desk's nominal
// setting; colouring it apart is the cheapest "you are boosting" cue there is.
const overStyle = computed(() => ({
  left: X18_UNITY_POS * 100 + '%',
  width: Math.max(0, pos.value - X18_UNITY_POS) * 100 + '%',
}));

const apply = (next: number) => {
  if (props.disabled) return;
  setPosition(props.strip, next);
};

// ---- Drag -----------------------------------------------------------------
const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const sensitivity = ref(1);

let lastX = 0;
let startY = 0;
let accPos = 0;
let railWidth = 1;
let activePointer: number | null = null;
// Position before this gesture touched anything, so a cancelled gesture can put
// it back exactly.
let posBeforeDrag = 0;
// A drag only counts once the finger has committed to the horizontal axis.
let armed = false;
const DRAG_SLOP_PX = 8;

const railPx = (): number => {
  const rail = trackRef.value?.querySelector('.x18-strip__rail') as HTMLElement | null;
  return Math.max(1, rail?.clientWidth ?? 1);
};

function onPointerDown(e: PointerEvent) {
  if (props.disabled) return;
  // Left button only for a mouse; touch and pen always report button 0.
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // One drag per strip. Deliberately NOT gated on e.isPrimary: a finger that
  // lands while another one is already down anywhere on the page is
  // non-primary for its whole life, so that check made the fader dead for
  // anyone resting a thumb on the screen while holding the phone. The
  // pointerId filtering below is what actually keeps two drags apart.
  if (dragging.value) return;

  dragging.value = true;
  activePointer = e.pointerId;
  lastX = e.clientX;
  startY = e.clientY;
  accPos = pos.value;
  posBeforeDrag = pos.value;
  armed = false;
  railWidth = railPx();
  sensitivity.value = 1;
  // Focus so the arrow keys work straight after a tap, without the tap itself
  // changing anything.
  try { trackRef.value?.focus({ preventScroll: true }); } catch { /* older engines */ }
  try { trackRef.value?.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  // The browser fires pointercancel when it decides the gesture is a scroll
  // (touch-action: pan-y). Treating that as "drag over" is what keeps a
  // scrolling flick from dragging a level with it.
  window.addEventListener('pointercancel', endDrag);
}

// The level accumulates from each move's own delta rather than being recomputed
// from the whole drag. Scaling the total by the CURRENT sensitivity would make
// the level jump the moment the finger crosses a fine-mode threshold — a
// 60px-in drag re-scaled from ×1 to ×0.4 snaps the fader by ~5 dB, on a live
// channel, purely because the thumb wandered off the track.
function onPointerMove(e: PointerEvent) {
  if (!dragging.value || (activePointer !== null && e.pointerId !== activePointer)) return;

  // `touch-action: pan-y` tells the BROWSER what it may claim; it does not stop
  // pointermove from being delivered from the first pixel. Without a slop gate,
  // a flick to scroll the channel list that starts a few degrees off vertical
  // moves a live level — and sends it — before the browser has decided the
  // gesture was a scroll at all. Nothing is applied until the finger has clearly
  // chosen the horizontal axis, and the drag re-anchors there so crossing the
  // threshold does not jump by the slop distance.
  if (!armed) {
    const dxTotal = e.clientX - lastX;
    const dyTotal = e.clientY - startY;
    if (Math.abs(dxTotal) <= DRAG_SLOP_PX || Math.abs(dxTotal) <= Math.abs(dyTotal)) return;
    armed = true;
    lastX = e.clientX;
    return;
  }

  // Shift is CanvasFader's fine-adjust gesture and therefore the one every
  // existing user of this app already knows; it composes with the off-axis
  // ramp rather than fighting it.
  sensitivity.value = Math.min(dragSensitivity(e.clientY - startY), e.shiftKey ? 0.25 : 1);
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  // Clamped as it accumulates, so dragging past an end and coming back moves
  // the fader immediately instead of first repaying the overshoot.
  accPos = clampPos(accPos + (dx / railWidth) * sensitivity.value);
  apply(accPos);
}

function endDrag(e?: PointerEvent) {
  if (e && activePointer !== null && e.pointerId !== activePointer) return;
  // pointercancel means the browser took the gesture away from us — it decided
  // this was a scroll. Anything we already moved was not something the operator
  // asked for, so put the level back where it was and tell the desk.
  if (e?.type === 'pointercancel' && armed && pos.value !== posBeforeDrag) {
    apply(posBeforeDrag);
  }
  dragging.value = false;
  armed = false;
  activePointer = null;
  sensitivity.value = 1;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
}

onUnmounted(() => {
  endDrag();
  stopRepeat();
});

// ---- ± buttons, with hold-to-repeat ---------------------------------------
let repeatTimer: ReturnType<typeof setTimeout> | null = null;
let repeatCount = 0;
let repeatBtn: HTMLElement | null = null;
let posBeforeRepeat = 0;

function startRepeat(e: PointerEvent, deltaDb: number) {
  if (props.disabled) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();               // no synthetic click, no focus ring flash
  // Tear down any previous press BEFORE claiming this one: stopRepeat() clears
  // repeatBtn, so assigning it first left repeatDrift looking at null and the
  // slide-off check silently dead.
  stopRepeat();
  repeatBtn = e.currentTarget as HTMLElement | null;
  try { repeatBtn?.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
  repeatCount = 0;
  posBeforeRepeat = pos.value;
  step(deltaDb);
  const tick = () => {
    repeatCount++;
    // Accelerate: a hold that starts as nudges becomes a sweep, so pulling a
    // channel down 40 dB does not need 80 taps.
    step(deltaDb * (repeatCount > 14 ? 4 : repeatCount > 6 ? 2 : 1));
    repeatTimer = setTimeout(tick, 80);
  };
  repeatTimer = setTimeout(tick, 420);
  // Explicit add/remove pairs. `{ once: true }` would consume only whichever of
  // these fired and leave the others bound to window for the rest of the
  // session — one leak per button press, all show long.
  window.addEventListener('pointerup', stopRepeat);
  window.addEventListener('pointercancel', cancelRepeat);
  window.addEventListener('pointermove', repeatDrift);
}

// Sliding off the button stops the repeat, the way every press-and-hold does.
// setPointerCapture keeps routing the events here, so leaving has to be checked
// rather than waited for.
function repeatDrift(e: PointerEvent) {
  if (!repeatBtn) return;
  const r = repeatBtn.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
    stopRepeat();
  }
}

// The browser reclaimed the gesture — it was a scroll, not a press. If the only
// thing that had happened was the immediate first step, undo it.
function cancelRepeat() {
  const undo = repeatCount === 0 && pos.value !== posBeforeRepeat;
  const target = posBeforeRepeat;
  stopRepeat();
  if (undo) apply(target);
}

function stopRepeat() {
  if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
  repeatBtn = null;
  window.removeEventListener('pointerup', stopRepeat);
  window.removeEventListener('pointercancel', cancelRepeat);
  window.removeEventListener('pointermove', repeatDrift);
}

// preventDefault() on pointerdown also kills the synthetic click, so a keyboard
// user pressing Enter/Space on a ± button would otherwise get nothing at all.
function onStepKeydown(e: KeyboardEvent, deltaDb: number) {
  if (props.disabled) return;
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  e.preventDefault();
  step(deltaDb);
}

function step(deltaDb: number) {
  apply(stepPosByDb(pos.value, deltaDb));
}

// ---- Keyboard & wheel ------------------------------------------------------
function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return;
  const fine = e.shiftKey ? 0.2 : 1;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowUp':   step(STEP_DB * fine); break;
    case 'ArrowLeft':  case 'ArrowDown': step(-STEP_DB * fine); break;
    case 'PageUp':   step(PAGE_DB); break;
    case 'PageDown': step(-PAGE_DB); break;
    case 'Home': apply(0); break;
    case 'End':  apply(1); break;
    default: return;
  }
  e.preventDefault();
  e.stopPropagation();   // never let a fader key reach the global cue hotkeys
}

// The track is over half of every row, so an unconditional wheel handler would
// mean the mouse wheel changes live levels instead of scrolling the channel
// list — with no way to scroll past channel 3. Requiring focus first makes the
// wheel a deliberate act on a chosen strip, and leaves plain scrolling alone.
function onWheel(e: WheelEvent) {
  if (props.disabled) return;
  if (document.activeElement !== trackRef.value) return;
  e.preventDefault();
  step((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : STEP_DB));
}

// ---- Rename the strip ------------------------------------------------------
const namingEdit = ref(false);
const nameValue = ref('');
const nameRef = ref<HTMLInputElement | null>(null);

// Renaming is an edit affordance, and this app's rule is that those disappear
// once the show has started — a keyboard sliding up over the channel levels is
// the last thing anyone needs then. Riding the faders themselves stays live;
// that IS the job in Show Mode.
const { uiMode } = useUiMode();
const canRename = computed(() => uiMode.value !== 'playback');

function startNaming() {
  if (!canRename.value) return;
  nameValue.value = customName.value;
  namingEdit.value = true;
  nextTick(() => { nameRef.value?.focus(); nameRef.value?.select(); });
}

function commitName() {
  if (!namingEdit.value) return;
  namingEdit.value = false;
  if (nameValue.value.trim() === customName.value) return;   // no save, no dirty flag
  setName(props.strip, nameValue.value);
}

// ---- Type an exact value ---------------------------------------------------
const editing = ref(false);
const editValue = ref('');
const editRef = ref<HTMLInputElement | null>(null);

function startEdit() {
  if (props.disabled) return;
  editValue.value = Number.isFinite(db.value) ? (Math.round(db.value * 10) / 10).toString() : '-90';
  editing.value = true;
  nextTick(() => { editRef.value?.focus(); editRef.value?.select(); });
}

function commitEdit() {
  if (!editing.value) return;
  editing.value = false;
  // A German keyboard types "-12,5". Rejecting that would be a bug, not a rule.
  const raw = editValue.value.trim().replace(',', '.').replace('−', '-');
  // An EMPTY field means "never mind", not 0 dB. Number('') is 0, so without
  // this line clearing the box and hitting Enter slams a channel sitting at
  // −40 dB up to unity.
  if (raw === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  apply(x18DbToPos(value));
}
</script>

<style scoped>
/* Sized for a thumb first: the row is 44px of grab area even before the phone
   media query bumps it, so a tablet or a touchscreen laptop is usable too. */
.x18-strip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
.x18-strip--dragging {
  border-color: var(--color-accent);
}

.x18-strip__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.x18-strip__name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 4px 6px 4px 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  color: var(--color-text-primary);
  touch-action: manipulation;
}
/* Show Mode: still the channel's name, just not a control. */
.x18-strip__name:disabled { cursor: default; opacity: 1; }
.x18-strip__tag,
.x18-strip__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Unnamed: the desk label IS the name. Named: it demotes to a small mono tag
   that still lets the operator find the strip on the physical console. */
.x18-strip__tag {
  flex: none;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.02em;
}
.x18-strip__name--tagged .x18-strip__tag {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
.x18-strip__label {
  font-weight: 600;
  font-size: 14px;
  min-width: 0;
}
.x18-strip__name-input {
  flex: 1;
  min-width: 0;
  font-size: max(14px, var(--lp-input-fs-min));
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  color: var(--color-text-primary);
  outline: none;
}
.x18-strip__warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-size: 12px;
  font-weight: 600;
  /* Danger, not caution: --color-warning is what the over-unity fill uses, and
     "you are boosting" and "the desk never heard you" must not look alike. */
  color: #e53e3e;   /* the danger red X18View's own delete/error text uses */
}
.x18-strip__warn .material-symbols-rounded { font-size: 16px; }

.x18-strip__value,
.x18-strip__value-input {
  flex: none;
  font-family: var(--font-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 15px;
  font-weight: 600;
  min-width: 76px;
  text-align: right;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.15);
  border: 1px solid transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  /* No double-tap zoom and no long-press callout on the one control an operator
     jabs at repeatedly. */
  touch-action: manipulation;
  -webkit-touch-callout: none;
  user-select: none;
  /* A signed number inside an RTL paragraph renders its sign on the wrong side
     ("12.5−", "∞−") because U+2212 is a bidi ES character. */
  direction: ltr;
  unicode-bidi: isolate;
}
.x18-strip__value small { font-size: 10px; color: var(--color-text-secondary); margin-left: 3px; }
.x18-strip__value:disabled { cursor: default; opacity: 0.5; }
/* An untouched strip is a guess, not a reading — say so visually rather than
   letting the number pass for the desk's actual level. */
.x18-strip--unsent .x18-strip__value { color: var(--color-text-secondary); font-style: italic; }
/* The number is the quiet part of "we do not know this level" — the thumb is
   the loud one. Hollow it out so an untouched strip cannot be misread as a
   reading off the desk at a glance. */
.x18-strip--unsent .x18-strip__thumb {
  background: var(--color-surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4), inset 0 0 0 3px var(--color-accent);
}

.x18-strip__value-input {
  cursor: text;
  border-color: var(--color-accent);
  background: var(--color-surface);
  outline: none;
  user-select: text;
  /* 16px is iOS's focus-zoom floor, and --lp-input-fs-min only reaches 16 inside
     the compact query — an iPad in landscape matches none of its arms, so a 15px
     floor here would zoom the whole mixer on focus, mid-show. */
  font-size: max(16px, var(--lp-input-fs-min));
}

.x18-strip__row {
  display: flex;
  align-items: center;
  gap: 8px;
  /* The app flips to dir="rtl" for ar/fa/ur. The rail is positioned with
     physical `left` and the drag adds a physical dx, so the fader's geometry is
     LTR by construction — and the ± buttons have to stay on the same sides as
     the ends they move towards, or "quieter" ends up at the loud end. A level
     fader is left-quiet/right-loud in every locale. */
  direction: ltr;
}

.x18-strip__step {
  flex: none;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-text-primary);
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
}
.x18-strip__step:disabled { opacity: 0.4; cursor: default; }
.x18-strip__step .material-symbols-rounded { font-size: 22px; }
.x18-strip__step:active:not(:disabled) { background: var(--color-surface-hover); }

.x18-strip__track {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 14px;              /* room for the thumb to overhang the rail */
  cursor: pointer;
  user-select: none;
  /* The one line that makes the list scrollable AND the fader draggable: the
     browser keeps vertical panning, we get everything horizontal. */
  touch-action: pan-y;
}
/* Focus is not decoration here: a focused fader is the one the arrow keys and
   the mouse wheel act on, and the wheel gate (onWheel) reads exactly this
   state. `:focus`, not `:focus-visible` — the fader takes focus on pointerdown
   too, and an operator who cannot see which strip is armed will eventually
   scroll one by accident. */
.x18-strip__track:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 8px;
}
.x18-strip__track[aria-disabled='true'] { cursor: default; opacity: 0.45; }

.x18-strip__rail {
  position: relative;
  width: 100%;
  height: 10px;
  border-radius: 5px;
  /* The unfilled groove is the page background, not --color-border: the accent
     fill against border is 1.56:1 in the dark theme, and the fill/rail boundary
     is what tells the operator where the fader is. */
  background: var(--color-background);
  box-shadow: inset 0 0 0 1px var(--color-border);
  overflow: visible;
}
.x18-strip__fill,
.x18-strip__over {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 5px;
}
.x18-strip__fill {
  left: 0;
  background: var(--color-accent);
  transition: width 0.08s linear;
}
.x18-strip__over {
  background: var(--color-warning);
  transition: width 0.08s linear, left 0.08s linear;
}
.x18-strip--dragging .x18-strip__fill,
.x18-strip--dragging .x18-strip__over,
.x18-strip--dragging .x18-strip__thumb { transition: none; }

.x18-strip__tick {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: var(--color-text-secondary);
  opacity: 0.4;
  border-radius: 1px;
  pointer-events: none;
}
/* Unity is not one landmark among five — it is the reference the whole desk is
   set against, and at 2px/65%-secondary it was invisible on a dimmed screen. */
.x18-strip__tick--unity {
  top: -6px;
  bottom: -6px;
  width: 3px;
  margin-left: -1.5px;
  background: var(--color-text-primary);
  opacity: 0.9;
}

.x18-strip__thumb {
  position: absolute;
  top: 50%;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: var(--color-accent);
  border: 2px solid var(--color-surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  transition: left 0.08s linear;
  pointer-events: none;
}
.x18-strip--dragging .x18-strip__thumb { transform: scale(1.12); }

.x18-strip__fine {
  position: absolute;
  right: 0;
  top: -2px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--color-accent);
  pointer-events: none;
}

/* Sizes follow the INPUT DEVICE, not the window: a 1366px iPad in landscape
   matches no arm of the compact query but is still a finger. */
@media (any-pointer: coarse) {
  .x18-strip__step { width: 44px; height: 44px; }
  .x18-strip__step .material-symbols-rounded { font-size: 24px; }
  .x18-strip__track { height: 56px; padding: 0 16px; }
  .x18-strip__rail { height: 12px; border-radius: 6px; }
  .x18-strip__thumb { width: 30px; height: 30px; margin: -15px 0 0 -15px; }
  .x18-strip__name { min-height: 40px; align-items: center; }
  .x18-strip__value,
  .x18-strip__value-input { min-height: 40px; }
}

@media (any-hover: hover) and (any-pointer: fine) {
  .x18-strip__step:hover:not(:disabled) { background: var(--color-surface-hover); }
  .x18-strip__value:hover:not(:disabled) { background: rgba(128, 128, 128, 0.28); }
}

/* ---- Phone: everything grows to the touch scale ------------------------- */
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .x18-strip {
    gap: 4px;
    padding: 8px 12px 10px;
  }
  .x18-strip__tag { font-size: 17px; }
  .x18-strip__name--tagged .x18-strip__tag { font-size: 12px; }
  .x18-strip__label { font-size: 17px; }
  .x18-strip__name-input {
    font-size: max(16px, var(--lp-input-fs-min));
    min-height: var(--lp-tap-sm);
  }
  .x18-strip__value,
  .x18-strip__value-input {
    font-size: max(16px, var(--lp-input-fs-min));
    min-height: var(--lp-tap-sm);
    min-width: 92px;
    padding: 6px 10px;
  }
  .x18-strip__fine { font-size: 12px; top: 0; }
}

/* ---- Phone in landscape: fold the strip onto one line ------------------- */
/* Portrait trades height for a long fader; landscape has none to trade. The two
   wrappers become `display: contents` so name, readout, ± buttons and track are
   all direct flex children of one ~54px line — and they lay out in DOM order,
   with no `order` anywhere, so the tab order still follows the eye. The fader
   keeps ~700px of travel. */
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .x18-strip {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
  }
  .x18-strip__head,
  .x18-strip__row { display: contents; }
  .x18-strip__name,
  .x18-strip__name-input { flex: 0 0 118px; min-height: 0; }
  .x18-strip__name { flex-direction: column; align-items: flex-start; gap: 0; padding: 0; }
  .x18-strip__tag { font-size: 15px; }
  .x18-strip__name--tagged .x18-strip__tag { font-size: 10px; line-height: 1.1; }
  .x18-strip__label { font-size: 14px; line-height: 1.2; }
  .x18-strip__value,
  .x18-strip__value-input { flex: 0 0 auto; min-width: 84px; }
  .x18-strip__track { flex: 1; height: 44px; }
  .x18-strip__step { width: 40px; height: 40px; }
  .x18-strip__fine { top: auto; bottom: -1px; right: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  .x18-strip__fill,
  .x18-strip__over,
  .x18-strip__thumb { transition: none; }
}
</style>
