import type { MaybeRefOrGetter } from 'vue'
import type { useNodePingStats } from '@/composables/useNodePingStats'
import type { NodeData } from '@/stores/nodes'
import type { PingTaskInfo } from '@/utils/rpc'
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import { loadPublicPingTasks } from '@/services/metrics.service'
import { subscribeVisibleRefresh } from '@/services/visibleRefresh.service'
import { useAppStore } from '@/stores/app'

const CARRIER_PATTERNS = [/电信|telecom|\bct\b/i, /联通|unicom|\bcu\b/i, /移动|mobile|cmcc|\bcm\b/i]

// Adapted from towersip: explicit IDs, per-node bindings, and separate history
// computations from live values so status polling does not rebuild SVG paths.
export function useThreeNetPing(node: MaybeRefOrGetter<NodeData>, stats: ReturnType<typeof useNodePingStats>, enabled: MaybeRefOrGetter<boolean>) {
  const app = useAppStore()
  const tasks = shallowRef<PingTaskInfo[]>([])
  let release: (() => void) | undefined
  let generation = 0
  watch(() => app.threeNetPingEnabled && toValue(enabled), async (enabled) => {
    const current = ++generation
    release?.()
    release = undefined
    if (!enabled)
      return
    const refresh = async () => {
      try {
        const result = await loadPublicPingTasks()
        if (current === generation)
          tasks.value = result
      }
      catch { /* Cached history/live status remain usable without a catalog. */ }
    }
    release = subscribeVisibleRefresh(() => {
      void refresh()
    })
    await refresh()
  }, { immediate: true })
  onScopeDispose(() => {
    generation++
    release?.()
  })
  const taskIds = computed(() => {
    if (!app.threeNetPingEnabled)
      return []
    const uuid = toValue(node).uuid
    const configured = app.threeNetPingNodeTaskBindings[uuid]
    if (configured?.length)
      return configured
    if (app.threeNetPingTaskIds.length)
      return app.threeNetPingTaskIds
    const applicable = tasks.value.filter(task => !task.clients?.length || task.clients.includes(uuid))
    const carrierIds = CARRIER_PATTERNS.flatMap((pattern) => {
      const match = applicable.find(task => pattern.test(task.name))
      return match ? [match.id] : []
    })
    return [...new Set([...carrierIds, ...applicable.map(task => task.id)])].slice(0, 3)
  })
  const historyItems = computed(() => taskIds.value.map((id) => {
    const value = stats.taskStats(id)
    return { id, stats: value, values: value.history.map(point => point.latency) }
  }))
  const items = computed(() => historyItems.value.map((item) => {
    const sample = toValue(node).ping?.[String(item.id)]
    const name = sample?.name || tasks.value.find(task => task.id === item.id)?.name || `任务 ${item.id}`
    const latest = sample && Number.isFinite(sample.latest) ? sample.latest : null
    const latency = latest ?? (item.stats.hasData ? item.stats.avgLatency : null)
    const loss = sample && Number.isFinite(sample.loss) && sample.loss >= 0 && sample.loss <= 100
      ? sample.loss
      : item.stats.hasData ? item.stats.avgLoss : null
    return {
      ...item,
      name,
      latency: latency === null ? '—' : latency < 0 ? '不可达' : `${Math.round(latency)} ms`,
      loss: loss === null ? '—' : `${loss.toFixed(1)}%`,
      live: latest !== null,
      failed: latest !== null && latest < 0,
    }
  }))
  return { items }
}
