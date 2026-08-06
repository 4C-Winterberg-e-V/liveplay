<template>
  <div ref="headerRef" class="project-header">
    <div ref="leftRef" class="header-left">
      <img
        ref="logoRef"
        :src="isDark ? './assets/icons/SVG/liveplay-icon-darkmode@web.svg' : './assets/icons/SVG/liveplay-icon-lightmode@web.svg'"
        alt="LivePlay"
        class="header-logo"
      />
      <h2 class="project-name" :class="{ 'project-name--hidden': hideTitle }">{{ currentProject?.name || t('project.noProject') }}</h2>
      <span
        v-if="currentProject && !autoSaveEnabled && hasUnsavedChanges"
        class="unsaved-pill"
      >{{ t('project.unsavedChanges') }}</span>
    </div>

    <div
      v-if="silenceWarning"
      ref="warningRef"
      class="silence-warning"
      :class="[silenceWarningClass, { 'silence-warning--left': warningMode === 'left' }]"
      :style="warningStyle"
    >
      {{ t('project.silenceWarning') }} {{ Math.ceil(silenceWarning) }} {{ t('project.seconds') }}
    </div>

    <div ref="rightRef" class="header-right">
      <!-- Appears the moment the socket drops; spins for as long as we retry. -->
      <ConnectionStatusPill />

      <!-- Phones only: transport moves up here from the controls bar so the
           active-cue list below gets the full width (icon-only to stay slim). -->
      <TransportButtons class="header-transport" />

      <!-- The X18 board is a live-operation control, not a settings screen, so
           it keeps its own button on phones instead of folding into the ⋯ menu
           with Settings and Shortcuts. -->
      <Btn class="header-action header-action--x18" :class="{ 'header-action--active': mainView === 'x18' }" icon="equalizer" :text="t('x18.title')" :aria-label="t('x18.title')" @click="toggleX18" />
      <Btn class="header-action" icon="tune" :text="t('settings.title')" @click="showProjectSettings = true" />
      <Btn class="header-action" icon="keyboard" :text="t('controls.shortcutBtn')" @click="showControlConfig = true" />
      <Btn v-if="hasElectron" class="header-action" icon="share" :text="t('webShare.button')" @click="showWebShare = true" />

      <!-- Mobile overflow menu: folds the actions above into a ⋯ menu so the
           narrow header isn't overcrowded. Hidden on desktop via CSS. -->
      <div class="header-overflow">
        <button
          type="button"
          class="header-overflow__btn"
          :class="{ 'header-overflow__btn--alert': !autoSaveEnabled && hasUnsavedChanges }"
          aria-label="Menu"
          @click="showHeaderMenu = !showHeaderMenu"
        >
          <span class="material-symbols-rounded">more_vert</span>
        </button>
        <template v-if="showHeaderMenu">
          <div class="header-overflow__backdrop" @click="showHeaderMenu = false"></div>
          <div class="header-overflow__menu">
            <!-- Autosave lives here on a phone. The bar-level switch is hidden
                 for width, and without this entry an operator who turned
                 autosave off had no way to turn it back on. The dot on the ⋯
                 button is what makes the off-plus-unsaved state visible while
                 the menu is shut. -->
            <button
              type="button"
              class="header-overflow__autosave"
              role="switch"
              :aria-checked="autoSaveEnabled"
              :disabled="!currentProject"
              @click="setAutoSave(!autoSaveEnabled)"
            >
              <span class="material-symbols-rounded">save</span>
              <span>{{ t('project.autosave') }}</span>
              <span class="autosave-toggle__track" :class="{ 'autosave-toggle__track--on': autoSaveEnabled }">
                <span class="autosave-toggle__thumb"></span>
              </span>
            </button>
            <!-- Show Mode belongs here for the same reason autosave does: the
                 bar-level switch is display:none on compact, so without this
                 entry the mode upstream added would be unreachable on a phone —
                 no way in, and worse, no way back out. -->
            <button
              type="button"
              class="header-overflow__autosave"
              role="switch"
              :aria-checked="uiMode === 'playback'"
              :disabled="!currentProject"
              @click="toggleUiMode()"
            >
              <span class="material-symbols-rounded">slideshow</span>
              <span>{{ t('showMode.toggle') }}</span>
              <span class="autosave-toggle__track" :class="{ 'autosave-toggle__track--on': uiMode === 'playback' }">
                <span class="autosave-toggle__thumb"></span>
              </span>
            </button>
            <!-- The URL bar is 60-90px of cue list. Installing the app removes
                 it, but the LAN share is plain http:// and can never be installed,
                 so this is the only route to a full screen there. Hidden where the
                 platform has no Fullscreen API (Safari on iPhone — there the
                 answer is Add to Home Screen). -->
            <button v-if="fullscreenSupported" type="button" @click="toggleFullscreen()">
              <span class="material-symbols-rounded">{{ isFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</span>
              <span>{{ isFullscreen ? t('project.exitFullscreen') : t('project.enterFullscreen') }}</span>
            </button>
            <!-- X18's primary path is the bottom deck tab; this is the fallback
                 for the detached-window case where no deck is mounted. -->
            <button type="button" @click="toggleX18(); showHeaderMenu = false">
              <span class="material-symbols-rounded">equalizer</span>
              <span>{{ t('x18.title') }}</span>
              <span v-if="mainView === 'x18'" class="material-symbols-rounded">check</span>
            </button>
            <button type="button" @click="showProjectSettings = true; showHeaderMenu = false">
              <span class="material-symbols-rounded">tune</span>
              <span>{{ t('settings.title') }}</span>
            </button>
            <button type="button" @click="showControlConfig = true; showHeaderMenu = false">
              <span class="material-symbols-rounded">keyboard</span>
              <span>{{ t('controls.shortcutBtn') }}</span>
            </button>
            <button v-if="hasElectron" type="button" @click="showWebShare = true; showHeaderMenu = false">
              <span class="material-symbols-rounded">share</span>
              <span>{{ t('webShare.button') }}</span>
            </button>
          </div>
        </template>
      </div>

      <!-- Autosave toggle: on by default; when off the project is only saved
           via File > Save and an "Unsaved Changes" pill appears by the title. -->
      <button
        type="button"
        class="autosave-toggle"
        role="switch"
        :aria-checked="autoSaveEnabled"
        :aria-label="t('project.autosave')"
        :disabled="!currentProject"
        @click="setAutoSave(!autoSaveEnabled)"
      >
        <span class="autosave-toggle__label">{{ t('project.autosave') }}</span>
        <span class="autosave-toggle__track" :class="{ 'autosave-toggle__track--on': autoSaveEnabled }">
          <span class="autosave-toggle__thumb"></span>
        </span>
      </button>

      <!-- Show Mode toggle: flips the whole workspace into the touch-friendly
           playback layout (edit buttons hidden, larger touch targets) and back.
           Persisted per-device, not in the project. -->
      <button
        type="button"
        class="autosave-toggle showmode-toggle"
        role="switch"
        :aria-checked="uiMode === 'playback'"
        :aria-label="t('showMode.toggle')"
        :disabled="!currentProject"
        :title="t('showMode.toggleHint')"
        @click="toggleUiMode"
      >
        <span class="autosave-toggle__label">{{ t('showMode.toggle') }}</span>
        <span class="autosave-toggle__track" :class="{ 'autosave-toggle__track--on': uiMode === 'playback' }">
          <span class="autosave-toggle__thumb"></span>
        </span>
      </button>

      <!-- Clock pair: wall clock + LTC timecode. The LTC box only appears once an
           LTC output device is configured in Project Settings — otherwise it's
           permanent header clutter. On a phone the wall clock is normally hidden
           because the system status bar already shows the time — but fullscreen
           hides that bar too, so the app has to supply it. -->
      <div class="clock-pair" :class="{ 'clock-pair--immersive': isFullscreen }">
        <div class="digital-clock clock--active">
          <span class="clock-label">{{ t('project.clock') }}</span>
          <span class="clock-value">{{ currentTime }}</span>
        </div>
        <div v-if="hasLtcDevice" class="digital-clock" :class="ltcTimecode ? 'clock--active' : 'clock--inactive'">
          <span class="clock-label">LTC</span>
          <span class="clock-value">{{ ltcTimecode ?? '--:--:--:--' }}</span>
        </div>
      </div>

      <!-- Phone master level. The per-output StereoMeter is dropped from the
           phone playback bar to give the cue name its width back, so this is
           where "is anything actually coming out" lives. Two bare bars rather
           than a StereoMeter: that component reserves 24px of its 68px for a dB
           scale, which is unreadable at chip size anyway.
           Only rendered while there IS signal — two flat bars beside the ⋯ button
           read as a mystery icon, not as a meter, and an idle meter is 16px of
           screen spent saying nothing. Compact-only, so desktop never opens the
           extra subscription. -->
      <div v-if="isCompact && masterHasSignal" class="header-meter" :title="t('project.masterLevel')">
        <LiveMeterBar source="master" :index="0" vertical :min-db="-60" :max-db="0" />
        <LiveMeterBar source="master" :index="1" vertical :min-db="-60" :max-db="0" />
      </div>
    </div>
  </div>

  <ControlConfigModal
    v-if="showControlConfig"
    @close="showControlConfig = false"
  />
  <ProjectSettingsModal
    :open="showProjectSettings"
    @close="showProjectSettings = false"
  />
  <WebShareModal
    v-if="showWebShare"
    @close="showWebShare = false"
  />
</template>

<script setup lang="ts">
import ProjectSettingsModal from './ProjectSettingsModal.vue';
import WebShareModal from './WebShareModal.vue';
import TransportButtons from './TransportButtons.vue';
import Btn from './Btn.vue';
import LiveMeterBar from './LiveMeterBar.vue';
import { useMasterMeter } from '~/composables/useLiveMeters';
import { useCompactLayout, lpFullscreenSupported, lpToggleFullscreen } from '~/composables/useCompactLayout';
import type { AudioItem } from '~/types/project';

const { currentProject, findItemByUuid, findItemByIndex, autoSaveEnabled, hasUnsavedChanges, setAutoSave } = useProject();
const { t } = useLocalization();
const { activeCues } = useAudioEngine();
const { uiMode, toggleUiMode } = useUiMode();

// Layout-only gate: decides whether the phone master meter is mounted and
// whether the silence banner's placement maths is worth running at all.
const { isCompact, isFullscreen } = useCompactLayout();
const toggleFullscreen = lpToggleFullscreen;
// Evaluated once on the client; document.fullscreenEnabled does not change.
const fullscreenSupported = import.meta.client ? lpFullscreenSupported() : false;

// Is the master bus actually producing anything? Used to keep the phone level
// chip out of the header while the show is silent. -60 dB is the meter's own
// floor, so this is "above the bottom of the scale", not an arbitrary threshold.
const masterL = useMasterMeter(() => (isCompact.value ? 0 : null));
const masterR = useMasterMeter(() => (isCompact.value ? 1 : null));
const masterHasSignal = computed(() => masterL.peak.value > -60 || masterR.peak.value > -60);

const showControlConfig = ref(false);
const showProjectSettings = useState('showProjectSettings', () => false);
const showWebShare = ref(false);
// Web-sharing (host the mobile UI) is Electron-only — the host server lives in
// the main process. In the browser build the button is hidden.
const hasElectron = import.meta.client && !!(window as any).electronAPI;
// Mobile-only ⋯ overflow menu (settings + shortcuts).
const showHeaderMenu = ref(false);

// Top-level view switch (workspace vs X18 control board). Shared with
// MainWorkspace via useState.
const mainView = useState<'workspace' | 'x18'>('mainView', () => 'workspace');
const toggleX18 = () => {
  mainView.value = mainView.value === 'x18' ? 'workspace' : 'x18';
};

const isDark = computed(() => currentProject.value?.theme.mode === 'dark');
const currentTime = ref('00:00:00');

// ---- Silence warning -------------------------------------------------------

const silenceWarning = ref<number | null>(null);

const silenceWarningClass = computed(() => {
  if (!silenceWarning.value) return '';
  const seconds = silenceWarning.value;
  if (seconds <= 5) return 'flash-fast';
  if (seconds <= 10) return 'flash-medium';
  if (seconds <= 30) return 'flash-slow';
  return 'warning-yellow';
});

// ---- Silence-warning placement --------------------------------------------
// The warning sits centred over the header, but the header's right side now
// carries buttons + clocks. We adapt:
//   1. center : enough room → keep it centred over the whole header.
//   2. gap    : centred banner would overlap the left/right blocks → centre it
//               in the free gap between the title area and the buttons/clocks.
//   3. left   : it still won't fit in the gap → align it left and let it take
//               the project title's place (the logo stays put).
const headerRef  = ref<HTMLElement | null>(null);
const leftRef    = ref<HTMLElement | null>(null);
const logoRef    = ref<HTMLElement | null>(null);
const rightRef   = ref<HTMLElement | null>(null);
const warningRef = ref<HTMLElement | null>(null);

const warningMode = ref<'center' | 'gap' | 'left'>('center');
const warningLeftPx = ref(0);
// On a phone the banner is a full-width row of its own, so it never needs the
// title's place. Without the isCompact guard the title was hidden there while
// the banner itself was display:none — a countdown to dead air that manifested
// as the project name vanishing.
const hideTitle = computed(() => !!silenceWarning.value && warningMode.value === 'left' && !isCompact.value);

const warningStyle = computed(() => ({
  left: `${warningLeftPx.value}px`,
  transform: warningMode.value === 'left' ? 'translateX(0)' : 'translateX(-50%)',
}));

const PLACEMENT_MARGIN = 12; // breathing room kept from neighbouring blocks

function recomputeWarningPlacement() {
  // The compact banner is a static full-width row — no measuring needed. Skip
  // the geometry entirely rather than doing five getBoundingClientRect reads
  // per resize on a battery-powered client.
  if (isCompact.value) return;
  const header = headerRef.value;
  const warning = warningRef.value;
  const left = leftRef.value;
  const logo = logoRef.value;
  const right = rightRef.value;
  if (!header || !warning || !left || !logo || !right) return;

  const headerRect = header.getBoundingClientRect();
  // Geometry is measured with the title always occupying space, so the chosen
  // mode never oscillates: in "left" mode the title is only made invisible, it
  // keeps its layout box.
  const leftEdge  = left.getBoundingClientRect().right - headerRect.left;
  const rightEdge = right.getBoundingClientRect().left - headerRect.left;
  const logoEdge  = logo.getBoundingClientRect().right - headerRect.left;
  const w = warning.offsetWidth;
  const center = headerRect.width / 2;

  // 1. Centred over the whole header without touching either block?
  if (center - w / 2 >= leftEdge + PLACEMENT_MARGIN &&
      center + w / 2 <= rightEdge - PLACEMENT_MARGIN) {
    warningMode.value = 'center';
    warningLeftPx.value = center;
    return;
  }

  // 2. Centred within the free gap between the two blocks?
  const gapAvail = (rightEdge - leftEdge) - 2 * PLACEMENT_MARGIN;
  if (w <= gapAvail) {
    warningMode.value = 'gap';
    warningLeftPx.value = (leftEdge + rightEdge) / 2;
    return;
  }

  // 3. Fall back to left-aligned, taking the title's place (logo stays).
  warningMode.value = 'left';
  warningLeftPx.value = logoEdge + PLACEMENT_MARGIN;
}

// Recompute whenever the displayed text changes (digit count shifts width) or
// the header is resized.
watch(() => [silenceWarning.value, isDark.value], () => {
  nextTick(recomputeWarningPlacement);
});

const checkForSilence = () => {
  // The user can opt out of the silence warning entirely in project settings.
  if (!currentProject.value
      || activeCues.value.size === 0
      || (currentProject.value as any).settings?.disableSilenceWarning) {
    silenceWarning.value = null;
    return;
  }

  const cueEndTimes = new Map<string, { time: number; hasValidBehavior: boolean }>();

  for (const [uuid, cue] of activeCues.value) {
    const item = findItemByUuid(uuid);
    if (!item || item.type !== 'audio') continue;
    const audioItem = item as any;
    const timeRemaining = cue.duration - cue.currentTime;
    const hasValidEndBehavior = validateEndBehavior(audioItem);
    cueEndTimes.set(uuid, { time: timeRemaining, hasValidBehavior: hasValidEndBehavior });
  }

  if (cueEndTimes.size === 1) {
    const [, { time, hasValidBehavior }] = Array.from(cueEndTimes.entries())[0];
    silenceWarning.value = (!hasValidBehavior && time <= 60) ? time : null;
    return;
  }

  let minTimeToActualSilence = Infinity;
  const sortedCues = Array.from(cueEndTimes.entries()).sort((a, b) => a[1].time - b[1].time);

  for (let i = 0; i < sortedCues.length; i++) {
    const [, { time, hasValidBehavior }] = sortedCues[i];
    let cuesStillPlaying = 0;
    for (let j = 0; j < sortedCues.length; j++) {
      if (i === j) continue;
      if (sortedCues[j][1].time > time) cuesStillPlaying++;
    }
    if (cuesStillPlaying === 0 && !hasValidBehavior) {
      minTimeToActualSilence = Math.min(minTimeToActualSilence, time);
      break;
    }
  }

  silenceWarning.value = (minTimeToActualSilence <= 60 && minTimeToActualSilence !== Infinity)
    ? minTimeToActualSilence
    : null;
};

const validateEndBehavior = (audioItem: any): boolean => {
  if (!audioItem.endBehavior || audioItem.endBehavior.action === 'nothing') return false;
  const action = audioItem.endBehavior.action;
  if (action === 'next' || action === 'play-next') {
    const currentIndex = audioItem.index;
    if (!currentIndex || !currentProject.value) return false;
    const parentIndex = currentIndex.slice(0, -1);
    const currentPosition = currentIndex[currentIndex.length - 1];
    if (parentIndex.length === 0) {
      return !!currentProject.value.items[currentPosition + 1];
    } else {
      const parent = findItemByIndex(parentIndex);
      return !!(parent && parent.type === 'group' && (parent as any).children[currentPosition + 1]);
    }
  }
  if (action === 'goto-item') {
    return !!(audioItem.endBehavior.targetUuid && findItemByUuid(audioItem.endBehavior.targetUuid));
  }
  if (action === 'goto-index') {
    const ti = audioItem.endBehavior.targetIndex;
    return !!(ti && Array.isArray(ti) && findItemByIndex(ti));
  }
  if (action === 'loop') return true;
  return false;
};

// ---- Wall clock ------------------------------------------------------------

const updateClock = () => {
  const now = new Date();
  currentTime.value = [
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ].map(n => String(n).padStart(2, '0')).join(':');
};

// ---- LTC timecode ----------------------------------------------------------

// Frame-rate lookup: index matches the ltcFrameRateIndex values in project.ts
const FPS_TABLE = [24, 25, 29.97, 29.97, 30] as const;

function parseTcToFrames(tc: string, fps: number): number {
  const parts = tc.replace(';', ':').split(':');
  if (parts.length !== 4) return 0;
  const [h, m, s, f] = parts.map(Number);
  return ((h * 3600 + m * 60 + s) * Math.round(fps)) + f;
}

function framesToTc(totalFrames: number, fps: number): string {
  const fpsInt = Math.round(fps);
  const f = totalFrames % fpsInt;
  const totalSecs = Math.floor(totalFrames / fpsInt);
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60) % 60;
  const h = Math.floor(totalSecs / 3600);
  return [h, m, s, f].map(n => String(n).padStart(2, '0')).join(':');
}

// Whether the project has an LTC output device configured at all — the LTC
// clock box is only rendered when this is true, so it doesn't sit in the
// (increasingly crowded) header as permanent dead weight for projects that
// never use timecode.
const hasLtcDevice = computed(() => !!(currentProject.value as any)?.settings?.ltcDevice);

// Returns the current LTC timecode string if any active cue is outputting LTC
// to a configured LTC device, otherwise null (→ box shown grey with dashes).
const ltcTimecode = computed<string | null>(() => {
  const ltcDevice = (currentProject.value as any)?.settings?.ltcDevice;
  if (!ltcDevice) return null;

  for (const [uuid, cue] of activeCues.value) {
    const item = findItemByUuid(uuid);
    if (!item || item.type !== 'audio') continue;
    const ai = item as AudioItem & { ltcEnabled?: boolean; ltcFrameRateIndex?: number; ltcStartTimecode?: string };
    if (!ai.ltcEnabled) continue;

    const fps = FPS_TABLE[ai.ltcFrameRateIndex ?? 4] ?? 30;
    const startTc = ai.ltcStartTimecode ?? '00:00:00:00';
    const startFrames = parseTcToFrames(startTc, fps);
    const elapsedFrames = Math.floor(cue.currentTime * fps);
    return framesToTc(startFrames + elapsedFrames, fps);
  }
  return null;
});

onMounted(() => {
  updateClock();
  const clockInterval = setInterval(updateClock, 1000);
  const silenceInterval = setInterval(checkForSilence, 100);

  // Re-place the silence banner whenever the header geometry changes
  // (window resize, sidebar toggles, clock width shifts, …).
  let resizeObserver: ResizeObserver | null = null;
  if (headerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => recomputeWarningPlacement());
    resizeObserver.observe(headerRef.value);
  }

  onUnmounted(() => {
    clearInterval(clockInterval);
    clearInterval(silenceInterval);
    if (resizeObserver) resizeObserver.disconnect();
  });
});
</script>

<style scoped lang="scss">
.project-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  // Add the iOS safe-area insets so the header doesn't render under the
  // status bar / notch when installed as a PWA (black-translucent status bar).
  // env() is 0 on desktop/Electron, so this is a no-op there.
  padding:
    calc(var(--spacing-sm) + env(safe-area-inset-top))
    calc(var(--spacing-lg) + env(safe-area-inset-right))
    var(--spacing-sm)
    calc(var(--spacing-lg) + env(safe-area-inset-left));
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  // --lp-header-h is declared only inside the compact query, so this resolves
  // to the same 60px it always did on desktop.
  min-height: var(--lp-header-h, 60px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.header-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.project-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

/* "Unsaved Changes" pill — styled like the playback status pills (yellow
   warning, black text), shown next to the project title when autosave is off
   and edits are pending. */
.unsaved-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 2px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  background-color: var(--color-warning);
  color: black;
}

/* Autosave toggle switch */
.autosave-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-family: inherit;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.autosave-toggle__label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.autosave-toggle__track {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background-color: var(--color-border);
  transition: background-color var(--transition-base);
  flex-shrink: 0;
}

.autosave-toggle__track--on {
  background-color: var(--color-accent);
}

.autosave-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #fff;
  transition: transform var(--transition-base);
}

.autosave-toggle__track--on .autosave-toggle__thumb {
  transform: translateX(16px);
}

/* Two clocks side-by-side, never re-arrange */
.clock-pair {
  display: flex;
  gap: var(--spacing-sm);
  align-items: stretch;
}

.digital-clock {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4px var(--spacing-md);
  border: 2px solid currentColor;
  border-radius: var(--border-radius-md);
  background-color: var(--color-surface);
  transition: color var(--transition-base), border-color var(--transition-base);
  min-width: 110px;
}

/* Active state for the X18 main-view nav button. */
.header-action--active {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.clock--active {
  color: var(--color-accent);
}

.clock--inactive {
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.clock-label {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  line-height: 1;
  margin-bottom: 2px;
}

.clock-value {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1;
}

.silence-warning {
  position: absolute;
  /* left + transform are set inline (adaptive placement, see script).
     Vertical centring comes from the flex container's static position. */
  padding: var(--spacing-xs) var(--spacing-lg);
  border-radius: var(--border-radius-md);
  font-weight: 700;
  font-size: 16px;
  color: #000;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 10;
}

/* Left-aligned fallback sits in the title's place — tighten the horizontal
   padding so it reads like a header label rather than a centred banner. */
.silence-warning--left {
  padding-left: var(--spacing-md);
  padding-right: var(--spacing-md);
}

/* In the left-aligned fallback the project title is hidden but keeps its
   layout box, so placement geometry stays stable (no flip-flopping). */
.project-name--hidden {
  visibility: hidden;
}

.silence-warning.warning-yellow  { background-color: #fbbf24; }
.silence-warning.flash-slow      { background-color: #fbbf24; animation: flash-slow   2s   ease-in-out infinite; }
.silence-warning.flash-medium    { background-color: #f56d1f; animation: flash-medium 1s   ease-in-out infinite; }
.silence-warning.flash-fast      { background-color: #dc2626; color: #fff; animation: flash-fast 0.5s ease-in-out infinite; }

@keyframes flash-slow   { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
@keyframes flash-medium { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
@keyframes flash-fast   { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }

// ---- Mobile: keep the logo/name pinned, let the actions scroll ----------
// ---- Mobile overflow menu (hidden on desktop) --------------------------
.header-overflow {
  display: none;
  position: relative;
}
.header-overflow__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 40px;
  height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: var(--color-background);
  color: var(--color-text-primary);
  cursor: pointer;

  .material-symbols-rounded { font-size: 22px; }
}

/* The "Unsaved Changes" pill is dropped on a phone for width, so the ⋯ button
   carries the state instead — otherwise autosave-off plus pending edits is
   completely invisible on the surface where autosave now lives. */
.header-overflow__btn--alert::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-warning);
}
.header-overflow__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.header-overflow__menu {
  // Fixed so it's never clipped by the header's horizontal overflow. Anchored
  // to the real header height token rather than a hardcoded 56px, which did not
  // match the actual 62px header and opened the menu on top of the bar.
  position: fixed;
  top: calc(env(safe-area-inset-top) + var(--lp-header-h, 60px) + var(--spacing-xs));
  right: calc(env(safe-area-inset-right) + var(--spacing-md));
  z-index: 1001;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  overflow: hidden;

  button {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    min-height: var(--lp-tap, 44px);
    background: transparent;
    border: none;
    color: var(--color-text-primary);
    font-size: 15px;
    text-align: left;
    cursor: pointer;

    @media (any-hover: hover) and (any-pointer: fine) {
      &:hover { background: var(--color-surface-hover); }
    }
    .material-symbols-rounded { font-size: 20px; }
  }
}

/* Autosave row inside the ⋯ menu: label left, switch right. */
.header-overflow__autosave {
  border-bottom: 1px solid var(--color-border) !important;

  .autosave-toggle__track {
    margin-inline-start: auto;
  }

  &:disabled {
    opacity: 0.4;
  }
}

/* Transport (Play-Next / Stop-All) in the title bar — phones only.
   Higher specificity than the component's own `.transport-buttons{display:flex}`
   so it stays hidden on desktop regardless of stylesheet order. */
.header-right .header-transport { display: none; }

@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  // The header is now identity + status only. Both time-critical controls moved
  // to the bottom bar: the top-right corner is the worst one-handed thumb zone,
  // and it was the reason this row kept running out of space.
  .header-action { display: none; }
  .header-overflow { display: block; }
  .header-right .header-transport { display: none; }
  .autosave-toggle { display: none; }
  .unsaved-pill { display: none; }

  // One shared icon-button rule instead of three hardcoded 46px pairs.
  .header-overflow__btn {
    width: var(--lp-tap);
    height: var(--lp-tap);
  }
  .header-overflow__btn .material-symbols-rounded {
    font-size: var(--lp-tap-icon);
  }

  .project-header {
    gap: var(--spacing-sm);
    // .main-workspace owns the horizontal insets now.
    padding:
      calc(var(--spacing-sm) + env(safe-area-inset-top))
      var(--spacing-md)
      var(--spacing-sm)
      var(--spacing-md);
    // Lets the silence banner take a full row of its own below.
    flex-wrap: wrap;
  }
  // The show file name is the operator's orientation cue. Give it the row's
  // slack instead of capping it at 30vw ("Sommerf…").
  //
  // flex-basis 0, NOT auto: with `flex-wrap: wrap` on the parent (which the
  // silence banner needs) a basis of `auto` claims the untruncated title's full
  // width, so at 360px the actions wrapped to a second line and the header grew
  // to 105px. Basis 0 lets the title shrink and keeps the row single-line.
  .header-left {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
  }
  // One line, ellipsised. On a phone a wrapping title grows the header and
  // pushes the LTC chip off the edge; the desktop header keeps its existing
  // wrapping behaviour untouched.
  .project-name {
    max-width: none;
    flex: 1 1 auto;
    min-width: 6ch;
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-right {
    flex: 0 0 auto;
    gap: var(--spacing-sm);
  }

  // LTC comes back, but only as a chip and only while a cue is actually
  // emitting timecode — the wall clock is on the phone's own status bar and the
  // inactive LTC box was pure decoration.
  .clock-pair { display: flex; }
  .clock-pair .digital-clock:first-child { display: none; }
  .clock-pair .digital-clock.clock--inactive { display: none; }
  /* Fullscreen took the system clock away — put ours back. */
  .clock-pair--immersive .digital-clock:first-child { display: flex; }
  .digital-clock {
    min-width: 0;
    padding: 2px 6px;
    border-width: 1px;
  }
  .clock-label { display: none; }
  .clock-value { font-size: 14px; }

  .header-meter {
    display: flex;
    gap: 2px;
    width: 16px;
    height: 32px;
    flex: 0 0 auto;
    padding: 2px;
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius-sm);
    background: var(--color-background);
  }
  .header-meter :deep(.live-meter) {
    flex: 1 1 0;
    min-width: 0;
  }

  // The dead-air countdown was display:none here, so the one warning that a
  // show is about to fall silent did not exist on the phone. It becomes a
  // full-width row under the header instead of a floating banner that would
  // have covered the buttons. The !important pair neutralises the inline
  // placement style, which only makes sense for the desktop layout.
  .silence-warning {
    position: static;
    left: auto !important;
    transform: none !important;
    display: block;
    order: 99;
    flex: 1 0 100%;
    text-align: center;
    border-radius: 0;
    font-size: 15px;
    padding: 4px var(--spacing-md);
    margin: var(--spacing-sm) calc(-1 * var(--spacing-md)) calc(-1 * var(--spacing-sm));
  }
}

/* Phone in landscape: every vertical pixel is a cue row. */
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .project-header {
    padding:
      calc(var(--spacing-xs) + env(safe-area-inset-top))
      var(--spacing-md)
      var(--spacing-xs)
      var(--spacing-md);
  }
}
</style>
