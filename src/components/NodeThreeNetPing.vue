<script setup lang="ts">
import type { useNodePingStats } from '@/composables/useNodePingStats'
import type { NodeData } from '@/stores/nodes'
import { computed, watch } from 'vue'
import Sparkline from '@/components/ui/sparkline/Sparkline.vue'
import { sparklineMarkerPercent, useSparklinePeriodInspect } from '@/composables/useSparklinePeriodInspect'
import { useThreeNetPing } from '@/composables/useThreeNetPing'
import { formatDateTime } from '@/utils/helper'

const props = defineProps<{ node: NodeData, stats: ReturnType<typeof useNodePingStats>, enabled: boolean }>()
const emit = defineEmits<{ open: [] }>()
const { items } = useThreeNetPing(() => props.node, props.stats, () => props.enabled)
const { inspect, onPointerDown, onPointerMove, onPointerUp, onPointerLeave, clear } = useSparklinePeriodInspect()
const inspected = computed(() => {
  const selection = inspect.value
  if (!selection)
    return null
  const item = items.value.find(item => String(item.id) === selection.rowKey)
  const point = item?.stats.history[selection.index]
  return point && item ? { item, point } : null
})
watch(() => props.node.uuid, clear)

function inspectKeyboard(event: KeyboardEvent, id: number, count: number) {
  if (!count)
    return
  if (event.key === 'Escape') {
    clear()
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key))
    return
  event.preventDefault()
  event.stopPropagation()
  const previous = inspect.value?.rowKey === String(id) ? inspect.value.index : Math.floor(count / 2)
  const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  inspect.value = { rowKey: String(id), index: Math.max(0, Math.min(count - 1, previous + delta)), sticky: false }
}
</script>

<template>
  <div data-three-net-ping class="min-w-0 rounded-lg bg-slate-500/5 p-2 text-[11px]" @click.stop @keydown.stop>
    <div v-if="!items.length" class="py-2 text-center text-muted-foreground">
      {{ props.stats.loading.value ? '加载三网任务…' : '暂无适用的 Ping 任务，可在主题设置中指定任务 ID' }}
    </div>
    <div v-for="item in items" :key="item.id" :data-three-net-task="item.id" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_3.5rem] items-center gap-2 py-1">
      <button type="button" class="min-w-0 text-left" :title="`${item.name} · #${item.id}，打开完整图表`" @click="emit('open')">
        <span class="block truncate font-medium">{{ item.name }}</span>
        <span class="block tabular-nums" :class="item.failed ? 'text-destructive' : 'text-muted-foreground'" :title="item.live ? '最近一次探测' : '历史平均延迟'">{{ item.latency }}</span>
      </button>
      <button
        type="button" class="relative h-7 min-w-0 touch-pan-y text-blue-500 outline-offset-2" :aria-label="`${item.name} 历史延迟，左右方向键选择历史点`"
        @pointerdown="onPointerDown($event, String(item.id), item.values.length)"
        @pointermove="onPointerMove($event, String(item.id), item.values.length)"
        @pointerup="onPointerUp($event, String(item.id), item.values.length)"
        @pointerleave="onPointerLeave($event, String(item.id))"
        @pointercancel="clear" @blur="clear" @keydown="inspectKeyboard($event, item.id, item.values.length)"
      >
        <Sparkline v-if="item.values.some(value => value !== null)" :values="item.values" />
        <span v-else class="text-muted-foreground">暂无历史</span>
        <span v-if="inspect?.rowKey === String(item.id) && item.values.length" class="pointer-events-none absolute inset-y-0 border-l border-current" :style="{ left: `${sparklineMarkerPercent(inspect.index, item.values.length)}%` }" />
      </button>
      <span class="text-right tabular-nums text-muted-foreground" :title="`${item.name} 丢包率`">{{ item.loss }}</span>
    </div>
    <div v-if="inspected" data-three-net-history class="mt-1 border-t border-border/40 pt-1 text-muted-foreground" role="status">
      <span class="block truncate">{{ inspected.item.name }} · {{ formatDateTime(inspected.point.time) }}</span>
      <span>延迟 {{ inspected.point.latency === null ? '无有效样本' : `${Math.round(inspected.point.latency)} ms` }} · 丢包 {{ inspected.point.loss === null ? '无样本' : `${inspected.point.loss.toFixed(1)}%` }}</span>
    </div>
  </div>
</template>
