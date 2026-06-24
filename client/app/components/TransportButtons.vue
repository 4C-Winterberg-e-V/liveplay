<!--
  TransportButtons — the "Play Next" + "Stop All Cues" pair.

  Extracted so it can live in the PlaybackControls bar on desktop and in the
  ProjectHeader title bar on phones (where moving it out frees the controls bar
  for the active-cue list). All transport logic is self-contained here.

  The `.control-btn__label` text is hidden by the host when space is tight
  (icon-only), e.g. in the mobile title bar.
-->
<template>
  <div class="transport-buttons">
    <button
      class="control-btn play-next-btn"
      :class="{ 'has-next': !!effectiveNextUuid }"
      @click="handlePlayNext"
      :disabled="!effectiveNextUuid"
      :title="playNextTooltip"
    >
      <span class="material-symbols-rounded">fast_forward</span>
      <span class="control-btn__label">{{ t('controls.playNext') }}</span>
    </button>
    <button
      class="control-btn panic-btn"
      @click="handlePanic"
      :disabled="activeCues.size === 0"
      :title="stopAllTooltip"
    >
      <span class="icon">⚠</span>
      <span class="control-btn__label">{{ t('playback.panic') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { AudioItem } from '~/types/project';
import { formatKeyLabel } from '~/composables/useCartHotkeys';
import { useLiveplayServer } from '~/composables/useLiveplayServer';

const { activeCues, panicStop, nextItemOverrideUuid, autoNextItemUuid, setNextItem, playCue, triggerGroup } = useAudioEngine();
const { findItemByUuid } = useProject();
const { playbackMappings } = useCartHotkeys();
const { t } = useLocalization();
const server = useLiveplayServer();

const effectiveNextUuid = computed(() => nextItemOverrideUuid.value ?? autoNextItemUuid.value);

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
  // Stop the server immediately (no fade); also stop the legacy in-process
  // engine while it's still in use.
  server.stopAll(0);
  panicStop();
};

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
.transport-buttons {
  display: flex;
  gap: var(--spacing-sm);
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
  color: var(--color-text-primary);
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: var(--color-surface-hover);
    border-color: var(--color-accent);
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

    &:hover:not(:disabled) {
      background-color: var(--color-warning);
      border-color: var(--color-warning);
      filter: brightness(0.88);
    }
  }
}

.panic-btn {
  background-color: var(--color-danger);
  border-color: var(--color-danger);
  color: white;
  font-weight: 600;

  &:hover:not(:disabled) {
    background-color: var(--color-danger);
    border-color: var(--color-danger);
    filter: brightness(0.85);
  }
}

.icon {
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
