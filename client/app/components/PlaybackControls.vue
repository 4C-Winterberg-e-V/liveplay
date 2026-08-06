<template>
  <div class="playback-controls" :class="{ 'show-mode': showMode }">
    <!-- Desktop: transport lives here. On phones it moves into the title bar
         (ProjectHeader) so the active-cue list gets the full width. The
         Play-Next + Panic buttons upstream inlines here live inside
         TransportButtons, which is why both hosts can render them. -->
    <TransportButtons class="controls-left" />

    <div class="active-cues lp-scroll-fade">
      <!-- Idle. The bar keeps a fixed height at every moment so it can never
           move the playlist under a descending thumb; on a phone that reserved
           space carries the next cue instead of the words "No active cues".
           One wrapper, so the v-else below still pairs with the idle test. -->
      <template v-if="activeCues.size === 0 && !previewingItem">
        <div v-if="isCompact" class="lp-upnext">
          <span class="lp-upnext__pill">{{ t('status.upNext') }}</span>
          <span class="lp-upnext__name">{{ nextItem?.displayName ?? '—' }}</span>
        </div>
        <div v-else class="no-cues">
          {{ t('playback.noActiveCues') }}
        </div>
      </template>

      <div v-else class="cue-list">
        <!-- Preview card: styled identically to ActiveCueItem, with a green
             "Preview" pill at the start of the name. Meter reads master
             channels 30/31 (the preview output bus). Seek + time come from
             the per-cue meter stream (playhead_seconds). -->
        <div v-if="previewingItem" class="preview-cue-card">
          <div class="preview-cue-content">
            <div class="preview-cue-header">
              <span class="preview-cue-name">
                <span class="preview-status-pill">{{ t('status.previewing') }}</span>
                {{ previewingItem.displayName }}
              </span>
              <div class="preview-cue-actions">
                <button class="preview-stop-btn" @click="stopPreview" :title="t('actions.stopPreview')">
                  <span class="material-symbols-rounded">stop</span>
                </button>
              </div>
            </div>

            <div class="preview-cue-progress">
              <div class="preview-time-info">
                <span>{{ formatPreviewTime(previewCurrentTime) }}</span>
                <span>-{{ formatPreviewTime(previewDuration - previewCurrentTime) }}</span>
              </div>
              <div
                class="preview-progress-bar seek-hit"
                @pointerdown="onPreviewSeekDown"
                @pointermove="onPreviewSeekMove"
                @pointerup="onPreviewSeekUp"
                @pointercancel="onPreviewSeekUp"
              >
                <div class="preview-progress-fill" :style="{ width: (previewScrubPct ?? previewProgressPct) + '%' }"></div>
                <div class="preview-progress-handle" :style="{ left: (previewScrubPct ?? previewProgressPct) + '%' }"></div>
              </div>
            </div>
          </div>
          <div class="preview-cue-meter">
            <StereoMeter :left-index="30" :right-index="31" :min-db="-60" :max-db="0" />
          </div>
        </div>

        <ActiveCueItem
          v-for="[uuid, cue] in Array.from(activeCues.entries())"
          :key="uuid"
          :cue="cue"
        />
      </div>
    </div>
    
    <!-- Per-output meters — one StereoMeter + volume fader per active audio output pair.
         Main output (masters 0/1) is always shown. Preview (30/31) and
         device-override pairs (2+) appear when they carry signal. -->
    <div class="output-meters">
      <div v-for="pair in outputPairs" :key="pair.key" class="output-pair">
        <StereoMeter
          :left-index="pair.leftIndex"
          :right-index="pair.rightIndex"
          :label="pair.label"
          :show-peak-value="true"
        />
        <VolumeSlider
          :db="getOutputGainDb(pair.leftIndex)"
          :min-db="-60"
          :max-db="40"
          :title="pair.label"
          @input="(db: number) => onOutputGainInput(pair.leftIndex, pair.rightIndex, db)"
          @reset="resetOutputGain(pair.leftIndex, pair.rightIndex)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// PlaybackControls migration (Milestone 5):
//   * Panic / stop-all now fans out to BOTH the legacy useAudioEngine
//     (until every component is migrated away from it) AND the new C++
//     server via useLiveplayServer().stopAll(). Removing the legacy call
//     is safe once all play paths route through the server.
//   * The master mix meter is rendered by <LiveMeterBar source="master"
//     :index="0" />, which consumes the live WebSocket meter stream from
//     the engine — replacing the static-waveform "cheat" levels.
import { formatKeyLabel } from '~/composables/useCartHotkeys';
import type { AudioItem } from '~/types/project';
import { useLiveplayServer } from '~/composables/useLiveplayServer';
import { useCueMeters } from '~/composables/useLiveMeters';
import VolumeSlider from './VolumeSlider.vue';
import TransportButtons from './TransportButtons.vue';
import { useCompactLayout } from '~/composables/useCompactLayout';

const { activeCues, panicStop, nextItemOverrideUuid, autoNextItemUuid, setNextItem, playCue, triggerGroup } = useAudioEngine();
const { findItemByUuid, previewItemUuid, previewCueId, stopPreview, currentProject } = useProject();
const { playbackMappings } = useCartHotkeys();
const { t } = useLocalization();
const server = useLiveplayServer();
const { uiMode } = useUiMode();
// Show Mode enlarges the GO / Stop-All buttons for touch; the active-cue cards
// and meters are already the right size and stay as-is.
const showMode = computed(() => uiMode.value === 'playback');

// isCompact: layout (which idle row renders). isCoarse: scrub semantics, because
// a preview seek is audible on the headphone bus.
const { isCompact, isCoarse } = useCompactLayout();

// ---- Preview seek / time --------------------------------------------------
// Subscribe to the preview cue's per-item meter stream so we can display an
// accurate playhead, elapsed time, and remaining time in the preview card.
const previewMeter = useCueMeters(() => previewCueId.value || null);
const previewCurrentTime = computed(() => previewMeter.playhead.value);
const previewDuration = computed(() => {
  if (!previewingItem.value) return 0;
  const item = previewingItem.value as any;
  const inPoint  = item.inPoint  ?? 0;
  const outPoint = item.outPoint ?? item.duration ?? 0;
  return Math.max(0, outPoint - inPoint);
});
const previewProgressPct = computed(() => {
  if (!previewDuration.value) return 0;
  return Math.min(100, (previewCurrentTime.value / previewDuration.value) * 100);
});

function formatPreviewTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// Same deferred-commit scrub as ActiveCueItem: desktop seeks on press exactly as
// before, touch follows the finger and only commits on release after real
// travel, so a stray tap cannot jump the preview.
const previewScrubPct = ref<number | null>(null);
// See ActiveCueItem: `pointermove` also fires on buttonless mouse hover, so the
// scrub must be scoped to the pointer that actually pressed the bar.
let previewScrubPointerId: number | null = null;
let previewScrubStartX = 0;
let previewScrubMoved = false;

function commitPreviewSeek(clientX: number, el: HTMLElement) {
  if (!previewCueId.value || !previewDuration.value) return;
  const rect = el.getBoundingClientRect();
  const pct = (clientX - rect.left) / rect.width;
  const seekTo = pct * previewDuration.value;
  const item = previewingItem.value as any;
  const inPoint = item?.inPoint ?? 0;
  server.seekCueId(previewCueId.value, Math.max(0, seekTo + inPoint));
}

function onPreviewSeekDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  // Fine pointer: seek on press, enter no scrub state, so a drag cannot fire a
  // second seek on release.
  if (!isCoarse.value) { commitPreviewSeek(e.clientX, el); return; }
  try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  previewScrubPointerId = e.pointerId;
  previewScrubStartX = e.clientX;
  previewScrubMoved = false;
}

function onPreviewSeekMove(e: PointerEvent) {
  if (previewScrubPointerId !== e.pointerId) return;
  if (previewScrubPct.value === null && !previewScrubMoved) {
    if (Math.abs(e.clientX - previewScrubStartX) < 6) return;
    previewScrubMoved = true;
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  previewScrubPct.value = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
}

function onPreviewSeekUp(e: PointerEvent) {
  if (previewScrubPointerId !== e.pointerId) return;
  previewScrubPointerId = null;
  if (previewScrubPct.value !== null && previewDuration.value) {
    const item = previewingItem.value as any;
    const inPoint = item?.inPoint ?? 0;
    const seekTo = (previewScrubPct.value / 100) * previewDuration.value;
    if (previewCueId.value) server.seekCueId(previewCueId.value, Math.max(0, seekTo + inPoint));
  }
  previewScrubPct.value = null;
  previewScrubMoved = false;
}

// Dynamic per-output meters. Main (0/1) is always shown. Preview (30/31)
// and per-device overrides (2+) appear only when they carry signal so we
// don't flood the UI with silent meters.
const outputPairs = computed(() => {
  const m = server.meters;
  const activeIdx = new Set((m?.master_channels ?? []).map((mc: any) => mc.index as number));

  const configuredId = (currentProject.value as any)?.settings?.defaultOutputDevice;
  const mainLabel = configuredId
    ? (server.devices.find((d: any) => d.id === configuredId)?.display_name ?? 'Main')
    : (server.devices.find((d: any) => d.is_default)?.display_name ?? 'Main');
  const pairs: Array<{ key: string; leftIndex: number; rightIndex: number; label: string }> = [];

  // Per-device override pairs (allocated at 2+, step 2). When a project selects
  // a specific default output device the server routes the program onto one of
  // these override buses (masters 0/1 stay silent), so we must NOT unconditionally
  // show a "Main" 0/1 strip — that produced a permanent duplicated, signal-less
  // "Main" strip alongside the real one.
  const overridePairs: Array<{ key: string; leftIndex: number; rightIndex: number; label: string }> = [];
  for (let i = 2; i < 30; i += 2) {
    if (activeIdx.has(i) || activeIdx.has(i + 1)) {
      overridePairs.push({ key: `out-${i}`, leftIndex: i, rightIndex: i + 1, label: `Out ${i / 2}` });
    }
  }

  const mainActive = activeIdx.has(0) || activeIdx.has(1);
  // Show the 0/1 "Main" strip only when it actually carries signal, or when
  // there is no override bus to represent the main output (so at least one
  // output strip is always visible). When the program has moved onto the
  // project's default-device override bus, relabel that first override pair
  // with the configured device name instead of a bare "Out N".
  if (mainActive || overridePairs.length === 0) {
    pairs.push({ key: 'main', leftIndex: 0, rightIndex: 1, label: mainLabel });
  } else if (overridePairs.length > 0) {
    overridePairs[0]!.label = mainLabel;
  }
  pairs.push(...overridePairs);

  // Preview output (master 30/31) — only when active
  if (activeIdx.has(30) || activeIdx.has(31)) {
    pairs.push({ key: 'preview-out', leftIndex: 30, rightIndex: 31, label: 'Preview' });
  }

  return pairs;
});

// Preview pill data: when an item is being pre-listened on the headphone bus,
// this resolves to the item record so we can render its display name.
const previewingItem = computed(() => {
  const uuid = previewItemUuid.value;
  if (!uuid) return null;
  return findItemByUuid(uuid);
});

const effectiveNextUuid = computed(() => nextItemOverrideUuid.value ?? autoNextItemUuid.value);

// What the phone shows in the reserved bar height while nothing is playing.
const nextItem = computed(() => {
  const u = effectiveNextUuid.value;
  return u ? findItemByUuid(u) : null;
});

const playNextTooltip = computed(() => {
  const binding = playbackMappings.value['play-next'];
  const shortcut = binding ? formatKeyLabel(binding) : '';
  return shortcut ? `${t('controls.playNext')} (${shortcut})` : t('controls.playNext');
});

const stopAllTooltip = computed(() => {
  const binding = playbackMappings.value['stop-all'];
  const shortcut = binding ? formatKeyLabel(binding) : '';
  return shortcut ? `${t('playback.panic')} (${shortcut})` : t('playback.panic');
});

const handlePanic = () => {
  // Stop everything, fading over the project-wide Stop All time
  // (settings.stopAllFadeMs, default 1 s; set to 0 for an instant panic).
  // panicStop() forwards to the server with no explicit fade so the server
  // applies that project setting.
  panicStop();
};

// ---- Per-output gain faders -----------------------------------------------
function getOutputGainDb(leftIndex: number): number {
  return server.outputChannelGains[leftIndex] ?? 0;
}

function onOutputGainInput(leftIndex: number, rightIndex: number, db: number) {
  // Update both channels of the stereo pair together.
  server.setOutputChannelGainDb(leftIndex, db);
  server.setOutputChannelGainDb(rightIndex, db);
}

function resetOutputGain(leftIndex: number, rightIndex: number) {
  server.setOutputChannelGainDb(leftIndex, 0);
  server.setOutputChannelGainDb(rightIndex, 0);
}

const handlePlayNext = () => {
  const uuid = effectiveNextUuid.value;
  if (!uuid) return;
  const item = findItemByUuid(uuid);
  if (!item) return;
  if (nextItemOverrideUuid.value) setNextItem(null);
  if (item.type === 'audio') playCue(item as AudioItem);
  else if (item.type === 'group') triggerGroup(item);
};
</script>

<style scoped>
.playback-controls {
  height: var(--playback-controls-height);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  padding: 0 var(--spacing-lg);
  background-color: var(--color-surface);
}

.controls-left {
  display: flex;
  gap: var(--spacing-sm);
}

/* Show Mode — bigger GO / Stop-All buttons. The controls bar grows a little
   taller to fit them; preview card and stop button are also enlarged. */
.playback-controls.show-mode {
  min-height: calc(var(--playback-controls-height) + 20px);

  .control-btn {
    padding: var(--spacing-lg) var(--spacing-xl);
    font-size: 17px;

    .material-symbols-rounded,
    .icon {
      font-size: 26px;
    }
  }

  .preview-cue-card {
    min-width: 500px;
    max-width: 500px;
    padding: var(--spacing-md);
  }

  .preview-cue-header {
    font-size: 16px;
  }

  .preview-stop-btn {
    width: 32px;
    height: 32px;
    font-size: 24px;
  }
}

.control-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  font-weight: 500;
  
  @media (any-hover: hover) and (any-pointer: fine) {
    &:hover:not(:disabled) {
      background-color: var(--color-surface-hover);
      border-color: var(--color-accent);
    }
  }

  &:disabled {
    opacity: 0.5;
  }
}

.play-next-btn {
  color: var(--color-text-secondary);

  &.has-next {
    background-color: var(--color-warning);
    border-color: var(--color-warning);
    color: black;
    font-weight: 600;

    @media (any-hover: hover) and (any-pointer: fine) {
      &:hover:not(:disabled) {
        background-color: var(--color-warning);
        border-color: var(--color-warning);
        filter: brightness(0.88);
      }
    }
  }
}

.panic-btn {
  background-color: var(--color-danger);
  border-color: var(--color-danger);
  color: white;
  font-weight: 600;

  @media (any-hover: hover) and (any-pointer: fine) {
    &:hover:not(:disabled) {
      background-color: var(--color-danger);
      border-color: var(--color-danger);
      filter: brightness(0.85);
    }
  }
}

.icon {
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-cues {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: var(--spacing-sm) 0;
}

.no-cues {
  color: var(--color-text-secondary);
  font-style: italic;
  padding: var(--spacing-md);
}

/* Phone-only "up next" row that fills the reserved bar height with information
   instead of the words "No active cues". Renders nothing on desktop. */
.lp-upnext {
  display: none;
}

/* Hit wrapper for the preview seek bar — no extra geometry at base. */
.seek-hit {
  padding-block: 0;
}

.cue-list {
  display: flex;
  flex-direction: row;
  gap: var(--spacing-sm);
}

/* Preview card — same card dimensions and visual structure as ActiveCueItem,
   with a green "Preview" pill prefixing the name. */
.preview-cue-card {
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-sm) var(--spacing-md);
  min-width: 400px;
  max-width: 400px;
  display: flex;
  gap: var(--spacing-sm);
}

.preview-cue-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.preview-cue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.preview-cue-name {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(to right, black 80%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
}

.preview-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background-color: var(--color-success);
  color: black;
  white-space: nowrap;
  flex-shrink: 0;
}

.preview-cue-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.preview-stop-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: var(--color-danger);
  color: white;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;

  @media (any-hover: hover) and (any-pointer: fine) {
    &:hover {
      opacity: 0.8;
    }
  }
}

.output-meters {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: var(--spacing-sm);
  padding-left: var(--spacing-md);
  border-left: 2px solid var(--color-border);
  height: calc(var(--playback-controls-height) - 16px);
  flex-shrink: 0;
}

.output-pair {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 4px;
}


.preview-cue-meter {
  display: flex;
  align-items: stretch;
  padding-left: var(--spacing-sm);
  border-left: 1px solid var(--color-border);
}

.preview-cue-progress {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.preview-time-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.preview-progress-bar {
  height: 8px;
  background-color: var(--color-surface);
  border-radius: var(--border-radius-sm);
  position: relative;
  cursor: pointer;
  direction: ltr;

  @media (any-hover: hover) and (any-pointer: fine) {
    &:hover .preview-progress-handle {
      opacity: 1;
    }
  }
}

.preview-progress-fill {
  height: 100%;
  background-color: var(--color-success);
  border-radius: var(--border-radius-sm);
  transition: width 100ms linear;
}

.preview-progress-handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 16px;
  height: 16px;
  background-color: white;
  border: 2px solid var(--color-success);
  border-radius: 50%;
  opacity: 0;
  transition: opacity var(--transition-fast);
  pointer-events: none;
}

/* Phone: the transport lives in the bottom bar (MainWorkspace), so it is hidden
   here. The bar keeps its FIXED height — that is the design, not an oversight:
   a bar that vanishes when a cue ends, or grows when a second one starts, moves
   the playlist by one to five rows at exactly the moment a thumb is already
   descending on a chosen row. */
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .playback-controls {
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    align-items: stretch;
    overflow: hidden;
  }
  /* Higher specificity than the component's own .transport-buttons{display:flex}. */
  .playback-controls .controls-left {
    display: none;
  }
  .active-cues {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* The two-cue fix. A horizontal row let cards divide the width until the name
     went to 0px; a column of non-shrinking cards scrolls instead, so every card
     always keeps its name, its remaining time and its level — which is exactly
     what decides which Stop to press when a bed and a sting are both running. */
  .cue-list {
    flex-direction: column;
    width: 100%;
    min-width: 0;
    gap: 6px;
  }

  .lp-upnext {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    height: 100%;
    min-width: 0;
  }
  .lp-upnext__pill {
    flex: 0 0 auto;
    padding: 2px 6px;
    border-radius: 2px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    background: var(--color-warning);
    color: black;
  }
  .lp-upnext__name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The master trim survives and becomes usable; its StereoMeter does not.
     Per-cue level now comes from each card's own bar and master level from the
     header mini-meter, so the 102px this column used to reserve goes back to
     the cue name — but "too loud" must still have an answer other than PANIC. */
  .output-meters {
    flex: 0 0 auto;
    align-self: stretch;
    height: auto;
    min-width: 0;
    overflow: visible;
    padding-left: var(--spacing-sm);
    gap: var(--spacing-xs);
  }
  .output-pair {
    gap: 0;
  }
  .output-pair > :first-child {
    display: none;
  }

  /* Preview card. Still a hand-copy of ActiveCueItem (merging them is a
     follow-up — that refactor would change desktop rendering of the most
     safety-critical live component), so its compact rules are parallel here. */
  .preview-cue-card {
    min-width: 0;
    max-width: 100%;
    width: 100%;
    padding: var(--spacing-sm);
    /* Replaces the PREVIEW pill, which cost the name ~70px to say what a green
       edge says for free. */
    border-left: 3px solid var(--color-success);
  }
  .preview-status-pill {
    display: none;
  }
  .preview-cue-meter {
    display: none;
  }
  .preview-cue-name {
    mask-image: none;
    -webkit-mask-image: none;
    text-overflow: ellipsis;
    font-size: 16px;
    font-weight: 600;
  }
  .preview-cue-actions {
    gap: var(--lp-sep);
  }
  .preview-stop-btn {
    width: var(--lp-tap-lg);
    height: var(--lp-tap-lg);
    margin-inline-start: auto;
    flex-shrink: 0;
    font-size: 34px;
  }
  .seek-hit {
    padding-block: 15px;
    /* pan-y, NOT none: this 44px strip sits inside a vertically scrolling cue
       list, and `none` meant a finger landing on it could not scroll to the
       second running cue. The browser keeps the vertical axis; the pointer
       handlers own horizontal drags. */
    touch-action: pan-y;
  }
  .preview-progress-bar {
    height: 14px;
  }
  .preview-progress-handle {
    opacity: 1;
    width: 28px;
    height: 28px;
  }
}

/* Phone in landscape: the bar is 72px, so the card has to give up a little. */
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .time-info {
    font-size: 11px;
  }
  .preview-progress-bar {
    height: 8px;
  }
}
</style>
