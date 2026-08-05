<template>
  <div 
    class="active-cue-item" 
    :class="{
      'warning-yellow': warningState === 'yellow',
      'warning-orange': warningState === 'orange',
      'warning-red': warningState === 'red'
    }"
    :style="itemStyle"
  >
    <div class="cue-content">
      <div class="cue-header">
        <span class="cue-name">{{ cue.displayName }}</span>
        <div class="cue-actions">
          <button 
            v-if="!cue.isPaused" 
            class="action-btn pause-btn" 
            @click="handlePause" 
            :title="t('actions.pause')"
          >
            <span class="material-symbols-rounded">pause</span>
          </button>
          <button 
            v-if="cue.isPaused" 
            class="action-btn resume-btn" 
            @click="handleResume" 
            :title="t('actions.resume')"
          >
            <span class="material-symbols-rounded">play_arrow</span>
          </button>
          <button class="action-btn stop-btn" @click="handleStop" :title="t('actions.stop')">
            <span class="material-symbols-rounded">stop</span>
          </button>
        </div>
      </div>
      
      <div class="cue-progress">
        <div class="time-info">
          <span>{{ formatTime(cue.currentTime) }}</span>
          <span>-{{ formatTime(cue.duration - cue.currentTime) }}</span>
        </div>

        <!-- The hit wrapper is what makes a 14px bar a 44px target without
             drawing a 44px bar. On touch the seek is only committed on release
             and only after real travel, so a stray tap can no longer jump a
             live cue on the PA. -->
        <div
          class="seek-hit"
          @pointerdown="onSeekDown"
          @pointermove="onSeekMove"
          @pointerup="onSeekUp"
          @pointercancel="onSeekUp"
        >
          <div class="progress-bar">
            <div class="progress-fill" :style="scrubPct !== null ? { width: scrubPct + '%' } : progressStyle"></div>
            <div
              class="progress-handle"
              :style="{
                left: `${scrubPct ?? progress}%`,
                borderColor: cue.color || 'var(--color-accent)'
              }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Per-cue level. Costs 6px of height rather than the 77px of width the
           StereoMeter took from the cue name, so it survives at every phone
           width — and with two cues running it is the only thing that says
           which card is actually making sound. -->
      <LiveMeterBar
        v-if="isCompact"
        class="lp-cue-meter"
        source="cue"
        :cue-id="serverCueId"
        :min-db="-60"
        :max-db="0"
      />
    </div>
    
    <!-- VU Meter — drawn from the server's live meter stream so it tracks
         what the audio engine is actually outputting, not a waveform-based
         estimate. Stereo widget shows L/R per source channel. -->
    <div class="cue-meter">
      <StereoMeter
        :cue-id="serverCueId"
        :min-db="-60"
        :max-db="0"
      />
    </div>

    <!-- End-of-cue warning border. Inset overlay so the thick border stays
         inside the item box and is never clipped by the active-cue strip's
         overflow: hidden. -->
    <div
      v-if="warningState"
      class="warning-border"
      :class="`warning-border--${warningState}`"
    ></div>
  </div>
</template>

<script setup lang="ts">
import LiveMeterBar from './LiveMeterBar.vue';
import { useCompactLayout } from '~/composables/useCompactLayout';

// Projection of the server's view of an active cue. Owned by useAudioEngine
// which rebuilds it from cue_state / playback_snapshot / meters broadcasts.
// No client-side playback state lives here.
interface ActiveCueState {
  uuid: string;
  displayName: string;
  duration: number;
  currentTime: number;
  isPaused: boolean;
  color?: string;
  inPoint?: number;
  outPoint?: number;
  serverCueId?: string | null;
}

const props = defineProps<{
  cue: ActiveCueState;
}>();

const { stopCue, pauseCue, resumeCue, seekCue } = useAudioEngine();
const { t } = useLocalization();
// isCompact gates layout (the inline meter). isCoarse gates the SCRUB
// SEMANTICS, because a seek is audible on the PA — that must follow the input
// device, never the window width.
const { isCompact, isCoarse } = useCompactLayout();

// Server engine cue ID — populated in onload once the server registers the
// cue and returns its ID. Used by StereoMeter to subscribe to the right
// WS meter frame.
const serverCueId = computed<string | null>(() => props.cue.serverCueId ?? null);

// Use the cue's currentTime directly (updated by the audio engine)
const progress = computed(() => {
  if (!props.cue.duration || props.cue.duration === 0) return 0;
  return (props.cue.currentTime / props.cue.duration) * 100;
});

// Warning state based on time remaining
// Note: This is per-cue visual feedback only
// The ProjectHeader handles the actual silence detection across all cues
const warningState = computed(() => {
  const timeRemaining = props.cue.duration - props.cue.currentTime;
  if (timeRemaining <= 5) return 'red';
  if (timeRemaining <= 10) return 'orange';
  if (timeRemaining <= 30) return 'yellow';
  return null;
});

// Helper to convert hex to rgba
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Use item color for background if available
const itemStyle = computed(() => {
  if (props.cue.color) {
    return {
      backgroundColor: hexToRgba(props.cue.color, 0.15),
      borderColor: props.cue.color
    };
  }
  return {};
});

// Use item color for progress if available
const progressStyle = computed(() => {
  const width = `${progress.value}%`;
  if (props.cue.color) {
    return {
      width,
      backgroundColor: props.cue.color
    };
  }
  return { width };
});

const handleStop = () => {
  stopCue(props.cue.uuid);
};

const handlePause = () => {
  pauseCue(props.cue.uuid);
};

const handleResume = () => {
  resumeCue(props.cue.uuid);
};

// ---- Seek / scrub ---------------------------------------------------------
// Desktop keeps today's behaviour exactly: a click seeks immediately on press.
// Touch gets a real scrub instead — the position follows the finger and is only
// committed on release, and only once the finger has actually travelled. A
// stationary tap therefore does nothing, which removes the entire class of
// "brushed the progress bar and jumped a live cue" mistakes.
const scrubPct = ref<number | null>(null);
let scrubStartX = 0;
let scrubMoved = false;

const commitSeek = (clientX: number, el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  const percent = (clientX - rect.left) / rect.width;
  // Trimmed → absolute file time.
  const absoluteSeekTime = percent * props.cue.duration + (props.cue.inPoint || 0);
  seekCue(props.cue.uuid, absoluteSeekTime);
};

function onSeekDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  scrubStartX = e.clientX;
  scrubMoved = false;
  if (!isCoarse.value) commitSeek(e.clientX, el);
}

function onSeekMove(e: PointerEvent) {
  if (scrubPct.value === null && !scrubMoved) {
    // Travel gate: ignore the jitter of a finger landing on the bar.
    if (Math.abs(e.clientX - scrubStartX) < 6) return;
    scrubMoved = true;
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  scrubPct.value = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
}

function onSeekUp(e: PointerEvent) {
  if (scrubPct.value !== null) {
    const t = (scrubPct.value / 100) * props.cue.duration + (props.cue.inPoint || 0);
    seekCue(props.cue.uuid, t);
  }
  scrubPct.value = null;
  scrubMoved = false;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
</script>

<style scoped lang="scss">
.active-cue-item {
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-sm) var(--spacing-md);
  transition: all var(--transition-fast);
  min-width: 400px;
  max-width: 400px;
  display: flex;
  gap: var(--spacing-sm);
  position: relative;
}

/* Solid 4px end-of-cue warning border. Inset overlay pinned inside the item
   box so it cannot be clipped by the active-cue strip's overflow. */
.warning-border {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  border: 4px solid transparent;
  border-radius: var(--border-radius-md);

  /* Blink rates mirror the ProjectHeader silence-warning banner so the border
     and banner pulse in sync (yellow ≤30s, orange ≤10s, red ≤5s). */
  &.warning-border--yellow {
    border-color: rgb(255, 193, 7);
    animation: warning-border-flash 2s ease-in-out infinite;
  }

  &.warning-border--orange {
    border-color: rgb(255, 152, 0);
    animation: warning-border-flash 1s ease-in-out infinite;
  }

  &.warning-border--red {
    border-color: rgb(244, 67, 54);
    animation: warning-border-flash 0.5s ease-in-out infinite;
  }
}

@keyframes warning-border-flash {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}

.cue-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.cue-meter {
  display: flex;
  align-items: stretch;
  padding-left: var(--spacing-sm);
  border-left: 1px solid var(--color-border);
}

.cue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.cue-actions {
  display: flex;
  gap: 4px;
}

.cue-name {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  position: relative;
  
  /* Nice fade-out effect with gradient mask */
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  
  /* Gradient fade at the end */
  mask-image: linear-gradient(to right, black 80%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
}

.action-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: white;
  font-size: 20px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &.pause-btn, &.resume-btn {
    background-color: #ff9800; /* Orange color for pause/resume */
  }
  
  &.stop-btn {
    background-color: var(--color-danger);
  }

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      opacity: 0.8;
    }
  }
}

/* Hit wrapper for the seek bar. Zero extra geometry at base — the padding that
   turns it into a 44px target is added only inside the compact query. */
.seek-hit {
  padding-block: 0;
}

.cue-progress {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.time-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.progress-bar {
  height: 8px;
  background-color: var(--color-surface);
  border-radius: var(--border-radius-sm);
  position: relative;
  cursor: pointer;
  /* Force LTR direction for progress bars in RTL languages */
  direction: ltr;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      .progress-handle {
        opacity: 1;
      }
    }
  }
}

.progress-fill {
  height: 100%;
  background-color: var(--color-accent);
  border-radius: var(--border-radius-sm);
  transition: width 100ms linear;
}

.progress-handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 16px;
  height: 16px;
  background-color: white;
  border: 2px solid var(--color-accent);
  border-radius: 50%;
  opacity: 0;
  transition: opacity var(--transition-fast);
  pointer-events: none;
}

/* Phones: the card owns the full row width and stacks in a column, so it never
   competes with a sibling card for space. */
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .active-cue-item {
    min-width: 0;
    max-width: 100%;
    width: 100%;
    /* The load-bearing declaration. Cards used to be flex children of a row
       that let them shrink, so two running cues divided the width between them
       and the name — the only shrinkable element left — went to 0px. Pinning
       the basis means 2+ cues SCROLL as full-size cards instead. */
    flex: 0 0 auto;
    padding: var(--spacing-xs) var(--spacing-sm);
    gap: var(--spacing-sm);
  }

  /* The gradient mask faded the last 20% of the name ON TOP of the ellipsis, so
     a truncated name lost two signals' worth of characters and it was
     impossible to tell truncation from fade. Ellipsis alone is the honest one. */
  .cue-name {
    mask-image: none;
    -webkit-mask-image: none;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.25;
  }

  .cue-header {
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
  }

  /* Stop is the largest target in the card, pinned to the far edge where a
     thumb naturally lands, with 24px of dead space before Pause. Stopping a cue
     you meant to pause is audible; the geometry now makes that mis-tap hard. */
  .cue-actions {
    flex-shrink: 0;
    gap: var(--lp-sep);
  }

  .action-btn {
    width: var(--lp-tap);
    height: var(--lp-tap);
    flex-shrink: 0;
    font-size: 26px;
  }

  .stop-btn {
    width: var(--lp-tap-lg);
    height: var(--lp-tap-lg);
    margin-left: auto;
    font-size: 34px;
  }

  /* 14px bar + 2×15px padding = a 44px target that still looks like a 14px bar. */
  .seek-hit {
    padding-block: 15px;
    touch-action: none;
  }

  .progress-bar {
    height: 14px;
  }

  /* The handle is a visual playhead marker, never the target — .seek-hit is.
     On desktop it only appears on :hover, which touch never fires, so a phone
     had no playhead indication at all. */
  .progress-handle {
    opacity: 1;
    width: 28px;
    height: 28px;
  }

  /* The vertical StereoMeter took 77px of a ~330px row from the cue name. The
     inline LiveMeterBar replaces it for 6px of height. */
  .cue-meter {
    display: none;
  }

  .lp-cue-meter {
    height: 6px;
    margin-top: 4px;
  }
}
</style>
