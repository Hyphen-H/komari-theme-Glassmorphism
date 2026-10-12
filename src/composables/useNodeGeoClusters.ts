import type { NodeData } from '@/stores/nodes'
import type { IpGeo } from '@/utils/ipGeoHelper'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { getNodeIps } from '@/services/provider.service'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { formatCityNameZh } from '@/utils/cityNameHelper'
import { getCoordByCode, getCountryCodeFromRegion } from '@/utils/geoHelper'
import { isPublicIp } from '@/utils/ipAddress'
import { lookupIpGeo } from '@/utils/ipGeoHelper'
import { getRegionDisplayName } from '@/utils/regionHelper'

interface UseNodeGeoClustersOptions {
  nodes?: () => NodeData[] | undefined
}

export interface RegionCluster {
  id: string
  code: string
  coord: [number, number]
  label: string
  asn?: string
  org?: string
  servers: number
  onlineServers: number
}

interface ClusterSummary {
  clusters: RegionCluster[]
  totalServers: number
  onlineServers: number
}

const CITY_SLUG_INVALID_REGEX = /[^a-z0-9]+/g
const CITY_SLUG_EDGE_REGEX = /^-+|-+$/g
const IP_GEO_LOOKUP_BATCH_SIZE = 8
const IP_GEO_RETRY_INTERVAL_MS = 10 * 60 * 1000

export function useNodeGeoClusters(options: UseNodeGeoClustersOptions = {}) {
  const nodesStore = useNodesStore()
  const appStore = useAppStore()
  let generation = 0
  onScopeDispose(() => {
    generation++
  })

  const displayNodes = computed(() => options.nodes?.() ?? nodesStore.visibleNodes)
  const ipGeoMap = ref(new Map<string, IpGeo>())
  const failedIpAttempts = new Map<string, number>()

  async function resolveNodeCities(nodes: NodeData[], current: number): Promise<void> {
    if (!await appStore.requireLoginPermission('providerGeoLookup', { force: false }) || current !== generation)
      return
    const pending: string[][] = []
    const now = Date.now()

    for (const node of nodes) {
      const candidates = getNodeIps(node).filter(isPublicIp)
      if (candidates.some(ip => ipGeoMap.value.has(ip)))
        continue
      const available = candidates.filter((ip) => {
        const failedAt = failedIpAttempts.get(ip)
        return !failedAt || now - failedAt >= IP_GEO_RETRY_INTERVAL_MS
      })
      if (available.length)
        pending.push(available)
    }

    for (let i = 0; i < pending.length; i += IP_GEO_LOOKUP_BATCH_SIZE) {
      if (current !== generation)
        return
      const batch = pending.slice(i, i + IP_GEO_LOOKUP_BATCH_SIZE)
      const results = (await Promise.all(batch.map(async (candidates) => {
        const attempts: Array<{ ip: string, geo: IpGeo | null }> = []
        for (const ip of candidates) {
          if (current !== generation)
            break
          const geo = ipGeoMap.value.get(ip) ?? await lookupIpGeo(ip)
          attempts.push({ ip, geo })
          if (geo)
            break
        }
        return attempts
      }))).flat()
      if (current !== generation || !appStore.privateFeaturesAllowed)
        return
      const resolved = results.filter((result): result is { ip: string, geo: IpGeo } => result.geo !== null)

      for (const { ip, geo } of results) {
        if (geo)
          failedIpAttempts.delete(ip)
        else
          failedIpAttempts.set(ip, Date.now())
      }

      if (!resolved.length)
        continue

      const next = new Map(ipGeoMap.value)
      for (const { ip, geo } of resolved) {
        next.set(ip, geo)
      }
      ipGeoMap.value = next
    }
  }

  function nodeClusterInfo(node: NodeData): { id: string, code: string, coord: [number, number], label: string, asn?: string, org?: string } | null {
    const countryCode = getCountryCodeFromRegion(node.region)
    const geo = getNodeIps(node).map(ip => ipGeoMap.value.get(ip)).find(Boolean)

    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      const code = (geo.countryCode || countryCode || '').toUpperCase()
      const citySlug = (geo.city || `${geo.lat.toFixed(2)},${geo.lng.toFixed(2)}`)
        .toLowerCase()
        .replace(CITY_SLUG_INVALID_REGEX, '-')
        .replace(CITY_SLUG_EDGE_REGEX, '')
      const label = formatCityNameZh(geo.city) || getRegionDisplayName(node.region) || getRegionDisplayName(code) || ''
      return {
        id: `${(code || 'xx').toLowerCase()}-${citySlug || 'city'}`,
        code: code || (countryCode ?? ''),
        coord: [geo.lat, geo.lng],
        label,
        asn: geo.asn,
        org: geo.org,
      }
    }

    if (countryCode) {
      const coord = getCoordByCode(countryCode)
      if (coord)
        return { id: countryCode.toLowerCase(), code: countryCode, coord, label: getRegionDisplayName(node.region) || getRegionDisplayName(countryCode) || '' }
    }

    return null
  }

  const clusterSummary = computed<ClusterSummary>(() => {
    const clustersById = new Map<string, RegionCluster>()
    let onlineServers = 0

    for (const node of displayNodes.value) {
      if (node.online)
        onlineServers += 1

      const info = nodeClusterInfo(node)
      if (!info)
        continue

      let cluster = clustersById.get(info.id)
      if (!cluster) {
        cluster = { id: info.id, code: info.code, coord: info.coord, label: info.label, asn: info.asn, org: info.org, servers: 0, onlineServers: 0 }
        clustersById.set(info.id, cluster)
      }
      if (!cluster.asn && info.asn)
        cluster.asn = info.asn
      if (!cluster.org && info.org)
        cluster.org = info.org
      cluster.servers += 1

      if (node.online)
        cluster.onlineServers += 1
    }

    return {
      clusters: Array.from(clustersById.values()).sort((a, b) => b.servers - a.servers),
      totalServers: displayNodes.value.length,
      onlineServers,
    }
  })

  const regionClusters = computed<RegionCluster[]>(() => clusterSummary.value.clusters)
  const totalServers = computed(() => clusterSummary.value.totalServers)
  const onlineServers = computed(() => clusterSummary.value.onlineServers)
  const offlineServers = computed(() => totalServers.value - onlineServers.value)

  function clusterKey(cluster: RegionCluster) {
    return `${cluster.id}:${cluster.coord[0]},${cluster.coord[1]}:${cluster.label}:${cluster.asn ?? ''}:${cluster.org ?? ''}:${cluster.servers}:${cluster.onlineServers}`
  }

  const nodeIpSignature = computed(() => displayNodes.value
    .map(node => `${node.uuid}:${getNodeIps(node).join(',')}`)
    .filter(Boolean)
    .join('|'))

  watch([nodeIpSignature, () => appStore.privateFeaturesAllowed], () => {
    const current = ++generation
    if (!appStore.privateFeaturesAllowed) {
      ipGeoMap.value = new Map()
      failedIpAttempts.clear()
      return
    }
    void resolveNodeCities(displayNodes.value, current)
  }, { immediate: true })

  return {
    displayNodes,
    regionClusters,
    totalServers,
    onlineServers,
    offlineServers,
    clusterKey,
  }
}
